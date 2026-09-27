import {
  createInitialQuery,
  defineSchema,
  isPragmaError,
  sequentialIds,
  type InterpretResult,
} from '@avinash-baraiya/pragma-core';
import {
  createEngine,
  createModelInterpreter,
  MODEL_OUTPUT_JSON_SCHEMA,
  type GenerateRequest,
  type ModelInterpretRequest,
} from '@avinash-baraiya/pragma-interpreter';
import { describe, expect, it, vi } from 'vitest';
import { instructionOf, mock, mockProvider } from './mock.js';
import { remoteInterpreter } from './remote.js';

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'users',
  fields: [
    { id: 'country', label: 'Country', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'createdAt', label: 'Created At', type: 'datetime' },
  ],
});

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

describe('mockProvider', () => {
  it('answers by rule, falls back, and records calls', async () => {
    const provider = mockProvider({
      rules: [
        { match: /indian/i, output: OUTPUT },
        { match: 'recent', output: (i) => mock.output([mock.search(i)]) },
        {
          match: (i) => i.startsWith('x'),
          output: mock.output([mock.pageSize(5), mock.anyOf([['country', 'eq', 'India']])]),
        },
      ],
    });
    expect((await provider.generate(request())).json).toEqual(OUTPUT);
    const recent = await provider.generate(
      request({ messages: [{ role: 'user', content: '<instruction>\nrecent\n</instruction>' }] }),
    );
    expect(recent.json).toEqual(mock.output([mock.search('recent')]));
    expect(
      (await provider.generate(request({ messages: [{ role: 'user', content: 'xyz' }] }))).json,
    ).toMatchObject({ actions: [{ op: 'setPageSize' }, { op: 'addFilter' }] });
    const other = await provider.generate(
      request({ messages: [{ role: 'user', content: 'profit' }] }),
    );
    expect(other.json).toMatchObject({ unsupported: { reason: expect.any(String) } });
    expect(provider.calls).toEqual(['show Indian users', 'recent', 'xyz', 'profit']);
    expect(instructionOf(request({ messages: [] }))).toBe('');
  });

  it('simulates latency and honours aborts', async () => {
    const provider = mockProvider({ latencyMs: 5, fallback: OUTPUT });
    expect((await provider.generate(request())).json).toEqual(OUTPUT);
    const controller = new AbortController();
    const pending = mockProvider({ latencyMs: 10_000 }).generate(
      request({ signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('drives a full engine offline', async () => {
    const engine = createEngine({
      schema,
      timezone: 'UTC',
      interpreter: createModelInterpreter({
        provider: mockProvider({ rules: [{ match: /indian/i, output: OUTPUT }] }),
      }),
    });
    const res = await engine.interpret('show Indian users, most recent first');
    expect(res.status).toBe('ok');
  });
});

describe('remoteInterpreter', () => {
  const state = createInitialQuery(schema);
  const interpretRequest = (signal = new AbortController().signal): ModelInterpretRequest => ({
    instruction: 'show Indian users',
    schema,
    state,
    now: 0,
    timezone: 'Asia/Kolkata',
    ambiguity: 'ask',
    requestId: 'req-1',
    signal,
    ids: sequentialIds(),
  });
  const meta = {
    requestId: 'req-1',
    parser: 'llm' as const,
    latencyMs: 5,
    schemaHash: 'h',
    engineVersion: '1',
    protocolVersion: '1.0' as const,
    provider: 'anthropic:x',
    model: 'x',
    usage: { inputTokens: 1, outputTokens: 1 },
    retries: 1,
  };

  function serve(result: unknown, init: ResponseInit = {}) {
    return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(result, init)),
    );
  }

  it('posts the instruction with a request id and maps ok results to proposals', async () => {
    const fetch = serve({
      status: 'ok',
      query: state,
      mutations: [{ op: 'nextPage' }],
      explanation: [],
      warnings: [],
      meta,
    } satisfies InterpretResult);
    const remote = remoteInterpreter({
      url: '/api/pragma',
      headers: () => ({ authorization: 'Bearer t' }),
      fetch,
    });
    const out = await remote.interpret(interpretRequest());
    expect(out).toEqual({
      proposal: { mutations: [{ op: 'nextPage' }], ambiguities: [] },
      provider: 'anthropic:x',
      model: 'x',
      usage: { inputTokens: 1, outputTokens: 1 },
      retries: 1,
    });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({
      'x-request-id': 'req-1',
      authorization: 'Bearer t',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      protocolVersion: '1.0',
      resource: 'users',
      instruction: 'show Indian users',
      timezone: 'Asia/Kolkata',
    });
    expect(init.credentials).toBe('same-origin');
  });

  it('maps clarification and unsupported results, preserving issues', async () => {
    const amb = { id: 'a', kind: 'intent', message: 'Which?', messageKey: 'k', options: [] };
    const clar = await remoteInterpreter({
      url: '/x',
      fetch: serve({
        status: 'needs_clarification',
        ambiguities: [amb],
        partial: [{ op: 'clearSort' }],
        warnings: [],
        meta,
      }),
    }).interpret(interpretRequest());
    expect(clar.proposal).toEqual({ mutations: [{ op: 'clearSort' }], ambiguities: [amb] });
    const issue = {
      code: 'UNKNOWN_FIELD',
      message: 'Unknown field "wage".',
      messageKey: 'field.unknown',
      retryable: false,
    };
    const uns = await remoteInterpreter({
      url: '/x',
      fetch: serve({
        status: 'unsupported',
        errors: [issue],
        suggestions: [],
        meta: { ...meta, provider: undefined },
      }),
    }).interpret(interpretRequest());
    expect(uns.proposal.unsupported).toMatchObject({
      reason: 'Unknown field "wage".',
      errors: [issue],
    });
  });

  it('turns server error results and problem+json responses into transport errors', async () => {
    const errorResult = remoteInterpreter({
      url: '/x',
      fetch: serve({
        status: 'error',
        errors: [{ code: 'RATE_LIMITED', message: 'slow', messageKey: 'k', retryable: true }],
        meta,
      }),
    });
    await expect(errorResult.interpret(interpretRequest())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    const problem = remoteInterpreter({
      url: '/x',
      fetch: serve(
        {
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'Rate limit exceeded.',
        },
        { status: 429 },
      ),
    });
    const error = await problem.interpret(interpretRequest()).catch((e: unknown) => e);
    expect(isPragmaError(error) && error).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryable: true,
      message: 'Rate limit exceeded.',
    });
    const opaque = remoteInterpreter({
      url: '/x',
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
    });
    await expect(opaque.interpret(interpretRequest())).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      status: 502,
      retryable: true,
    });
  });

  it('rejects unexpected payloads and incompatible protocol versions', async () => {
    await expect(
      remoteInterpreter({ url: '/x', fetch: serve({ hello: 'world' }) }).interpret(
        interpretRequest(),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_ERROR', retryable: false });
    await expect(
      remoteInterpreter({
        url: '/x',
        fetch: serve({ status: 'ok', mutations: [], meta: { ...meta, protocolVersion: '2.0' } }),
      }).interpret(interpretRequest()),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL_VERSION' });
  });

  it('distinguishes network failures from caller aborts', async () => {
    await expect(
      remoteInterpreter({
        url: '/x',
        fetch: () => Promise.reject(new TypeError('offline')),
      }).interpret(interpretRequest()),
    ).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      retryable: true,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      remoteInterpreter({
        url: '/x',
        fetch: () => Promise.reject(new DOMException('a', 'AbortError')),
      }).interpret(interpretRequest(controller.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('works end-to-end inside a client engine that re-validates', async () => {
    const fetch = serve({
      status: 'ok',
      query: state,
      mutations: [
        {
          op: 'addFilter',
          node: { type: 'condition', id: 'x', field: 'country', operator: 'eq', value: 'India' },
        },
      ],
      explanation: [],
      warnings: [],
      meta,
    });
    const engine = createEngine({
      schema,
      timezone: 'UTC',
      interpreter: remoteInterpreter({ url: '/api/pragma', fetch }),
    });
    const res = await engine.interpret('show Indian users');
    expect(res.status === 'ok' && res.explanation[0]?.text).toBe('Country = "India"');
    const tampered = serve({
      status: 'ok',
      query: state,
      mutations: [
        {
          op: 'addFilter',
          node: { type: 'condition', id: 'x', field: 'salary', operator: 'gt', value: 1 },
        },
      ],
      explanation: [],
      warnings: [],
      meta,
    });
    const res2 = await createEngine({
      schema,
      interpreter: remoteInterpreter({ url: '/x', fetch: tampered }),
    }).interpret('show rich users');
    expect(res2.status === 'unsupported' && res2.errors[0]?.code).toBe('UNKNOWN_FIELD');
  });
});
