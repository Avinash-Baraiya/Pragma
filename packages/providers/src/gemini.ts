import { isAbortError, PragmaConfigError, PragmaModelError } from '@avinash-baraiya/pragma-core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelProvider,
} from '@avinash-baraiya/pragma-interpreter';
import { httpError, networkError } from './http-errors.js';

/** @public */
export interface GeminiProviderOptions {
  /** Gemini model id, e.g. `gemini-3.5-flash-lite`. */
  readonly model: string;
  /** Gemini API key (sent as `x-goog-api-key`). Server-side only. */
  readonly apiKey: string;
  /** Default `https://generativelanguage.googleapis.com/v1beta`. */
  readonly baseURL?: string;
  /** Optional thinking level (`minimal`, `low`, `medium`, `high`) for models that support it. */
  readonly thinkingLevel?: string;
  /** Provider id used in metadata and errors. Default `gemini:<model>`. */
  readonly id?: string;
  /** Custom fetch (proxies, instrumentation, tests). */
  readonly fetch?: typeof fetch;
}

interface InteractionResponse {
  readonly status?: string;
  readonly model?: string;
  readonly steps?: readonly {
    readonly type?: string;
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[];
  readonly usage?: {
    readonly total_input_tokens?: number;
    readonly total_output_tokens?: number;
    readonly total_cached_tokens?: number;
  };
}

/**
 * Provider for Google Gemini through the Gemini **Interactions API**
 * (`POST /v1beta/interactions`), which Google recommends for current models and
 * which is the only generation path available to some newer API keys.
 *
 * Uses native structured output (`response_format` with a JSON schema) and a
 * system instruction. Server-side only: never ship API keys to browsers.
 *
 * @public
 */
export function gemini(options: GeminiProviderOptions): LanguageModelProvider {
  if (!options.model) throw new PragmaConfigError('CONFIG_ERROR', 'gemini: model is required.');
  if (!options.apiKey) throw new PragmaConfigError('CONFIG_ERROR', 'gemini: apiKey is required.');
  const id = options.id ?? `gemini:${options.model}`;
  const endpoint = `${(options.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/interactions`;
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    id,
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const body = {
        model: options.model,
        system_instruction: request.system,
        input: toInput(request),
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: request.jsonSchema,
        },
        generation_config: {
          temperature: request.temperature,
          max_output_tokens: request.maxOutputTokens,
          ...(options.thinkingLevel ? { thinking_level: options.thinkingLevel } : {}),
        },
      };

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        if (isAbortError(error) || request.signal.aborted) throw error;
        throw networkError(id, error);
      }
      if (!response.ok) {
        await response.text().catch(() => undefined);
        throw httpError(id, response.status, response.headers);
      }

      let data: InteractionResponse;
      try {
        data = (await response.json()) as InteractionResponse;
      } catch (error) {
        throw new PragmaModelError('MODEL_ERROR', `${id}: the response was not valid JSON.`, {
          cause: error,
          retryable: true,
        });
      }
      if (data.status !== undefined && data.status !== 'completed') {
        throw new PragmaModelError(
          'MODEL_ERROR',
          `${id}: the interaction did not complete (${data.status}).`,
          {
            retryable: data.status === 'in_progress',
          },
        );
      }

      let text = '';
      for (const step of data.steps ?? []) {
        if (step.type !== 'model_output') continue;
        for (const part of step.content ?? [])
          if (part.type === 'text' && part.text) text += part.text;
      }
      const usage = data.usage;
      return {
        text,
        ...(data.model ? { model: data.model } : {}),
        ...(usage
          ? {
              usage: {
                inputTokens: usage.total_input_tokens ?? 0,
                outputTokens: usage.total_output_tokens ?? 0,
                ...(usage.total_cached_tokens
                  ? { cachedInputTokens: usage.total_cached_tokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}

/**
 * The first request is a single user message. Repair rounds (previous answer +
 * feedback) are folded into one input so they work without relying on a
 * multi-turn input format.
 */
function toInput(request: GenerateRequest): string {
  if (request.messages.length === 1) return request.messages[0]?.content ?? '';
  return request.messages
    .map((m) => `${m.role === 'assistant' ? 'Your previous answer' : 'User'}:\n${m.content}`)
    .join('\n\n');
}
