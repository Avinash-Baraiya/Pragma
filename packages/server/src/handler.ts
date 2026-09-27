import {
  createIssue,
  defineSchema,
  isPragmaError,
  isValidTimeZone,
  PragmaConfigError,
  PROTOCOL_VERSION,
  randomId,
  toIssue,
  type ErrorCode,
  type InterpretResult,
  type PragmaIssue,
  type ResolvedSchema,
  type TableSchema,
} from '@pragma/core';
import {
  createEngine,
  createModelInterpreter,
  MemoryCache,
  type Engine,
  type EngineOptions,
  type LanguageModelProvider,
  type MaybePromise,
  type ModelInterpreter,
  type Proposal,
} from '@pragma/interpreter';
import { z } from 'zod';
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js';

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

/** Context passed to authorization and rate-limit hooks. @public */
export interface RequestContext {
  readonly request: Request;
  readonly requestId: string;
  readonly resource: string;
}

/** @public */
export type AuthorizeResult =
  boolean | { readonly allowed: false; readonly status?: 401 | 403; readonly message?: string };

/** @public */
export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds the client should wait; sent as `Retry-After`. */
  readonly retryAfterSeconds?: number;
}

/** @public */
export interface CorsOptions {
  /** Allowed origin(s). Exact matches only; no wildcard for credentialed requests. */
  readonly origin: string | readonly string[];
  readonly credentials?: boolean;
  /** Preflight cache in seconds. Default 600. */
  readonly maxAge?: number;
}

/** @public */
export interface PragmaHandlerOptions {
  /** Table schemas served by this endpoint, keyed by resource. Clients reference them by name only. */
  readonly schemas: Readonly<Record<string, TableSchema | ResolvedSchema>>;
  /** Model provider(s); an ordered list is a fallback chain. Ignored when `interpreter` is set. */
  readonly provider?: LanguageModelProvider | readonly LanguageModelProvider[];
  /** A pre-built model interpreter (overrides `provider`). */
  readonly interpreter?: ModelInterpreter;
  /**
   * Accept a schema sent by the client for resources that are not registered.
   * Default `false`: a client could otherwise expose fields you meant to hide.
   */
  readonly allowClientSchema?: boolean;
  /** Engine settings shared by every resource. */
  readonly engine?: Omit<EngineOptions, 'schema' | 'interpreter'>;
  /** Return `false` (or a denial object) to reject with 401/403. */
  readonly authorize?: (context: RequestContext) => MaybePromise<AuthorizeResult>;
  /** Return `{ allowed: false }` to reject with 429. */
  readonly rateLimit?: (context: RequestContext) => MaybePromise<RateLimitResult>;
  /** Maximum request body size in bytes. Default 16 384. */
  readonly maxBodyBytes?: number;
  /** Serve deterministic-only results while the model keeps failing. Default enabled; `false` disables. */
  readonly circuitBreaker?: CircuitBreakerOptions | false;
  /** Cross-origin access. Default: same-origin only (no CORS headers). */
  readonly cors?: CorsOptions;
  /** Called for unexpected internal errors (log them). Must not throw. */
  readonly onError?: (error: unknown, context: { readonly requestId: string }) => void;
  /** Clock. Default `Date.now`. */
  readonly now?: () => number;
}

/** A Web-standard request handler (Next.js route handlers, Hono, Bun, Deno, Workers). @public */
export type PragmaHandler = (request: Request) => Promise<Response>;

/* -------------------------------------------------------------------------- */
/* Request body                                                               */
/* -------------------------------------------------------------------------- */

const bodySchema = z.object({
  protocolVersion: z.string().max(16),
  resource: z.string().min(1).max(128),
  instruction: z.string().max(10_000),
  currentState: z.unknown().optional(),
  timezone: z.string().max(64).optional(),
  schema: z.unknown().optional(),
});

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** HTTP status for an `error` interpretation result. */
const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  PARSE_ERROR: 400,
  LIMIT_EXCEEDED: 400,
  VALIDATION_ERROR: 422,
  UNKNOWN_FIELD: 422,
  UNKNOWN_RESOURCE: 422,
  INVALID_OPERATOR: 422,
  INVALID_VALUE: 422,
  UNSUPPORTED_PROTOCOL_VERSION: 400,
  UNAUTHORIZED: 502, // the *model provider* rejected our credentials
  MODEL_ERROR: 502,
  MODEL_OUTPUT_INVALID: 502,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  ABORTED: 499,
  INTERNAL_ERROR: 500,
};

const MODEL_FAILURE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'MODEL_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
]);

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create the Pragma HTTP endpoint.
 *
 * POST `{ protocolVersion, resource, instruction, currentState?, timezone? }`.
 * - A completed interpretation (`ok`, `needs_clarification`, `unsupported`) is `200`
 *   with the `InterpretResult` as JSON.
 * - Transport, validation and upstream failures are RFC 9457
 *   `application/problem+json` with a stable `code` and the `requestId`.
 *
 * Configuration problems throw at construction time.
 *
 * @public
 */
