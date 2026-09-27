import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PragmaHandler } from './handler.js';

/** @public */
export interface NodeHandlerOptions {
  /** Hard cap on bytes buffered from the socket (defence in depth; the handler also checks). Default 1 MiB. */
  readonly maxBufferBytes?: number;
  /** Trust `x-forwarded-proto` / `x-forwarded-host` when building the request URL. Default `false`. */
  readonly trustProxy?: boolean;
}

type NodeRequest = IncomingMessage & { body?: unknown };
type Next = (error?: unknown) => void;

/**
 * Adapt a {@link PragmaHandler} to Node's `http` server and Express/Connect
 * middleware signatures. Works whether or not a body parser already ran.
 *
 * @example
 * ```ts
 * app.post('/api/pragma', toNodeHandler(createPragmaHandler({ ... })));
 * ```
 *
 * @public
 */
export function toNodeHandler(handler: PragmaHandler, options: NodeHandlerOptions = {}): (req: NodeRequest, res: ServerResponse, next?: Next) => void {
  const maxBuffer = options.maxBufferBytes ?? 1_048_576;
  return (req, res, next) => {
    void (async () => {
      const controller = new AbortController();
      // Abort in-flight model calls when the client disconnects before we answer.
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      const body = await readNodeBody(req, maxBuffer);
      const request = new Request(buildUrl(req, options.trustProxy === true), {
        method: req.method ?? 'GET',
        headers: toHeaders(req),
        signal: controller.signal,
        ...(body === undefined || req.method === 'GET' || req.method === 'HEAD' ? {} : { body }),
      });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      if (next) {
        next(error);
        return;
      }
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/problem+json; charset=utf-8');
        res.end(JSON.stringify({ title: 'Internal Server Error', status: 500, code: 'INTERNAL_ERROR' }));
      } else {
        res.end();
      }
    });
  };
}

async function readNodeBody(req: NodeRequest, limit: number): Promise<string | undefined> {
  // A body parser (express.json()) may have consumed the stream already.
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;
    if (size > limit) {
      // Let the handler answer 413: hand it a body that is just over its limit marker.
      return ' '.repeat(limit + 1);
    }
    chunks.push(buffer);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8');
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  // The body is re-encoded, so a stale length or encoding must not be forwarded.
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return headers;
}

function buildUrl(req: IncomingMessage, trustProxy: boolean): string {
  const forwardedProto = trustProxy ? firstHeader(req.headers['x-forwarded-proto']) : undefined;
  const forwardedHost = trustProxy ? firstHeader(req.headers['x-forwarded-host']) : undefined;
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  const proto = forwardedProto ?? (encrypted ? 'https' : 'http');
  const host = forwardedHost ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}${req.url ?? '/'}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim();
}
