import Anthropic from '@anthropic-ai/sdk';
import { PragmaModelError } from '@avinash-baraiya/pragma-core';
import {
  MODEL_OUTPUT_JSON_SCHEMA,
  type GenerateRequest,
} from '@avinash-baraiya/pragma-interpreter';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { aiSdk } from './ai-sdk.js';
import { anthropic } from './anthropic.js';
import { httpError, parseRetryAfter } from './http-errors.js';
import { mock } from './mock.js';
import { openAICompatible } from './openai-compatible.js';

const OUTPUT = mock.output([mock.filter('country', 'eq', 'India'), mock.sort('createdAt', 'desc')]);

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    system: 'SYSTEM PROMPT',
    messages: [{ role: 'user', content: '<instruction>\nshow Indian users\n</instruction>' }],
    jsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
    schemaName: 'table_actions',
    temperature: 0,
    maxOutputTokens: 2000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('http error mapping', () => {
  it('parses Retry-After in seconds, milliseconds and HTTP dates', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '2' }))).toBe(2000);
    expect(parseRetryAfter({ 'retry-after-ms': '150' })).toBe(150);
    expect(
      parseRetryAfter(
        { 'retry-after': 'Wed, 21 Oct 2015 07:28:05 GMT' },
        Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'),
      ),
    ).toBe(5000);
    expect(parseRetryAfter({ 'retry-after': 'soon' })).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter({})).toBeUndefined();
  });

  it('classifies statuses', () => {
    expect(httpError('p', 401)).toMatchObject({
      code: 'UNAUTHORIZED',
      retryable: false,
      status: 401,
    });
    expect(httpError('p', 429, { 'retry-after': '1' })).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterMs: 1000,
    });
    expect(httpError('p', 503)).toMatchObject({ code: 'MODEL_ERROR', retryable: true });
    expect(httpError('p', 408).retryable).toBe(true);
    expect(httpError('p', 400)).toMatchObject({ code: 'MODEL_ERROR', retryable: false });
  });
});

