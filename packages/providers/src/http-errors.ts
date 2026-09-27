import { PragmaModelError } from '@pragma/core';

/**
 * Parse a `Retry-After` (seconds or HTTP date) or `retry-after-ms` header into
 * milliseconds. Returns `undefined` when absent or unparseable.
 *
 * @internal
 */
export function parseRetryAfter(
  headers: Headers | Record<string, string | undefined> | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!headers) return undefined;
  const get = (name: string): string | undefined =>
    headers instanceof Headers
      ? (headers.get(name) ?? undefined)
      : (headers[name] ?? headers[name.toLowerCase()] ?? undefined);
  const ms = get('retry-after-ms');
  if (ms !== undefined && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  const value = get('retry-after');
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Map an HTTP failure from a model API to a {@link PragmaModelError} with an
 * accurate `retryable` flag. The response body is never included in the message
 * (it may echo prompt content); only the status and provider id are.
 *
 * @internal
 */
export function httpError(
  providerId: string,
  status: number,
  headers?: Headers | Record<string, string | undefined>,
  cause?: unknown,
): PragmaModelError {
  const retryAfterMs = parseRetryAfter(headers);
  const base = {
    status,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(cause === undefined ? {} : { cause }),
  };
  if (status === 401 || status === 403) {
    return new PragmaModelError(
      'UNAUTHORIZED',
      `${providerId}: authentication with the model provider failed (HTTP ${status}).`,
      { ...base, retryable: false },
    );
  }
  if (status === 429) {
    return new PragmaModelError(
      'RATE_LIMITED',
      `${providerId}: rate limited by the model provider (HTTP 429).`,
      { ...base, retryable: true },
    );
  }
  const retryable = status === 408 || status === 409 || status >= 500;
  return new PragmaModelError(
    'MODEL_ERROR',
    `${providerId}: the model provider returned HTTP ${status}.`,
    { ...base, retryable },
  );
}

/** Network-level failure (DNS, connection reset, TLS). @internal */
export function networkError(providerId: string, cause: unknown): PragmaModelError {
  return new PragmaModelError('MODEL_ERROR', `${providerId}: could not reach the model provider.`, {
    cause,
    retryable: true,
  });
}