export function createPragmaHandler(options: PragmaHandlerOptions): PragmaHandler {
  const now = options.now ?? Date.now;
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0)
    throw new PragmaConfigError('CONFIG_ERROR', 'maxBodyBytes must be a positive integer.');
  if (Object.keys(options.schemas).length === 0 && options.allowClientSchema !== true) {
    throw new PragmaConfigError(
      'CONFIG_ERROR',
      'createPragmaHandler requires at least one schema (or allowClientSchema: true).',
    );
  }

  const interpreter: ModelInterpreter | undefined =
    options.interpreter ??
    (options.provider ? createModelInterpreter({ provider: options.provider }) : undefined);
  const breaker =
    options.circuitBreaker === false || !interpreter
      ? undefined
      : new CircuitBreaker(options.circuitBreaker ?? {}, now);
  // One interpretation cache shared by all engines (keys include the schema hash).
  const sharedCache = options.engine?.cache ?? new MemoryCache<Proposal>({ maxEntries: 1000 });

  const build = (schema: TableSchema | ResolvedSchema, withModel: boolean): Engine =>
    createEngine({
      ...options.engine,
      schema,
      cache: sharedCache,
      now,
      ...(withModel && interpreter ? { interpreter } : { mode: 'deterministic-only' as const }),
    });

  interface EnginePair {
    readonly full: Engine;
    readonly deterministic: Engine;
  }
  const registered = new Map<string, EnginePair>();
  for (const [resource, schema] of Object.entries(options.schemas)) {
    const resolved = 'fieldsById' in schema ? schema : defineSchema(schema);
    if (resolved.resource !== resource) {
      throw new PragmaConfigError(
        'CONFIG_ERROR',
        `Schema registered as "${resource}" declares resource "${resolved.resource}".`,
      );
    }
    registered.set(resource, {
      full: build(resolved, true),
      deterministic: build(resolved, false),
    });
  }
  const clientEngines = new Map<string, EnginePair>(); // by schema hash, bounded

  return async function pragmaHandler(request: Request): Promise<Response> {
    const incomingId = request.headers.get('x-request-id');
    const requestId =
      incomingId !== null && REQUEST_ID.test(incomingId) ? incomingId : randomId('req');
    const cors = corsHeaders(options.cors, request.headers.get('origin'));

    try {
      if (request.method === 'OPTIONS') {
        if (!cors)
          return problem(405, 'VALIDATION_ERROR', 'Method not allowed.', requestId, undefined, {
            allow: 'POST',
          });
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type, authorization, x-request-id',
            'access-control-max-age': String(options.cors?.maxAge ?? 600),
          },
        });
      }
      if (request.method !== 'POST')
        return problem(405, 'VALIDATION_ERROR', 'Method not allowed; use POST.', requestId, cors, {
          allow: 'POST',
        });

      const contentType = request.headers.get('content-type') ?? '';
      if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
        return problem(
          415,
          'VALIDATION_ERROR',
          'Content-Type must be application/json.',
          requestId,
          cors,
        );
      }

      const text = await readBody(request, maxBodyBytes);
      if (text === undefined)
        return problem(
          413,
          'LIMIT_EXCEEDED',
          `Request body exceeds ${maxBodyBytes} bytes.`,
          requestId,
          cors,
        );

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return problem(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.', requestId, cors);
      }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 10).map((i) =>
          createIssue('VALIDATION_ERROR', {
            message: `Invalid request at ${i.path.join('.') || '(root)'}: ${i.message}`,
            messageKey: 'request.invalid',
            path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
          }),
        );
        return problem(
          422,
          'VALIDATION_ERROR',
          'The request body is invalid.',
          requestId,
          cors,
          undefined,
          issues,
        );
      }
      const body = parsed.data;
      if (body.protocolVersion.split('.')[0] !== PROTOCOL_VERSION.split('.')[0]) {
        return problem(
          400,
          'UNSUPPORTED_PROTOCOL_VERSION',
          `Protocol ${body.protocolVersion} is not supported; this server speaks ${PROTOCOL_VERSION}.`,
          requestId,
          cors,
        );
      }
      if (body.timezone !== undefined && !isValidTimeZone(body.timezone)) {
        return problem(
          422,
          'VALIDATION_ERROR',
          `Unknown timezone "${body.timezone}".`,
          requestId,
          cors,
        );
      }

      const context: RequestContext = { request, requestId, resource: body.resource };

      if (options.authorize) {
        const decision = await options.authorize(context);
        if (decision !== true) {
          const status = typeof decision === 'object' ? (decision.status ?? 403) : 403;
          const message =
            typeof decision === 'object' && decision.message ? decision.message : 'Not authorized.';
          return problem(status, 'UNAUTHORIZED', message, requestId, cors);
        }
      }
      if (options.rateLimit) {
        const limit = await options.rateLimit(context);
        if (!limit.allowed) {
          const retryAfter = Math.max(1, Math.ceil(limit.retryAfterSeconds ?? 1));
          return problem(429, 'RATE_LIMITED', 'Too many requests.', requestId, cors, {
            'retry-after': String(retryAfter),
          });
        }
      }

      const engines = resolveEngines(body.resource, body.schema);
      if ('problem' in engines)
        return problem(
          engines.problem.status,
          engines.problem.code,
          engines.problem.message,
          requestId,
          cors,
          undefined,
          engines.problem.issues,
        );

      const useModel = breaker ? breaker.allowModel() : true;
      const engine = useModel ? engines.full : engines.deterministic;
      const currentState =
        body.currentState ??
        (body.timezone
          ? { ...engine.initialQuery(), context: { timezone: body.timezone, weekStartsOn: 1 } }
          : undefined);

      const result = await engine.interpret(body.instruction, {
        currentState,
        requestId,
        signal: request.signal,
      });

      if (breaker && useModel && result.meta.parser === 'llm') {
        if (result.status === 'error' && result.errors.some((e) => MODEL_FAILURE_CODES.has(e.code)))
          breaker.recordFailure();
        else breaker.recordSuccess();
      }

      const extra: Record<string, string> = {};
      if (!useModel) extra['x-pragma-degraded'] = 'model-unavailable';

      if (result.status === 'error') {
        const first = result.errors[0];
        const code = first?.code ?? 'INTERNAL_ERROR';
        const status = ERROR_STATUS[code] ?? 500;
        const headers = code === 'RATE_LIMITED' ? { ...extra, 'retry-after': '1' } : extra;
        return problem(
          status,
          code,
          first?.message ?? 'The request failed.',
          requestId,
          cors,
          headers,
          result.errors,
        );
      }
      return json200(result, requestId, { ...cors, ...extra });
    } catch (error) {
      try {
        options.onError?.(error, { requestId });
      } catch {
        // never let a logging hook break the response
      }
      const issue = toIssue(error);
      return problem(500, issue.code, issue.message, requestId, cors);
    }
  };

  function resolveEngines(
    resource: string,
    clientSchema: unknown,
  ):
    | EnginePair
    | {
        problem: {
          status: number;
          code: ErrorCode;
          message: string;
          issues?: readonly PragmaIssue[];
        };
      } {
    const known = registered.get(resource);
    if (known) return known;
    if (options.allowClientSchema !== true || clientSchema === undefined) {
      return {
        problem: {
          status: 404,
          code: 'UNKNOWN_RESOURCE',
          message: `Unknown resource "${resource}".`,
        },
      };
    }
    let resolved: ResolvedSchema;
    try {
      resolved = defineSchema(clientSchema as TableSchema);
    } catch (error) {
      const issues = isPragmaError(error) ? error.issues : [toIssue(error)];
      return {
        problem: {
          status: 422,
          code: 'SCHEMA_ERROR',
          message: 'The provided schema is invalid.',
          issues,
        },
      };
    }
    if (resolved.resource !== resource) {
      return {
        problem: {
          status: 422,
          code: 'SCHEMA_ERROR',
          message: `Schema resource "${resolved.resource}" does not match "${resource}".`,
        },
      };
    }
    const cached = clientEngines.get(resolved.hash);
    if (cached) return cached;
    const pair = { full: build(resolved, true), deterministic: build(resolved, false) };
    if (clientEngines.size >= 100) {
      const oldest = clientEngines.keys().next().value;
      if (oldest !== undefined) clientEngines.delete(oldest);
    }
    clientEngines.set(resolved.hash, pair);
    return pair;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

function json200(
  result: InterpretResult,
  requestId: string,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      ...headers,
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
    },
  });
}

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  499: 'Client Closed Request',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Build an RFC 9457 problem response. `issues` are serializable and never
 * include stack traces or upstream bodies.
 *
 * @public
 */
export function problem(
  status: number,
  code: ErrorCode,
  detail: string,
  requestId: string,
  cors?: Record<string, string>,
  extraHeaders?: Record<string, string>,
  issues?: readonly PragmaIssue[],
): Response {
  const body = {
    type: `https://pragma.dev/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    requestId,
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_HEADERS,
      ...cors,
      ...extraHeaders,
      'content-type': 'application/problem+json; charset=utf-8',
      'x-request-id': requestId,
    },
  });
}

function corsHeaders(
  cors: CorsOptions | undefined,
  origin: string | null,
): Record<string, string> | undefined {
  if (!cors || origin === null) return undefined;
  const allowed = typeof cors.origin === 'string' ? [cors.origin] : cors.origin;
  if (!allowed.includes(origin)) return undefined;
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    ...(cors.credentials === true ? { 'access-control-allow-credentials': 'true' } : {}),
  };
}

/** Read the body up to `limit` bytes; `undefined` when it is larger. */
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
