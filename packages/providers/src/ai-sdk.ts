import { PragmaModelError } from '@avinash-baraiya/pragma-core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelProvider,
} from '@avinash-baraiya/pragma-interpreter';
import {
  APICallError,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  type LanguageModel,
} from 'ai';
import { httpError, networkError } from './http-errors.js';

/** @public */
export interface AiSdkProviderOptions {
  /** Provider id used in metadata and errors. Default `ai-sdk:<modelId>`. */
  readonly id?: string;
  /** Whether to send `temperature`. Default `true`. */
  readonly sendTemperature?: boolean;
}

/**
 * Bridge to the Vercel AI SDK (`ai`, an optional peer dependency): any
 * AI SDK language model — Gemini, Mistral, Bedrock, Azure, Cohere, ... — becomes
 * a Pragma provider. AI SDK retries are disabled; the Pragma interpreter owns
 * retry and fallback.
 *
 * @public
 */
export function aiSdk(
  model: LanguageModel,
  options: AiSdkProviderOptions = {},
): LanguageModelProvider {
  const modelId = typeof model === 'string' ? model : model.modelId;
  const id = options.id ?? `ai-sdk:${modelId}`;
  return {
    id,
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      try {
        const result = await generateText({
          model,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          output: Output.object({
            schema: jsonSchema(request.jsonSchema as Parameters<typeof jsonSchema>[0]),
            name: request.schemaName,
          }),
          maxOutputTokens: request.maxOutputTokens,
          ...(options.sendTemperature === false ? {} : { temperature: request.temperature }),
          abortSignal: request.signal,
          maxRetries: 0,
        });
        return {
          json: result.output,
          model: result.finalStep.response.modelId,
          usage: {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
          },
        };
      } catch (error) {
        if (request.signal.aborted)
          throw new DOMException('The model request was aborted.', 'AbortError');
        // Let the interpreter's repair loop see the raw text when the object failed to parse.
        if (NoObjectGeneratedError.isInstance(error) && typeof error.text === 'string')
          return { text: error.text };
        if (APICallError.isInstance(error)) {
          if (typeof error.statusCode === 'number')
            throw httpError(id, error.statusCode, error.responseHeaders, error);
          throw networkError(id, error);
        }
        throw error instanceof PragmaModelError
          ? error
          : new PragmaModelError('MODEL_ERROR', `${id}: the model call failed.`, {
              cause: error,
              retryable: false,
            });
      }
    },
  };
}
