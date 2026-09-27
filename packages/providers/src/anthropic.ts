import Anthropic from '@anthropic-ai/sdk';
import { PragmaConfigError, PragmaModelError } from '@avinash-baraiya/pragma-core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelProvider,
} from '@avinash-baraiya/pragma-interpreter';
import { httpError, networkError } from './http-errors.js';

/** @public */
export interface AnthropicProviderOptions {
  /** Claude model id, e.g. `claude-opus-5`. Required: model choice is a deliberate cost/quality decision. */
  readonly model: string;
  /** Pre-configured client (custom base URL, proxy, platform client). Created from `apiKey`/environment when omitted. */
  readonly client?: Anthropic;
  /** API key; defaults to the SDK's environment resolution (`ANTHROPIC_API_KEY`, ...). */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Optional effort level (`output_config.effort`) for models that support it. */
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Provider id used in metadata and errors. Default `anthropic:<model>`. */
  readonly id?: string;
}

/**
 * Provider for Claude via the official Anthropic SDK (`@anthropic-ai/sdk`, an
 * optional peer dependency).
 *
 * Uses native structured outputs (`output_config.format`) so the response is
 * schema-valid JSON. Sampling parameters are not sent (current models reject
 * them), and the SDK's own retries are disabled because the Pragma interpreter
 * owns retry, backoff and fallback.
 *
 * Server-side only: never ship API keys to browsers.
 *
 * @public
 */
export function anthropic(options: AnthropicProviderOptions): LanguageModelProvider {
  if (!options.model) throw new PragmaConfigError('CONFIG_ERROR', 'anthropic: model is required.');
  const id = options.id ?? `anthropic:${options.model}`;
  let client: Anthropic | undefined = options.client;
  const getClient = (): Anthropic => {
    client ??= new Anthropic({
      maxRetries: 0,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    });
    return client;
  };

  return {
    id,
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      let message: Anthropic.Message;
      try {
        message = await getClient().messages.create(
          {
            model: options.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            output_config: {
              format: { type: 'json_schema', schema: request.jsonSchema },
              ...(options.effort === undefined ? {} : { effort: options.effort }),
            },
          },
          { signal: request.signal, maxRetries: 0 },
        );
      } catch (error) {
        throw mapError(id, error, request.signal);
      }

      if (message.stop_reason === 'refusal') {
        throw new PragmaModelError('MODEL_OUTPUT_INVALID', `${id}: the model declined to answer.`, {
          retryable: false,
        });
      }
      if (message.stop_reason === 'max_tokens') {
        throw new PragmaModelError(
          'MODEL_OUTPUT_INVALID',
          `${id}: the output was truncated; increase maxOutputTokens.`,
          { retryable: false },
        );
      }
      let text = '';
      for (const block of message.content) {
        if (block.type === 'text') text += block.text;
      }
      return {
        text,
        model: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    },
  };
}

function mapError(id: string, error: unknown, signal: AbortSignal): unknown {
  if (error instanceof Anthropic.APIUserAbortError || signal.aborted) {
    return new DOMException('The model request was aborted.', 'AbortError');
  }
  if (error instanceof Anthropic.APIConnectionError) return networkError(id, error);
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return httpError(id, error.status, error.headers as Headers | undefined, error);
  }
  return error;
}
