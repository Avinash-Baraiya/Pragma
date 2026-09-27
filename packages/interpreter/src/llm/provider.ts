import type { TokenUsage } from '@avinash-baraiya/pragma-core';

/** @public */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * A single structured-generation request. Providers should use their native
 * structured-output mechanism (JSON schema response format, forced tool call, ...)
 * with `jsonSchema`, and fall back to plain JSON text when unavailable.
 *
 * @public
 */
export interface GenerateRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** JSON Schema (draft 2020-12 subset) the output must satisfy. */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  /** Identifier for the schema (e.g. tool / response-format name). */
  readonly schemaName: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
}

/** @public */
export interface GenerateResponse {
  /** Parsed structured output, when the provider returns it natively. */
  readonly json?: unknown;
  /** Raw text output; parsed as JSON when `json` is absent. */
  readonly text?: string;
  readonly usage?: TokenUsage;
  /** Model that actually answered (may differ from the requested alias). */
  readonly model?: string;
}

/**
 * Minimal contract every model integration implements. Any model — hosted,
 * self-hosted or custom — can be plugged in by implementing `generate`.
 *
 * Implementations must reject with `PragmaModelError` (or `PragmaTimeoutError`)
 * and set `retryable` / `status` / `retryAfterMs` accurately so the interpreter
 * can retry and fall back correctly. They must honour `signal`.
 *
 * @public
 */
export interface LanguageModelProvider {
  readonly id: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

/**
 * Wrap a plain function as a provider.
 *
 * @example
 * ```ts
 * const provider = customProvider('my-gateway', async (req) => {
 *   const res = await fetch(url, { method: 'POST', body: JSON.stringify(req), signal: req.signal });
 *   return { text: await res.text() };
 * });
 * ```
 *
 * @public
 */
export function customProvider(
  id: string,
  generate: (request: GenerateRequest) => Promise<GenerateResponse>,
): LanguageModelProvider {
  return { id, generate };
}