describe('openAICompatible', () => {
  it('sends a strict json_schema request and parses the reply', async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          model: 'gpt-x-2026',
          choices: [{ message: { content: JSON.stringify(OUTPUT) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        }),
      ),
    );
    const provider = openAICompatible({
      baseURL: 'https://api.example.com/v1/',
      model: 'gpt-x',
      apiKey: 'sk-test',
      headers: { 'x-team': 'core' },
      fetch,
    });
    const res = await provider.generate(request());
    expect(res).toEqual({
      text: JSON.stringify(OUTPUT),
      model: 'gpt-x-2026',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-test', 'x-team': 'core' });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-x',
      temperature: 0,
      max_tokens: 2000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'table_actions', strict: true },
      },
    });
    expect((body['messages'] as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user']);
    expect(provider.id).toBe('openai-compatible:gpt-x');
  });

  it('supports JSON mode, prompt-only mode and alternate token/temperature settings', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn((_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      return Promise.resolve(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    });
    await openAICompatible({
      baseURL: 'http://localhost:11434/v1',
      model: 'llama',
      structuredOutput: 'json_object',
      fetch,
    }).generate(request());
    await openAICompatible({
      baseURL: 'http://localhost:11434/v1',
      model: 'llama',
      structuredOutput: 'none',
      maxTokensParam: 'max_completion_tokens',
      sendTemperature: false,
      fetch,
    }).generate(request());
    expect(bodies[0]?.['response_format']).toEqual({ type: 'json_object' });
    expect(bodies[1]).not.toHaveProperty('response_format');
    expect(bodies[1]).not.toHaveProperty('temperature');
    expect(bodies[1]?.['max_completion_tokens']).toBe(2000);
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  });

  it('maps HTTP, network, refusal, truncation and malformed replies to typed errors', async () => {
    const make = (response: Response | Error) =>
      openAICompatible({
        baseURL: 'https://x.test/v1',
        model: 'm',
        fetch: () =>
          response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      });
    await expect(
      make(
        new Response('{"error":"secret prompt echo"}', {
          status: 429,
          headers: { 'retry-after': '3' },
        }),
      ).generate(request()),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 3000,
    });
    await expect(
      make(new Response('no', { status: 401 })).generate(request()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    await expect(make(new TypeError('fetch failed')).generate(request())).rejects.toMatchObject({
      code: 'MODEL_ERROR',
      retryable: true,
    });
    await expect(
      make(jsonResponse({ choices: [{ message: { content: null, refusal: 'no' } }] })).generate(
        request(),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    await expect(
      make(
        jsonResponse({ choices: [{ message: { content: '{"act' }, finish_reason: 'length' }] }),
      ).generate(request()),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    await expect(
      make(new Response('<html>', { status: 200 })).generate(request()),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR', retryable: true });
    expect(await make(jsonResponse({ choices: [] })).generate(request())).toEqual({ text: '' });
  });

  it('never leaks the upstream body into errors', async () => {
    const provider = openAICompatible({
      baseURL: 'https://x.test/v1',
      model: 'm',
      fetch: () => Promise.resolve(new Response('SECRET-BODY', { status: 500 })),
    });
    const error = await provider.generate(request()).catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain('SECRET-BODY');
    expect((error as Error).message).not.toContain('SECRET-BODY');
  });

  it('propagates caller aborts untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = openAICompatible({
      baseURL: 'https://x.test/v1',
      model: 'm',
      fetch: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    });
    await expect(provider.generate(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('validates configuration', () => {
    expect(() => openAICompatible({ baseURL: 'api.example.com', model: 'm' })).toThrow(/baseURL/);
    expect(() => openAICompatible({ baseURL: 'https://x', model: '' })).toThrow(/model/);
  });
});

describe('anthropic (official SDK with stubbed transport)', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: JSON.stringify(OUTPUT) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 80 },
    ...overrides,
  });

  function client(respond: (body: Record<string, unknown>) => Response) {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      bodies.push(body);
      return Promise.resolve(respond(body));
    });
    return { sdk: new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }), fetch, bodies };
  }

  it('requests structured output without sampling parameters', async () => {
    const { sdk, bodies, fetch } = client(() => jsonResponse(message()));
    const res = await anthropic({ model: 'claude-opus-5', client: sdk, effort: 'low' }).generate(
      request(),
    );
    expect(res).toEqual({
      text: JSON.stringify(OUTPUT),
      model: 'claude-opus-5',
      usage: { inputTokens: 900, outputTokens: 80 },
    });
    expect(bodies[0]).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: 'SYSTEM PROMPT',
      output_config: { format: { type: 'json_schema' }, effort: 'low' },
    });
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(bodies[0]).not.toHaveProperty('tool_choice');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps refusals, truncation and API errors', async () => {
    const run = (response: Response) =>
      anthropic({ model: 'claude-opus-5', client: client(() => response).sdk }).generate(request());
    await expect(
      run(jsonResponse(message({ stop_reason: 'refusal', content: [] }))),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', retryable: false });
    await expect(run(jsonResponse(message({ stop_reason: 'max_tokens' })))).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
    });
    await expect(
      run(
        jsonResponse(
          { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
          { status: 429, headers: { 'retry-after': '7', 'content-type': 'application/json' } },
        ),
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 7000 });
    await expect(
      run(
        jsonResponse(
          { type: 'error', error: { type: 'overloaded_error', message: 'x' } },
          { status: 529 },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'MODEL_ERROR',
      retryable: true,
    });
    await expect(
      run(
        jsonResponse(
          { type: 'error', error: { type: 'authentication_error', message: 'x' } },
          { status: 401 },
        ),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('maps connection failures and aborts', async () => {
    const failing = new Anthropic({
      apiKey: 'k',
      maxRetries: 0,
      fetch: () => Promise.reject(new TypeError('socket hang up')),
    });
    await expect(
      anthropic({ model: 'claude-opus-5', client: failing }).generate(request()),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR', retryable: true });
    const controller = new AbortController();
    controller.abort();
    const { sdk } = client(() => jsonResponse(message()));
    await expect(
      anthropic({ model: 'claude-opus-5', client: sdk }).generate(
        request({ signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('creates its own client lazily and validates configuration', () => {
    expect(
      anthropic({ model: 'claude-opus-5', apiKey: 'k', baseURL: 'https://proxy.test' }).id,
    ).toBe('anthropic:claude-opus-5');
    expect(() => anthropic({ model: '' })).toThrow(/model is required/);
  });
});

describe('aiSdk bridge (real generateText with a mock model)', () => {
  const result = (text: string) => ({
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
    warnings: [],
  });

  it('returns the structured object and usage', async () => {
    const model = new MockLanguageModelV4({
      modelId: 'gemini-test',
      doGenerate: result(JSON.stringify(OUTPUT)),
    });
    const provider = aiSdk(model);
    const res = await provider.generate(request());
    expect(res.json).toEqual(OUTPUT);
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
    expect(provider.id).toBe('ai-sdk:gemini-test');
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({
      type: 'json',
      name: 'table_actions',
    });
  });

  it('hands unparseable text to the repair loop and maps API errors', async () => {
    const garbled = aiSdk(new MockLanguageModelV4({ doGenerate: result('not json') }), {
      sendTemperature: false,
    });
    expect(await garbled.generate(request())).toEqual({ text: 'not json' });
    const { APICallError } = await import('ai');
    const rateLimited = aiSdk(
      new MockLanguageModelV4({
        doGenerate: () => {
          throw new APICallError({
            message: 'x',
            url: 'u',
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { 'retry-after': '2' },
            isRetryable: true,
          });
        },
      }),
    );
    await expect(rateLimited.generate(request())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
    const unknown = aiSdk(
      new MockLanguageModelV4({
        doGenerate: () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(unknown.generate(request())).rejects.toMatchObject({ code: 'MODEL_ERROR' });
  });
});

describe('error typing', () => {
  it('produces PragmaModelError instances', () => {
    expect(httpError('p', 500)).toBeInstanceOf(PragmaModelError);
  });
});
