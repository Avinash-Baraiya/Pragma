import {
  createIssue,
  isAbortError,
  PragmaTransportError,
  PROTOCOL_VERSION,
  type ErrorCode,
  type InterpretResult,
  type PragmaIssue,
} from '@avinash-baraiya/pragma-core';
import type {
  MaybePromise,
  ModelInterpretation,
  ModelInterpreter,
  ModelInterpretRequest,
} from '@avinash-baraiya/pragma-interpreter';

/** Body posted to a Pragma server handler. @public */
export interface RemoteInterpretRequestBody {
  readonly protocolVersion: string;
  readonly resource: string;
  readonly instruction: string;
  readonly currentState: unknown;
  readonly timezone: string;
}

/** @public */
export interface RemoteInterpreterOptions {
  /** Endpoint served by `createPragmaHandler`, e.g. `/api/pragma`. */
  readonly url: string;
  /** Static headers, or a function returning them per request (e.g. a fresh auth token). */
  readonly headers?:
    Readonly<Record<string, string>> | (() => MaybePromise<Readonly<Record<string, string>>>);
  /** Fetch credentials mode. Default `same-origin`. */
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof fetch;
  readonly id?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Browser-side interpreter that delegates model interpretation to a Pragma
 * server (`@avinash-baraiya/pragma-server`), keeping model API keys on the server.
 *
 * The server returns a full interpretation; it is converted back into a proposal
 * so the local engine re-validates and applies it (defence in depth).
 *
 * @public
 */
export function remoteInterpreter(options: RemoteInterpreterOptions): ModelInterpreter {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const id = options.id ?? 'remote';
  return {
    id,
    async interpret(request: ModelInterpretRequest): Promise<ModelInterpretation> {
      const headers =
        typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
      const body: RemoteInterpretRequestBody = {
        protocolVersion: PROTOCOL_VERSION,
        resource: request.schema.resource,
        instruction: request.instruction,
        currentState: request.state,
        timezone: request.timezone,
      };
      let response: Response;
      try {
        response = await doFetch(options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-request-id': request.requestId,
            ...headers,
          },
          body: JSON.stringify(body),
          signal: request.signal,
          credentials: options.credentials ?? 'same-origin',
        });
      } catch (error) {
        if (isAbortError(error) || request.signal.aborted) throw error;
        throw new PragmaTransportError('Could not reach the Pragma server.', {
          cause: error,
          retryable: true,
        });
      }

      const payload = await readJson(response);
      if (!response.ok) throw problemToError(response.status, payload);
      const result = asInterpretResult(payload);
      return toInterpretation(result);
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Convert an RFC 9457 problem+json body into a typed transport error. */
function problemToError(status: number, payload: unknown): PragmaTransportError {
  const problem = (payload ?? {}) as {
    code?: unknown;
    detail?: unknown;
    title?: unknown;
    issues?: unknown;
  };
  const code = typeof problem.code === 'string' ? (problem.code as ErrorCode) : 'TRANSPORT_ERROR';
  const message =
    typeof problem.detail === 'string'
      ? problem.detail
      : typeof problem.title === 'string'
        ? problem.title
        : `The Pragma server returned HTTP ${status}.`;
  const issues = Array.isArray(problem.issues)
    ? (problem.issues as PragmaIssue[])
    : [createIssue(code, { message, messageKey: `error.${code}` })];
  return new PragmaTransportError(message, {
    status,
    code,
    retryable: RETRYABLE_STATUS.has(status),
    issues,
  });
}

function asInterpretResult(payload: unknown): InterpretResult {
  const status = (payload as { status?: unknown } | undefined)?.status;
  const meta = (payload as { meta?: { protocolVersion?: unknown } } | undefined)?.meta;
  if (
    status !== 'ok' &&
    status !== 'needs_clarification' &&
    status !== 'unsupported' &&
    status !== 'error'
  ) {
    throw new PragmaTransportError('The Pragma server returned an unexpected response.', {
      retryable: false,
    });
  }
  const version = typeof meta?.protocolVersion === 'string' ? meta.protocolVersion : undefined;
  if (version !== undefined && version.split('.')[0] !== PROTOCOL_VERSION.split('.')[0]) {
    throw new PragmaTransportError(
      `The Pragma server speaks protocol ${version}; this client supports ${PROTOCOL_VERSION}.`,
      {
        code: 'UNSUPPORTED_PROTOCOL_VERSION',
        retryable: false,
      },
    );
  }
  return payload as InterpretResult;
}

function toInterpretation(result: InterpretResult): ModelInterpretation {
  const meta = {
    ...(result.meta.provider === undefined ? {} : { provider: result.meta.provider }),
    ...(result.meta.model === undefined ? {} : { model: result.meta.model }),
    ...(result.meta.usage === undefined ? {} : { usage: result.meta.usage }),
    ...(result.meta.retries === undefined ? {} : { retries: result.meta.retries }),
  };
  switch (result.status) {
    case 'ok':
      return { proposal: { mutations: result.mutations, ambiguities: [] }, ...meta };
    case 'needs_clarification':
      return { proposal: { mutations: result.partial, ambiguities: result.ambiguities }, ...meta };
    case 'unsupported': {
      const first = result.errors[0];
      return {
        proposal: {
          mutations: [],
          ambiguities: [],
          unsupported: {
            reason: first?.message ?? 'The request is not supported.',
            messageKey: first?.messageKey ?? 'error.UNSUPPORTED_OPERATION',
            suggestions: result.suggestions,
            errors: result.errors,
          },
        },
        ...meta,
      };
    }
    case 'error': {
      const first = result.errors[0];
      throw new PragmaTransportError(first?.message ?? 'The Pragma server reported an error.', {
        code: first?.code ?? 'TRANSPORT_ERROR',
        retryable: first?.retryable ?? false,
        issues: result.errors,
      });
    }
  }
}
