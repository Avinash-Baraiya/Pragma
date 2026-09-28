import {
  MODEL_OUTPUT_JSON_SCHEMA,
  type GenerateRequest,
} from '@avinash-baraiya/pragma-interpreter';
import { describe, expect, it, vi } from 'vitest';
import { gemini } from './gemini.js';

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    system: 'SYSTEM PROMPT',
    messages: [{ role: 'user', content: '<instruction>\nshow Indian users\n</instruction>' }],
    jsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
    schemaName: 'table_actions',
    temperature: 0,
    maxOutputTokens: 1024,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

// Shape observed from the live Interactions API.
const interaction = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'v1_abc',
  status: 'completed',
  model: 'gemini-3.5-flash-lite',
  steps: [
    { type: 'thought', signature: 'x' },
    { type: 'model_output', content: [{ type: 'text', text }] },
  ],
  usage: { total_input_tokens: 1500, total_output_tokens: 40, total_cached_tokens: 1200 },
  ...extra,
});

describe('gemini (Interactions API)', () => {
  it('sends system instruction, structured output schema and generation config', async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(json(interaction('{"actions":[]}'))),
    );
    const provider = gemini({
      model: 'gemini-3.5-flash-lite',
      apiKey: 'k',
      thinkingLevel: 'minimal',
      fetch,
    });
    const res = await provider.generate(request());
    expect(res).toEqual({
      text: '{"actions":[]}',
      model: 'gemini-3.5-flash-lite',
      usage: { inputTokens: 1500, outputTokens: 40, cachedInputTokens: 1200 },
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'k' });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      system_instruction: 'SYSTEM PROMPT',
      input: '<instruction>\nshow Indian users\n</instruction>',
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
      generation_config: { temperature: 0, max_output_tokens: 1024, thinking_level: 'minimal' },
    });
    expect(provider.id).toBe('gemini:gemini-3.5-flash-lite');
  });

  it('folds repair rounds into a single input and concatenates text parts', async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        json({
          status: 'completed',
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'text', text: '{"a":' },
                { type: 'text', text: '1}' },
              ],
            },
          ],
        }),
      ),
    );
    const res = await gemini({
      model: 'm',
      apiKey: 'k',
      baseURL: 'https://proxy.test/v1beta/',
      fetch,
    }).generate(
      request({
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'bad' },
          { role: 'user', content: 'fix it' },
        ],
      }),
    );
    expect(res).toEqual({ text: '{"a":1}' });
    const body = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as { input: string };
    expect(body.input).toBe('User:\nQ\n\nYour previous answer:\nbad\n\nUser:\nfix it');
    expect(fetch.mock.calls[0]![0]).toBe('https://proxy.test/v1beta/interactions');
  });

  it('maps HTTP, network, malformed and incomplete responses to typed errors', async () => {
    const make = (response: Response | Error) =>
      gemini({
        model: 'm',
        apiKey: 'k',
        fetch: () =>
          response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      });
    await expect(
      make(new Response('SECRET', { status: 429, headers: { 'retry-after': '2' } })).generate(
        request(),
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
    await expect(
      make(new Response('no', { status: 403 })).generate(request()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(make(new TypeError('offline')).generate(request())).rejects.toMatchObject({
      code: 'MODEL_ERROR',
      retryable: true,
    });
    await expect(
      make(new Response('<html>', { status: 200 })).generate(request()),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR', retryable: true });
    await expect(
      make(json({ status: 'in_progress', steps: [] })).generate(request()),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR', retryable: true });
    await expect(make(json({ status: 'failed' })).generate(request())).rejects.toMatchObject({
      code: 'MODEL_ERROR',
      retryable: false,
    });
    expect(await make(json({})).generate(request())).toEqual({ text: '' });
  });

  it('propagates aborts and validates configuration', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = gemini({
      model: 'm',
      apiKey: 'k',
      fetch: () => Promise.reject(new DOMException('a', 'AbortError')),
    });
    await expect(provider.generate(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(() => gemini({ model: '', apiKey: 'k' })).toThrow(/model is required/);
    expect(() => gemini({ model: 'm', apiKey: '' })).toThrow(/apiKey is required/);
  });
});
