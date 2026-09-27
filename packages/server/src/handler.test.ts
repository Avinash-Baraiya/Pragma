import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PragmaModelError, type TableSchema } from '@pragma/core';
import type { LanguageModelProvider } from '@pragma/interpreter';
import { mock, mockProvider } from '@pragma/providers/mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPragmaHandler, type PragmaHandlerOptions } from './handler.js';
import { toNodeHandler } from './node.js';

const users: TableSchema = {
  schemaVersion: '1',
  resource: 'users',
  fields: [
    { id: 'country', label: 'Country', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'createdAt', label: 'Created At', type: 'datetime' },
    { id: 'salary', label: 'Salary', type: 'number', hidden: true },
  ],
};

const indian = mock.output([mock.filter('country', 'eq', 'India')]);

function handler(options: Partial<PragmaHandlerOptions> = {}) {
  return createPragmaHandler({
    schemas: { users },
    provider: mockProvider({ rules: [{ match: /indian/i, output: indian }] }),
    ...options,
  });
}

function post(
  body: unknown,
  init: { headers?: Record<string, string>; method?: string; raw?: string } = {},
): Request {
  return new Request('https://app.test/api/pragma', {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(init.method === 'GET' ? {} : { body: init.raw ?? JSON.stringify(body) }),
  });
}

