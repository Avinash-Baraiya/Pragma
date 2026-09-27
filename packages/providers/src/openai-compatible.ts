import { isAbortError, PragmaConfigError, PragmaModelError } from '@avinash-baraiya/pragma-core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelProvider,
} from '@avinash-baraiya/pragma-interpreter';
import { httpError, networkError } from './http-errors.js';

/** @public */
export interface OpenAICompatibleOptions {
  /** API base URL including the version segment, e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`. */
  readonly baseURL: string;
  /** Model name as the server expects it. */
  readonly model: string;
  /** Sent as `Authorization: Bearer <apiKey>`. Omit for local servers that need no auth. */
  readonly apiKey?: string;
  /** Extra headers (e.g. `OpenAI-Organization`, gateway routing headers). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * How to request structured output:
   * - `json_schema` (default): `response_format: { type: "json_schema", strict: true }`;
   * - `json_object`: JSON mode, for servers without schema support;
   * - `none`: rely on the prompt only.
   */
  readonly structuredOutput?: 'json_schema' | 'json_object' | 'none';
  /** Parameter name for the output-token limit. Default `max_tokens`; some newer models require `max_completion_tokens`. */
  readonly maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /** Whether to send `temperature` (some reasoning models reject it). Default `true`. */
  readonly sendTemperature?: boolean;
  /** Provider id used in metadata and errors. Default `openai-compatible:<model>`. */
  readonly id?: string;
  /** Custom fetch (proxies, instrumentation, tests). Default global `fetch`. */
  readonly fetch?: typeof fetch;
}

interface ChatCompletionResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null; readonly refusal?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  };
}

/**
 * Provider for any server implementing the OpenAI Chat Completions API:
 * OpenAI, Azure OpenAI-compatible gateways, OpenRouter, Groq, Together, Fireworks,
 * Ollama, vLLM, LM Studio, LiteLLM and others.
 *
 * Server-side only: never ship API keys to browsers.
 *
 * @public
 */
export function openAICompatible(options: OpenAICompatibleOptions): LanguageModelProvider {
  if (!options.baseURL || !/^https?:\/\//.test(options.baseURL)) {
    throw new PragmaConfigError(
      'CONFIG_ERROR',
      'openAICompatible: baseURL must be an http(s) URL.',
    );
  }
  if (!options.model)
    throw new PragmaConfigError('CONFIG_ERROR', 'openAICompatible: model is required.');
  const id = options.id ?? `openai-compatible:${options.model}`;
  const endpoint = `${options.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const doFetch = options.fetch ?? globalThis.fetch;
  const mode = options.structuredOutput ?? 'json_schema';

  return {
    id,
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        [options.maxTokensParam ?? 'max_tokens']: request.maxOutputTokens,
      };
      if (options.sendTemperature !== false) body['temperature'] = request.temperature;
      if (mode === 'json_schema') {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.jsonSchema, strict: true },
        };
      } else if (mode === 'json_object') {
        body['response_format'] = { type: 'json_object' };
      }

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
            ...options.headers,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        if (isAbortError(error) || request.signal.aborted) throw error;
        throw networkError(id, error);
      }

      if (!response.ok) {
        // Drain the body so the connection can be reused; its content is not surfaced.
        await response.text().catch(() => undefined);
        throw httpError(id, response.status, response.headers);
      }

      let data: ChatCompletionResponse;
      try {
        data = (await response.json()) as ChatCompletionResponse;
      } catch (error) {
        throw new PragmaModelError('MODEL_ERROR', `${id}: the response was not valid JSON.`, {
          cause: error,
          retryable: true,
        });
      }

      const choice = data.choices?.[0];
      if (choice?.message?.refusal) {
        throw new PragmaModelError('MODEL_OUTPUT_INVALID', `${id}: the model declined to answer.`, {
          retryable: false,
        });
      }
      if (choice?.finish_reason === 'length') {
        throw new PragmaModelError(
          'MODEL_OUTPUT_INVALID',
          `${id}: the output was truncated; increase maxOutputTokens.`,
          { retryable: false },
        );
      }
      const text = choice?.message?.content ?? '';
      return {
        text,
        ...(data.model ? { model: data.model } : {}),
        ...(data.usage
          ? {
              usage: {
                inputTokens: data.usage.prompt_tokens ?? 0,
                outputTokens: data.usage.completion_tokens ?? 0,
                ...(data.usage.prompt_tokens_details?.cached_tokens
                  ? { cachedInputTokens: data.usage.prompt_tokens_details.cached_tokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}
