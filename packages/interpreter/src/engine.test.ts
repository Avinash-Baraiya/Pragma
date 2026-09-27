import {
  isPragmaError,
  PragmaModelError,
  sequentialIds,
  type ClarificationResult,
  type InterpretResult,
  type OkResult,
  type TableQuery,
} from '@avinash-baraiya/pragma-core';
import { describe, expect, it, vi } from 'vitest';
import type { CacheStore } from './cache.js';
import {
  createEngine,
  type EngineEvent,
  type EngineOptions,
  type ModelInterpreter,
} from './engine.js';
import { render, usersSchema, usersSchemaInput } from './testing/fixtures.js';
import type { Proposal } from './types.js';

const NOW = Date.UTC(2024, 5, 15, 12);

function engine(options: Partial<EngineOptions> = {}) {
  return createEngine({
    schema: usersSchema,
    timezone: 'Asia/Kolkata',
    now: () => NOW,
    idGenerator: sequentialIds(),
    ...options,
  });
}

function ok(result: InterpretResult): OkResult {
  if (result.status !== 'ok')
    throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result)}`);
  return result;
}

function fakeModel(
  proposal: Proposal | ((instruction: string) => Proposal),
  extra: Partial<ModelInterpreter> = {},
): ModelInterpreter & { calls: number } {
  const model = {
    id: 'fake',
    calls: 0,
    interpret: vi.fn(async (req: { instruction: string }) => {
      model.calls++;
      await Promise.resolve();
      return {
        proposal: typeof proposal === 'function' ? proposal(req.instruction) : proposal,
        model: 'fake-1',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    }),
    ...extra,
  };
  return model;
}

const condition = (field: string, operator: string, value?: unknown) =>
  ({
    type: 'condition',
    id: `m_${field}`,
    field,
    operator,
    ...(value === undefined ? {} : { value }),
  }) as never;

describe('createEngine configuration', () => {
  it('accepts raw or resolved schemas', () => {
    expect(createEngine({ schema: usersSchemaInput }).schema.hash).toBe(usersSchema.hash);
    expect(createEngine({ schema: usersSchema }).schema).toBe(usersSchema);
  });

  it('rejects invalid configuration with every problem listed', () => {
    try {
      createEngine({
        schema: usersSchema,
        timezone: 'Nowhere/City',
        mode: 'llm-only',
        ambiguity: 'maybe' as never,
        timeoutMs: -1,
        limits: { maxDepth: 0 },
      });
      expect.unreachable();
    } catch (error) {
      expect(isPragmaError(error) && error.code).toBe('CONFIG_ERROR');
      const message = (error as Error).message;
      for (const fragment of ['timezone', 'llm-only', 'ambiguity', 'timeoutMs', 'maxDepth'])
        expect(message).toContain(fragment);
    }
    expect(() => createEngine({ schema: usersSchema, mode: 'turbo' as never })).toThrow(
      /Unknown mode/,
    );
  });
});

describe('interpret: deterministic path', () => {
  it('returns a validated, normalized, explained query', async () => {
    const result = ok(
      await engine().interpret(
        'active users with age > 25 and country is India, newest first, 20 per page',
      ),
    );
    expect(result.meta).toMatchObject({
      parser: 'deterministic',
      schemaHash: usersSchema.hash,
      protocolVersion: '1.0',
      engineVersion: '0.0.0-test',
    });
    expect(result.query.context).toEqual({ timezone: 'Asia/Kolkata', weekStartsOn: 1 });
    expect(result.query.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    expect(result.explanation.map((e) => e.text)).toEqual([
      'Status = Active',
      'Age > 25',
      'Country = "India"',
      'Sorted by Created At (descending)',
      'Page 1, 20 per page',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('merges with the current state and returns to page 1', async () => {
    const e = engine();
    const first = ok(await e.interpret('country is India'));
    const onPage3: TableQuery = {
      ...first.query,
      pagination: { type: 'page', page: 3, pageSize: 20 },
    };
    const second = ok(await e.interpret('sort newest first', { currentState: onPage3 }));
    expect(second.query.filter).toEqual(first.query.filter);
    expect(second.query.pagination).toEqual({ type: 'page', page: 1, pageSize: 20 });
  });

  it('warns about impossible filters without changing them', async () => {
    const result = ok(await engine().interpret('age > 30 and age < 20'));
    expect(result.warnings.map((w) => w.code)).toEqual(['EMPTY_RANGE']);
    expect(result.query.filter?.children).toHaveLength(2);
  });

  it('warns when relative dates fall back to UTC', async () => {
    const e = createEngine({ schema: usersSchema, now: () => NOW });
    const result = ok(await e.interpret('joined today'));
    expect(result.warnings.map((w) => w.code)).toEqual(['TIMEZONE_DEFAULTED']);
    expect(result.query.context?.timezone).toBe('UTC');
  });

  it('reports removing a filter that is not applied', async () => {
    const result = await engine().interpret('remove the country filter');
    expect(result.status).toBe('unsupported');
    expect(result.status === 'unsupported' && result.errors[0]?.code).toBe('TARGET_NOT_FOUND');
  });

  it('reports page sizes over the limit, or clamps under bestGuess', async () => {
    const strict = await engine().interpret('show 1000 rows');
    expect(strict.status === 'unsupported' && strict.errors[0]?.code).toBe('LIMIT_EXCEEDED');
    const lenient = ok(await engine({ ambiguity: 'bestGuess' }).interpret('show 1000 rows'));
    expect(lenient.query.pagination).toMatchObject({ pageSize: 100 });
    expect(lenient.warnings.map((w) => w.code)).toContain('VALUE_CLAMPED');
  });
});

describe('interpret: input validation', () => {
  it('rejects empty, non-string and over-long instructions', async () => {
    const e = engine();
    expect((await e.interpret('   ')).status).toBe('error');
    expect((await e.interpret(42 as never)).status).toBe('error');
    const long = await e.interpret('a'.repeat(501));
    expect(long.status === 'error' && long.errors[0]?.code).toBe('LIMIT_EXCEEDED');
  });

  it('rejects invalid current state with prefixed paths', async () => {
    const bad = await engine().interpret('age > 5', {
      currentState: { version: '1.0', resource: 'users' },
    });
    expect(bad.status).toBe('error');
    expect(bad.status === 'error' && bad.errors[0]?.path?.[0]).toBe('currentState');
    const hidden = await engine().interpret('age > 5', {
      currentState: {
        ...engine().initialQuery(),
        filter: { type: 'group', id: 'g', logic: 'and', children: [condition('salary', 'gt', 1)] },
      },
    });
    expect(hidden.status === 'error' && hidden.errors[0]?.code).toBe('UNKNOWN_FIELD');
  });

  it('rejects unknown and hidden @mentions locally, with suggestions', async () => {
    const model = fakeModel({ mutations: [], ambiguities: [] });
    const e = engine({ interpreter: model });
    const unknown = await e.interpret('@emial contains x');
    expect(unknown.status).toBe('unsupported');
    if (unknown.status === 'unsupported') {
      expect(unknown.errors[0]?.code).toBe('UNKNOWN_FIELD');
      expect(unknown.suggestions[0]).toMatchObject({ kind: 'field', insertText: '@email' });
    }
    const hidden = await e.interpret('@salary > 100');
    expect(hidden.status === 'unsupported' && hidden.errors[0]?.message).toBe(
      'Unknown field "@salary".',
    );
    const other = await e.interpret('@orders.total > 5');
    expect(other.status === 'unsupported' && other.errors[0]?.code).toBe('UNKNOWN_RESOURCE');
    expect(model.calls).toBe(0);
  });
});

describe('interpret: routing', () => {
  it('returns MODEL_UNAVAILABLE when nothing can interpret the instruction', async () => {
    const result = await engine().interpret('profitable customers');
    expect(result.status === 'unsupported' && result.errors[0]?.code).toBe('MODEL_UNAVAILABLE');
  });

  it('never calls the model in deterministic-only mode', async () => {
    const model = fakeModel({ mutations: [], ambiguities: [] });
    const result = await engine({ interpreter: model, mode: 'deterministic-only' }).interpret(
      'profitable customers',
    );
    expect(result.status === 'unsupported' && result.errors[0]?.code).toBe('UNSUPPORTED_OPERATION');
    expect(model.calls).toBe(0);
  });

  it('falls back to the model and records model metadata', async () => {
    const model = fakeModel({
      mutations: [{ op: 'addFilter', node: condition('country', 'eq', 'India') }],
      ambiguities: [],
    });
    const result = ok(await engine({ interpreter: model }).interpret('show Indian users'));
    expect(result.meta).toMatchObject({
      parser: 'llm',
      provider: 'fake',
      model: 'fake-1',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(render(result.mutations)).toEqual(['filter country eq "India"']);
  });

  it('skips the deterministic parser in llm-only mode', async () => {
    const model = fakeModel({ mutations: [{ op: 'setPageSize', size: 20 }], ambiguities: [] });
    const result = ok(
      await engine({ interpreter: model, mode: 'llm-only' }).interpret('20 per page'),
    );
    expect(result.meta.parser).toBe('llm');
  });

  it('validates model output: hallucinated fields and operators become unsupported', async () => {
    const hallucinated = await engine({
      interpreter: fakeModel({
        mutations: [{ op: 'addFilter', node: condition('salary', 'gt', 1) }],
        ambiguities: [],
      }),
    }).interpret('rich people');
    expect(hallucinated.status === 'unsupported' && hallucinated.errors[0]?.code).toBe(
      'UNKNOWN_FIELD',
    );
    const badOp = await engine({
      interpreter: fakeModel({
        mutations: [{ op: 'addFilter', node: condition('age', 'contains', 25) }],
        ambiguities: [],
      }),
    }).interpret('age-ish 25');
    expect(badOp.status).toBe('unsupported');
    if (badOp.status === 'unsupported')
      expect(badOp.suggestions.some((s) => s.kind === 'operator' && s.label === 'eq')).toBe(true);
  });

  it('passes through model "unsupported" answers', async () => {
    const result = await engine({
      interpreter: fakeModel({
        mutations: [],
        ambiguities: [],
        unsupported: {
          reason: 'There is no profit field.',
          messageKey: 'model.unsupported',
          suggestions: [
            { kind: 'field', label: 'Revenue', insertText: '@revenue', field: 'revenue' },
          ],
        },
      }),
    }).interpret('profitable customers');
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') {
      expect(result.errors[0]).toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        message: 'There is no profit field.',
      });
      expect(result.suggestions[0]?.insertText).toBe('@revenue');
    }
  });

  it('relays precise unsupported issues when the interpreter provides them', async () => {
    const issue = {
      code: 'UNKNOWN_FIELD' as const,
      message: 'Unknown field "wage".',
      messageKey: 'field.unknown',
      retryable: false,
    };
    const result = await engine({
      interpreter: fakeModel({
        mutations: [],
        ambiguities: [],
        unsupported: {
          reason: issue.message,
          messageKey: issue.messageKey,
          suggestions: [],
          errors: [issue],
        },
      }),
    }).interpret('by wage');
    expect(result.status === 'unsupported' && result.errors).toEqual([issue]);
  });

  it('maps model failures to typed errors', async () => {
    const failing = fakeModel(
      { mutations: [], ambiguities: [] },
      {
        interpret: () =>
          Promise.reject(new PragmaModelError('RATE_LIMITED', 'slow down', { status: 429 })),
      },
    );
    const result = await engine({ interpreter: failing }).interpret('show Indian users');
    expect(result.status === 'error' && result.errors[0]).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    const crashing = fakeModel(
      { mutations: [], ambiguities: [] },
      { interpret: () => Promise.reject(new Error('secret stack')) },
    );
    const crash = await engine({ interpreter: crashing }).interpret('show Indian users');
    expect(crash.status === 'error' && crash.errors[0]?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(crash)).not.toContain('secret');
  });

  it('times out slow models', async () => {
    const slow = fakeModel(
      { mutations: [], ambiguities: [] },
      {
        interpret: (req) =>
          new Promise((_, reject) => {
            req.signal.addEventListener('abort', () => {
              reject(req.signal.reason as Error);
            });
          }),
      },
    );
    const result = await engine({ interpreter: slow, timeoutMs: 20 }).interpret(
      'show Indian users',
    );
    expect(result.status === 'error' && result.errors[0]).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('honours caller cancellation', async () => {
    const controller = new AbortController();
    const slow = fakeModel(
      { mutations: [], ambiguities: [] },
      {
        interpret: (req) =>
          new Promise((_, reject) => {
            req.signal.addEventListener('abort', () => {
              reject(new DOMException('stop', 'AbortError'));
            });
          }),
      },
    );
    const pending = engine({ interpreter: slow }).interpret('show Indian users', {
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    expect(result.status === 'error' && result.errors[0]?.code).toBe('ABORTED');
    controller.abort();
    const already = await engine({ interpreter: slow }).interpret('show Indian users', {
      signal: controller.signal,
    });
    expect(already.status === 'error' && already.errors[0]?.code).toBe('ABORTED');
  });
});

describe('interpret: defensive paths', () => {
  it('rejects structurally invalid proposals as a controlled result', async () => {
    const broken = fakeModel({ mutations: null, ambiguities: [] } as unknown as Proposal);
    const result = await engine({ interpreter: broken }).interpret('show Indian users');
    expect(result.status === 'unsupported' && result.errors[0]?.code).toBe('VALIDATION_ERROR');
    const outOfRange = fakeModel({
      mutations: [
        { op: 'setPageSize', size: 0 },
        { op: 'setPage', page: -3 },
      ],
      ambiguities: [],
    } as unknown as Proposal);
    const bounded = await engine({ interpreter: outOfRange }).interpret('tiny pages');
    expect(bounded.status === 'unsupported' && bounded.errors.map((e) => e.path)).toEqual([
      [0, 'size'],
      [1, 'page'],
    ]);
  });

  it('turns unexpected internal failures into INTERNAL_ERROR instead of throwing', async () => {
    const broken = fakeModel({ mutations: [], ambiguities: null } as unknown as Proposal);
    const result = await engine({ interpreter: broken }).interpret('show Indian users');
    expect(result.status === 'error' && result.errors[0]?.code).toBe('INTERNAL_ERROR');
  });

  it('combines caller and timeout signals without AbortSignal.any', async () => {
    const original = (AbortSignal as { any?: unknown }).any;
    (AbortSignal as { any?: unknown }).any = undefined;
    try {
      const controller = new AbortController();
      const slow = fakeModel(
        { mutations: [], ambiguities: [] },
        {
          interpret: (req) =>
            new Promise((_, reject) => {
              req.signal.addEventListener('abort', () => {
                reject(new DOMException('stop', 'AbortError'));
              });
            }),
        },
      );
      const pending = engine({ interpreter: slow }).interpret('show Indian users', {
        signal: controller.signal,
      });
      controller.abort();
      const result = await pending;
      expect(result.status === 'error' && result.errors[0]?.code).toBe('ABORTED');
    } finally {
      (AbortSignal as { any?: unknown }).any = original;
    }
  });
});

describe('interpret: ambiguity', () => {
  it('asks by default and resolves locally without another model call', async () => {
    const e = engine();
    const asked = await e.interpret('recent users');
    expect(asked.status).toBe('needs_clarification');
    const clarification = asked as ClarificationResult;
    const [amb] = clarification.ambiguities;
    const resolved = ok(e.resolve(clarification, { [amb!.id]: amb!.options[0]!.id }));
    expect(render(resolved.mutations)).toEqual(['filter createdAt last {"amount":7,"unit":"day"}']);
    expect(resolved.meta.parser).toBe('local');
    expect(resolved.meta.requestId).toBe(clarification.meta.requestId);
  });

  it('reports missing or unknown choices', () => {
    const e = engine();
    const fake: ClarificationResult = {
      status: 'needs_clarification',
      ambiguities: [
        {
          id: 'a1',
          kind: 'intent',
          message: 'Which?',
          messageKey: 'k',
          options: [{ id: 'o1', label: 'x', mutations: [] }],
        },
      ],
      partial: [],
      warnings: [],
      meta: {
        requestId: 'r',
        parser: 'deterministic',
        latencyMs: 0,
        schemaHash: '',
        engineVersion: '',
        protocolVersion: '1.0',
      },
    };
    const missing = e.resolve(fake, {});
    expect(missing.status === 'error' && missing.errors[0]?.messageKey).toBe(
      'clarification.missingChoice',
    );
    const unknown = e.resolve(fake, { a1: 'nope' });
    expect(unknown.status === 'error' && unknown.errors[0]?.messageKey).toBe(
      'clarification.unknownOption',
    );
    expect(e.resolve(fake, { a1: 'o1' }, { currentState: { bad: true } }).status).toBe('error');
  });

  it('applies the default option under bestGuess with a warning', async () => {
    const result = ok(await engine({ ambiguity: 'bestGuess' }).interpret('recent users'));
    expect(render(result.mutations)).toEqual(['filter createdAt last {"amount":30,"unit":"day"}']);
    expect(result.warnings[0]).toMatchObject({
      code: 'ASSUMPTION_APPLIED',
      params: { choice: 'Last 30 days' },
    });
  });

  it('turns unknown enum values from a model into a value clarification, even under bestGuess', async () => {
    const model = fakeModel({
      mutations: [
        { op: 'addFilter', node: condition('status', 'eq', 'completed') },
        { op: 'setPageSize', size: 50 },
      ],
      ambiguities: [],
    });
    const result = await engine({ interpreter: model, ambiguity: 'bestGuess' }).interpret(
      'completed users',
    );
    expect(result.status).toBe('needs_clarification');
    if (result.status === 'needs_clarification') {
      expect(result.ambiguities[0]).toMatchObject({
        kind: 'value',
        params: { field: 'Status', value: 'completed' },
      });
      expect(result.ambiguities[0]!.options.map((o) => o.label)).toEqual([
        'Active',
        'Inactive',
        'Pending',
      ]);
      expect(render(result.partial)).toEqual(['pageSize 50']);
    }
  });

  it('drops invalid ambiguity options proposed by a model', async () => {
    const model = fakeModel({
      mutations: [],
      ambiguities: [
        {
          id: 'a',
          kind: 'field',
          message: 'Which?',
          messageKey: 'k',
          options: [
            {
              id: 'bad',
              label: 'Salary',
              mutations: [{ op: 'setSort', sort: [{ field: 'salary', direction: 'desc' }] }],
            },
            {
              id: 'good',
              label: 'Revenue',
              mutations: [{ op: 'setSort', sort: [{ field: 'revenue', direction: 'desc' }] }],
            },
          ],
        },
      ],
    });
    const result = await engine({ interpreter: model }).interpret('richest first');
    expect(
      result.status === 'needs_clarification' && result.ambiguities[0]!.options.map((o) => o.id),
    ).toEqual(['good']);
  });
});

describe('apply: local mutations (chips)', () => {
  it('removes a filter by id without any model call', async () => {
    const e = engine();
    const first = ok(await e.interpret('age > 25 and country is India'));
    const chip = first.explanation.find((i) => i.text === 'Age > 25')!;
    const result = ok(
      e.apply([{ op: 'removeFilter', target: { id: chip.nodeId! } }], {
        currentState: first.query,
      }),
    );
    expect(result.explanation.map((i) => i.text)).toEqual([
      'Country = "India"',
      'Page 1, 20 per page',
    ]);
  });

  it('rejects malformed mutations', () => {
    const result = engine().apply([{ op: 'dropTable' }]);
    expect(result.status).toBe('error');
    expect(engine().apply([], { currentState: 'nope' }).status).toBe('error');
  });
});

describe('caching', () => {
  it('reuses interpretations for the same instruction and state', async () => {
    const model = fakeModel({
      mutations: [{ op: 'addFilter', node: condition('country', 'eq', 'India') }],
      ambiguities: [],
    });
    const e = engine({ interpreter: model });
    await e.interpret('show Indian users');
    const second = ok(await e.interpret('show   Indian users'));
    expect(second.meta.parser).toBe('cache');
    expect(model.calls).toBe(1);
    await e.interpret('show Indian users', { currentState: second.query });
    expect(model.calls).toBe(2);
  });

  it('can be disabled', async () => {
    const model = fakeModel({ mutations: [{ op: 'setPageSize', size: 5 }], ambiguities: [] });
    const e = engine({ interpreter: model, cache: false });
    await e.interpret('tiny pages please');
    await e.interpret('tiny pages please');
    expect(model.calls).toBe(2);
  });

  it('treats cache failures as misses', async () => {
    const events: EngineEvent[] = [];
    const broken: CacheStore<Proposal> = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => {
        throw new Error('redis down');
      },
    };
    const result = await engine({ cache: broken, onEvent: (ev) => events.push(ev) }).interpret(
      'age > 5',
    );
    expect(result.status).toBe('ok');
    const cacheErrors = events.flatMap((ev) => (ev.type === 'cache.error' ? [ev.operation] : []));
    expect(cacheErrors).toEqual(['get', 'set']);
  });
});

describe('observability', () => {
  it('emits start/complete events without instruction text by default', async () => {
    const events: EngineEvent[] = [];
    await engine({ onEvent: (e) => events.push(e) }).interpret('name contains Rahul');
    expect(events.map((e) => e.type)).toEqual(['interpret.start', 'interpret.complete']);
    expect(JSON.stringify(events)).not.toContain('Rahul');
    const complete = events[1]!;
    expect(complete.type === 'interpret.complete' && complete.mutationCount).toBe(1);
  });

  it('can opt in to instruction logging, and survives throwing hooks', async () => {
    const events: EngineEvent[] = [];
    await engine({ logInstructions: true, onEvent: (e) => events.push(e) }).interpret('age > 5');
    expect(events[0]?.type === 'interpret.start' && events[0].instruction).toBe('age > 5');
    const result = await engine({
      onEvent: () => {
        throw new Error('hook bug');
      },
    }).interpret('age > 5');
    expect(result.status).toBe('ok');
  });

  it('uses caller request ids', async () => {
    const result = await engine().interpret('age > 5', { requestId: 'req-abc' });
    expect(result.meta.requestId).toBe('req-abc');
  });
});

describe('helpers', () => {
  it('suggests @mentions at the caret', () => {
    const e = engine();
    const s = e.suggest('show @cou', 9);
    expect(s.start).toBe(5);
    expect(s.suggestions[0]?.id).toBe('country');
    expect(e.suggest('show users', 10)).toEqual({ start: null, query: '', suggestions: [] });
    expect(e.suggest('@', 99).start).toBe(0);
  });

  it('explains and builds the initial query', () => {
    const e = engine();
    expect(e.initialQuery().context).toEqual({ timezone: 'Asia/Kolkata', weekStartsOn: 1 });
    expect(e.explain(e.initialQuery()).map((i) => i.text)).toEqual(['Page 1, 20 per page']);
  });
});
