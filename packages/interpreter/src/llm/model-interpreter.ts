import {
  createIssue,
  isAbortError,
  isPragmaError,
  PragmaConfigError,
  PragmaModelError,
  type TokenUsage,
} from '@avinash-baraiya/pragma-core';
import type { ModelInterpretation, ModelInterpreter, ModelInterpretRequest } from '../engine.js';
import {
  extractJson,
  MODEL_OUTPUT_JSON_SCHEMA,
  modelOutputSchema,
  toProposal,
  type ModelOutput,
} from './output.js';
import { buildPrompt } from './prompt.js';
import type { ChatMessage, GenerateResponse, LanguageModelProvider } from './provider.js';

/** @public */
export interface RetryPolicy {
  /** Retries per provider for retryable failures (network, 429, 5xx, timeouts). Default 2. */
  readonly maxRetries?: number;
  /** First backoff delay in ms. Default 250. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 4000. */
  readonly maxDelayMs?: number;
}

/** @public */
export interface ModelInterpreterOptions {
  /** One provider, or an ordered fallback chain tried on retryable failures. */
  readonly provider: LanguageModelProvider | readonly LanguageModelProvider[];
  readonly retry?: RetryPolicy;
  /** Extra attempts that feed validation errors back to the model when its output is malformed. Default 1. */
  readonly maxRepairs?: number;
  /** Default 0. */
  readonly temperature?: number;
  /** Default 2000. */
  readonly maxOutputTokens?: number;
  /** Test hooks. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

/**
 * Build a {@link ModelInterpreter} from one or more language model providers.
 *
 * - Retries retryable failures with exponential backoff and full jitter,
 *   honouring `Retry-After`, bounded by the engine's deadline signal.
 * - Falls back to the next provider when one keeps failing transiently.
 * - When a model answers with malformed output, asks it to repair once.
 *
 * @public
 */
export function createModelInterpreter(options: ModelInterpreterOptions): ModelInterpreter {
  const providers = Array.isArray(options.provider)
    ? [...(options.provider as readonly LanguageModelProvider[])]
    : [options.provider as LanguageModelProvider];
  if (providers.length === 0)
    throw new PragmaConfigError(
      'CONFIG_ERROR',
      'createModelInterpreter requires at least one provider.',
    );
  for (const p of providers) {
    if (typeof (p as Partial<LanguageModelProvider>).generate !== 'function') {
      throw new PragmaConfigError(
        'CONFIG_ERROR',
        'Every provider must implement generate(request).',
      );
    }
  }
  const maxRetries = options.retry?.maxRetries ?? 2;
  const baseDelay = options.retry?.baseDelayMs ?? 250;
  const maxDelay = options.retry?.maxDelayMs ?? 4000;
  const maxRepairs = options.maxRepairs ?? 1;
  const temperature = options.temperature ?? 0;
  const maxOutputTokens = options.maxOutputTokens ?? 2000;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;

  return {
    id: providers.map((p) => p.id).join('>'),
    async interpret(request: ModelInterpretRequest): Promise<ModelInterpretation> {
      const prompt = buildPrompt(request);
      let retries = 0;
      const usage = { inputTokens: 0, outputTokens: 0 };
      let lastError: unknown;

      for (const [index, provider] of providers.entries()) {
        if (index > 0) retries++; // falling back counts as a retry
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (request.signal.aborted)
            throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
          try {
            const { output, model } = await generateValid(provider, prompt, request.signal, usage);
            return {
              proposal: toProposal(output, request.schema, request.ids),
              provider: provider.id,
              ...(model === undefined ? {} : { model }),
              usage: { ...usage },
              retries,
            };
          } catch (error) {
            lastError = error;
            // Re-read the signal: it may have been aborted while the call was in flight.
            if (isAborted(request.signal) || isAbortError(error)) throw error;
            if (!isRetryable(error)) throw error;
            if (attempt === maxRetries) break;
            retries++;
            const hinted = error instanceof PragmaModelError ? error.retryAfterMs : undefined;
            const backoff = Math.min(maxDelay, baseDelay * 2 ** attempt) * random();
            await sleep(Math.min(maxDelay, Math.max(backoff, hinted ?? 0)), request.signal);
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new PragmaModelError('MODEL_ERROR', 'All language model providers failed.');
    },
  };

  async function generateValid(
    provider: LanguageModelProvider,
    prompt: { system: string; user: string },
    signal: AbortSignal,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<{ output: ModelOutput; model: string | undefined }> {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt.user }];
    for (let repair = 0; ; repair++) {
      const response = await callProvider(provider, prompt.system, messages, signal);
      addUsage(usage, response.usage);
      const parsed = parseOutput(response);
      if (parsed.ok) return { output: parsed.output, model: response.model };
      if (repair >= maxRepairs) {
        throw new PragmaModelError(
          'MODEL_OUTPUT_INVALID',
          'The language model returned output that could not be understood.',
          {
            retryable: false,
            issues: [
              createIssue('MODEL_OUTPUT_INVALID', {
                message: parsed.error,
                messageKey: 'model.invalidOutput',
                retryable: false,
              }),
            ],
          },
        );
      }
      messages.push(
        { role: 'assistant', content: response.text ?? JSON.stringify(response.json ?? null) },
        {
          role: 'user',
          content: `Your previous answer was not valid: ${parsed.error}\nReply again with only the JSON object that matches the schema.`,
        },
      );
    }
  }

  async function callProvider(
    provider: LanguageModelProvider,
    system: string,
    messages: readonly ChatMessage[],
    signal: AbortSignal,
  ): Promise<GenerateResponse> {
    try {
      return await provider.generate({
        system,
        messages,
        jsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
        schemaName: 'table_actions',
        temperature,
        maxOutputTokens,
        signal,
      });
    } catch (error) {
      if (isPragmaError(error) || isAbortError(error)) throw error;
      // Unknown provider failures (e.g. fetch TypeError) are treated as transient network errors.
      throw new PragmaModelError('MODEL_ERROR', `Provider "${provider.id}" failed.`, {
        cause: error,
        retryable: true,
      });
    }
  }
}

function parseOutput(
  response: GenerateResponse,
): { ok: true; output: ModelOutput } | { ok: false; error: string } {
  let raw: unknown = response.json;
  if (raw === undefined) {
    if (typeof response.text !== 'string' || response.text.trim() === '')
      return { ok: false, error: 'the response was empty' };
    try {
      raw = extractJson(response.text);
    } catch {
      return { ok: false, error: 'the response was not valid JSON' };
    }
  }
  const result = modelOutputSchema.safeParse(raw);
  if (result.success) return { ok: true, output: result.data };
  const details = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, error: details };
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function isRetryable(error: unknown): boolean {
  return isPragmaError(error) && error.retryable;
}

function addUsage(
  total: { inputTokens: number; outputTokens: number },
  usage: TokenUsage | undefined,
): void {
  if (!usage) return;
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