const valid = (instruction: string, extra: Record<string, unknown> = {}) => ({
  protocolVersion: '1.0',
  resource: 'users',
  instruction,
  ...extra,
});

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('createPragmaHandler: success', () => {
  it('answers deterministic instructions with 200 and safe headers', async () => {
    const res = await handler()(
      post(valid('age > 25'), { headers: { 'x-request-id': 'req-abc' } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-request-id')).toBe('req-abc');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await json(res);
    expect(body).toMatchObject({
      status: 'ok',
      meta: { parser: 'deterministic', requestId: 'req-abc', protocolVersion: '1.0' },
    });
  });

  it('uses the model for instructions the parser does not cover', async () => {
    const body = await json(await handler()(post(valid('show Indian users'))));
    expect(body).toMatchObject({ status: 'ok', meta: { parser: 'llm', provider: 'mock' } });
  });

  it('returns 200 for unsupported and clarification outcomes', async () => {
    expect(await json(await handler()(post(valid('@salary > 5'))))).toMatchObject({
      status: 'unsupported',
      errors: [{ code: 'UNKNOWN_FIELD' }],
    });
    expect(await json(await handler()(post(valid('recent users'))))).toMatchObject({
      status: 'needs_clarification',
    });
  });

  it('generates a request id when the incoming one is missing or unsafe', async () => {
    const res = await handler()(
      post(valid('age > 1'), { headers: { 'x-request-id': 'bad id <script>' } }),
    );
    expect(res.headers.get('x-request-id')).toMatch(/^req_[0-9a-z]{10}$/);
  });

  it('applies the client timezone when no current state is sent', async () => {
    const body = await json(await handler()(post(valid('age > 1', { timezone: 'Asia/Kolkata' }))));
    expect(body).toMatchObject({ query: { context: { timezone: 'Asia/Kolkata' } } });
  });
});

describe('createPragmaHandler: request validation', () => {
  it.each<[string, Request, number, string]>([
    ['non-POST', post(null, { method: 'GET' }), 405, 'VALIDATION_ERROR'],
    [
      'wrong content type',
      new Request('https://app.test/x', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
      415,
      'VALIDATION_ERROR',
    ],
    ['invalid JSON', post(null, { raw: '{nope' }), 400, 'VALIDATION_ERROR'],
    ['missing fields', post({ protocolVersion: '1.0' }), 422, 'VALIDATION_ERROR'],
    [
      'future protocol',
      post(valid('x', { protocolVersion: '2.0' })),
      400,
      'UNSUPPORTED_PROTOCOL_VERSION',
    ],
    ['bad timezone', post(valid('x', { timezone: 'Mars/Base' })), 422, 'VALIDATION_ERROR'],
    ['unknown resource', post({ ...valid('x'), resource: 'orders' }), 404, 'UNKNOWN_RESOURCE'],
    ['empty instruction', post(valid('   ')), 400, 'PARSE_ERROR'],
    [
      'invalid current state',
      post(valid('age > 1', { currentState: { nope: true } })),
      422,
      'VALIDATION_ERROR',
    ],
  ])('%s → %i %s', async (_name, request, status, code) => {
    const res = await handler()(request);
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await json(res);
    expect(body).toMatchObject({
      status,
      code,
      requestId: expect.any(String),
      title: expect.any(String),
      type: expect.stringContaining('https://'),
    });
  });

  it('includes Allow on 405 and field issues on 422', async () => {
    expect((await handler()(post(null, { method: 'DELETE', raw: '' }))).headers.get('allow')).toBe(
      'POST',
    );
    const body = await json(await handler()(post({ protocolVersion: '1.0', resource: 5 })));
    expect((body['issues'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects oversized bodies by declared length and by streamed size', async () => {
    const small = handler({ maxBodyBytes: 100 });
    const declared = await small(post(valid('x'.repeat(200))));
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('x'.repeat(80)));
        c.enqueue(new TextEncoder().encode('x'.repeat(80)));
        c.close();
      },
    });
    const streamed = await small(
      new Request('https://app.test/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(streamed.status).toBe(413);
  });
});

describe('createPragmaHandler: client schemas', () => {
  const orders: TableSchema = {
    schemaVersion: '1',
    resource: 'orders',
    fields: [{ id: 'total', label: 'Total', type: 'number' }],
  };

  it('are ignored unless explicitly allowed', async () => {
    const res = await handler()(
      post({ ...valid('total > 5'), resource: 'orders', schema: orders }),
    );
    expect(res.status).toBe(404);
  });

  it('are validated and cached when allowed', async () => {
    const h = handler({ allowClientSchema: true });
    expect(
      await json(await h(post({ ...valid('total > 5'), resource: 'orders', schema: orders }))),
    ).toMatchObject({ status: 'ok' });
    expect(
      await json(await h(post({ ...valid('total > 9'), resource: 'orders', schema: orders }))),
    ).toMatchObject({ status: 'ok' });
    const invalid = await h(
      post({ ...valid('x'), resource: 'orders', schema: { ...orders, fields: [] } }),
    );
    expect(invalid.status).toBe(422);
    expect(await json(invalid)).toMatchObject({ code: 'SCHEMA_ERROR' });
    const mismatch = await h(post({ ...valid('x'), resource: 'items', schema: orders }));
    expect(await json(mismatch)).toMatchObject({ code: 'SCHEMA_ERROR' });
  });

  it('never let a client schema override a registered one', async () => {
    const exposed = { ...users, fields: users.fields.map((f) => ({ ...f, hidden: false })) };
    const body = await json(
      await handler({ allowClientSchema: true })(post({ ...valid('salary > 5'), schema: exposed })),
    );
    expect(body['status']).not.toBe('ok');
  });
});

describe('createPragmaHandler: access control', () => {
  it('rejects unauthorized requests', async () => {
    const denied = await handler({ authorize: () => false })(post(valid('age > 1')));
    expect(denied.status).toBe(403);
    const unauthenticated = await handler({
      authorize: () => ({ allowed: false, status: 401, message: 'Sign in first.' }),
    })(post(valid('age > 1')));
    expect(unauthenticated.status).toBe(401);
    expect(await json(unauthenticated)).toMatchObject({
      code: 'UNAUTHORIZED',
      detail: 'Sign in first.',
    });
    const authorize = vi.fn((_context: { resource: string; requestId: string }) => true);
    await handler({ authorize })(post(valid('age > 1')));
    expect(authorize.mock.calls[0]?.[0]).toMatchObject({
      resource: 'users',
      requestId: expect.any(String),
    });
  });

  it('rate limits with Retry-After', async () => {
    const res = await handler({ rateLimit: () => ({ allowed: false, retryAfterSeconds: 2.2 }) })(
      post(valid('age > 1')),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    const ok = await handler({ rateLimit: () => ({ allowed: true }) })(post(valid('age > 1')));
    expect(ok.status).toBe(200);
  });

  it('supports CORS for configured origins only', async () => {
    const h = handler({ cors: { origin: ['https://app.example'], credentials: true, maxAge: 60 } });
    const preflight = await h(
      new Request('https://api.test/x', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-max-age')).toBe('60');
    const res = await h(post(valid('age > 1'), { headers: { origin: 'https://app.example' } }));
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const evil = await h(
      new Request('https://api.test/x', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(evil.status).toBe(405);
    const noCors = await handler()(
      new Request('https://api.test/x', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example' },
      }),
    );
    expect(noCors.status).toBe(405);
    const single = await handler({ cors: { origin: 'https://app.example' } })(
      post(valid('age > 1'), { headers: { origin: 'https://app.example' } }),
    );
    expect(single.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('createPragmaHandler: upstream failures and resilience', () => {
  const failing = (error: Error): LanguageModelProvider => ({
    id: 'down',
    generate: () => Promise.reject(error),
  });

  it('maps model failures to gateway problems', async () => {
    const bad = await handler({
      provider: failing(new PragmaModelError('MODEL_ERROR', 'upstream 503', { retryable: false })),
    })(post(valid('show Indian users')));
    expect(bad.status).toBe(502);
    expect(await json(bad)).toMatchObject({ code: 'MODEL_ERROR' });
    const limited = await handler({
      provider: failing(new PragmaModelError('RATE_LIMITED', '429', { retryable: false })),
    })(post(valid('show Indian users')));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
  });

  it('maps model timeouts to 504', async () => {
    const slow: LanguageModelProvider = {
      id: 'slow',
      generate: (req) =>
        new Promise((_, reject) => {
          req.signal.addEventListener('abort', () => {
            reject(req.signal.reason as Error);
          });
        }),
    };
    const res = await handler({ provider: slow, engine: { timeoutMs: 20 } })(
      post(valid('show Indian users')),
    );
    expect(res.status).toBe(504);
  });

  it('opens the circuit after repeated failures and degrades to deterministic-only', async () => {
    let now = 1_000;
    const generate = vi.fn(() =>
      Promise.reject(new PragmaModelError('MODEL_ERROR', 'down', { retryable: false })),
    );
    const h = handler({
      provider: { id: 'flaky', generate },
      circuitBreaker: { failureThreshold: 2, resetAfterMs: 5_000 },
      now: () => now,
      engine: { cache: false },
    });
    expect((await h(post(valid('show Indian users')))).status).toBe(502);
    expect((await h(post(valid('show Indian users')))).status).toBe(502);
    const degraded = await h(post(valid('show Indian users')));
    expect(degraded.headers.get('x-pragma-degraded')).toBe('model-unavailable');
    expect(await json(degraded)).toMatchObject({ status: 'unsupported' });
    const deterministicStillWorks = await h(post(valid('age > 5')));
    expect(await json(deterministicStillWorks)).toMatchObject({ status: 'ok' });
    expect(generate).toHaveBeenCalledTimes(2);
    now += 5_000; // half-open: one trial reaches the model again
    await h(post(valid('show Indian users')));
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('closes the circuit again after a successful trial', async () => {
    let now = 0;
    let healthy = false;
    const provider: LanguageModelProvider = {
      id: 'recovering',
      generate: () =>
        healthy
          ? Promise.resolve({ json: indian })
          : Promise.reject(new PragmaModelError('MODEL_ERROR', 'down', { retryable: false })),
    };
    const h = handler({
      provider,
      circuitBreaker: { failureThreshold: 1, resetAfterMs: 10 },
      now: () => now,
      engine: { cache: false },
    });
    await h(post(valid('show Indian users')));
    healthy = true;
    now = 10;
    expect(await json(await h(post(valid('show Indian users'))))).toMatchObject({
      status: 'ok',
      meta: { parser: 'llm' },
    });
    const after = await h(post(valid('show Indian users')));
    expect(after.headers.get('x-pragma-degraded')).toBeNull();
  });

  it('hides internal errors and reports them to onError', async () => {
    const onError = vi.fn(() => {
      throw new Error('logger down');
    });
    const res = await handler({
      authorize: () => {
        throw new Error('db password leaked');
      },
      onError,
    })(post(valid('age > 1')));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('password');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('works without any model configured', async () => {
    const h = createPragmaHandler({ schemas: { users } });
    expect(await json(await h(post(valid('age > 5'))))).toMatchObject({ status: 'ok' });
    expect(await json(await h(post(valid('show Indian users'))))).toMatchObject({
      status: 'unsupported',
      errors: [{ code: 'MODEL_UNAVAILABLE' }],
    });
  });
});

describe('createPragmaHandler: configuration', () => {
  it('fails fast on invalid configuration', () => {
    expect(() => createPragmaHandler({ schemas: {} })).toThrow(/at least one schema/);
    expect(() => createPragmaHandler({ schemas: { users }, maxBodyBytes: 0 })).toThrow(
      /maxBodyBytes/,
    );
    expect(() => createPragmaHandler({ schemas: { people: users } })).toThrow(
      /declares resource "users"/,
    );
    expect(() => createPragmaHandler({ schemas: { users: { ...users, fields: [] } } })).toThrow(
      /Invalid table schema/,
    );
  });
});

describe('toNodeHandler', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server)
        server.close(() => {
          resolve();
        });
      else resolve();
    });
    server = undefined;
  });

  async function listen(listener: Parameters<typeof createServer>[1]): Promise<string> {
    server = createServer(listener);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pragma`;
  }

  it('serves the handler over node:http', async () => {
    const url = await listen(toNodeHandler(handler()));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'node-1' },
      body: JSON.stringify(valid('age > 25')),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('node-1');
    expect(await json(res)).toMatchObject({ status: 'ok' });
  });

  it('accepts bodies already parsed by middleware and rejects oversized streams', async () => {
    const h = toNodeHandler(handler({ maxBodyBytes: 200 }), {
      maxBufferBytes: 300,
      trustProxy: true,
    });
    const url = await listen((req, res) => {
      if (req.headers['x-preparsed'] === '1') {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
          h(Object.assign(req, { body: JSON.parse(raw) as unknown }), res);
        });
      } else h(req, res);
    });
    const parsed = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-preparsed': '1',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify(valid('age > 25')),
    });
    expect(await json(parsed)).toMatchObject({ status: 'ok' });
    const big = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1000),
    });
    expect(big.status).toBe(413);
  });

  it('delegates unexpected failures to next() or answers 500', async () => {
    const broken = toNodeHandler(() => Promise.reject(new Error('boom')));
    const next = vi.fn();
    const url = await listen((req, res) => {
      if (req.headers['x-with-next'] === '1') {
        broken(req, res, (err) => {
          next(err);
          res.statusCode = 503;
          res.end();
        });
      } else broken(req, res);
    });
    expect(
      (await fetch(url, { method: 'POST', headers: { 'x-with-next': '1' }, body: '{}' })).status,
    ).toBe(503);
    expect(next).toHaveBeenCalledOnce();
    const plain = await fetch(url, { method: 'POST', body: '{}' });
    expect(plain.status).toBe(500);
    expect(await json(plain)).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
