import { describe, expect, it } from 'vitest';
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  Mutation,
  TableQuery,
} from '../protocol/types.js';
import { defineSchema } from '../schema/define-schema.js';
import { usersSchema } from '../testing/fixtures.js';
import { validateMutations, validateQuery } from './validate.js';
import { coerceOperatorValue, coerceScalar, matchEnumValue } from './values.js';

const field = (id: string) => usersSchema.fieldsById.get(id)!;

const cond = (
  f: string,
  operator: string,
  value?: unknown,
  extra: Partial<FilterCondition> = {},
): FilterCondition =>
  ({
    type: 'condition',
    id: `c_${f}_${operator}`,
    field: f,
    operator,
    ...(value === undefined ? {} : { value }),
    ...extra,
  }) as FilterCondition;

const group = (children: FilterNode[], logic: 'and' | 'or' = 'and', id = 'root'): FilterGroup => ({
  type: 'group',
  id,
  logic,
  children,
});

const query = (patch: Partial<TableQuery> = {}): TableQuery => ({
  version: '1.0',
  resource: 'users',
  search: null,
  filter: null,
  sort: [],
  pagination: { type: 'page', page: 1, pageSize: 20 },
  ...patch,
});

const codes = (r: { issues: readonly { code: string }[] }): string[] => r.issues.map((i) => i.code);

describe('coerceScalar', () => {
  it('coerces strings', () => {
    expect(coerceScalar(field('name'), 'Rahul')).toEqual({ ok: true, value: 'Rahul' });
    expect(coerceScalar(field('name'), 42)).toEqual({ ok: true, value: '42' });
    expect(coerceScalar(field('name'), '').ok).toBe(false);
    expect(coerceScalar(field('name'), true).ok).toBe(false);
  });

  it('coerces numbers strictly', () => {
    expect(coerceScalar(field('age'), '25')).toEqual({ ok: true, value: 25 });
    expect(coerceScalar(field('age'), '1,00,000')).toEqual({ ok: true, value: 100000 });
    expect(coerceScalar(field('age'), ' -2.5e3 ')).toEqual({ ok: true, value: -2500 });
    expect(coerceScalar(field('age'), 'twenty').ok).toBe(false);
    expect(coerceScalar(field('age'), Number.NaN).ok).toBe(false);
    expect(coerceScalar(field('age'), false).ok).toBe(false);
  });

  it('coerces booleans', () => {
    expect(coerceScalar(field('verified'), 'yes')).toEqual({ ok: true, value: true });
    expect(coerceScalar(field('verified'), 'FALSE')).toEqual({ ok: true, value: false });
    expect(coerceScalar(field('verified'), 1)).toEqual({ ok: true, value: true });
    expect(coerceScalar(field('verified'), 0)).toEqual({ ok: true, value: false });
    expect(coerceScalar(field('verified'), 'maybe').ok).toBe(false);
  });

  it('maps enum values by value, label and alias; never invents', () => {
    expect(coerceScalar(field('status'), 'active')).toEqual({ ok: true, value: 'active' });
    expect(coerceScalar(field('status'), 'Inactive')).toEqual({ ok: true, value: 'inactive' });
    expect(coerceScalar(field('status'), 'disabled')).toEqual({ ok: true, value: 'inactive' });
    expect(coerceScalar(field('status'), 'Awaiting Approval')).toEqual({
      ok: true,
      value: 'pending',
    });
    const bad = coerceScalar(field('status'), 'completed');
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.issue.details).toMatchObject({
        allowed: ['active', 'inactive', 'pending'],
        received: 'completed',
      });
    expect(coerceScalar(field('status'), true).ok).toBe(false);
    expect(matchEnumValue(field('status'), '')).toBeUndefined();
  });

  it('coerces dates and datetimes', () => {
    expect(coerceScalar(field('birthDate'), ' 2024-01-10 ')).toEqual({
      ok: true,
      value: '2024-01-10',
    });
    expect(coerceScalar(field('birthDate'), '2024-01-10T10:00:00Z').ok).toBe(false);
    expect(coerceScalar(field('createdAt'), '2024-01-10T10:00:00Z').ok).toBe(true);
    expect(coerceScalar(field('createdAt'), '2024-01-10').ok).toBe(true);
    expect(coerceScalar(field('createdAt'), 'last tuesday').ok).toBe(false);
  });
});

describe('coerceOperatorValue', () => {
  it('enforces operator arity', () => {
    expect(coerceOperatorValue(field('phone'), 'isNull', 'x').ok).toBe(false);
    expect(coerceOperatorValue(field('age'), 'gt', undefined).ok).toBe(false);
    expect(coerceOperatorValue(field('age'), 'gt', [1, 2]).ok).toBe(false);
    expect(coerceOperatorValue(field('age'), 'between', [1]).ok).toBe(false);
    expect(coerceOperatorValue(field('age'), 'between', ['1', '5'])).toEqual({
      ok: true,
      value: [1, 5],
    });
    expect(coerceOperatorValue(field('age'), 'between', ['x', 5]).ok).toBe(false);
    expect(coerceOperatorValue(field('age'), 'between', [1, 'x']).ok).toBe(false);
    expect(coerceOperatorValue(field('country'), 'in', []).ok).toBe(false);
    expect(coerceOperatorValue(field('country'), 'in', 'India').ok).toBe(false);
    expect(
      coerceOperatorValue(
        field('country'),
        'in',
        Array.from({ length: 101 }, (_, i) => `c${i}`),
      ).ok,
    ).toBe(false);
    expect(coerceOperatorValue(field('age'), 'in', ['1', 'x']).ok).toBe(false);
    expect(coerceOperatorValue(field('status'), 'in', ['disabled', 'active'])).toEqual({
      ok: true,
      value: ['inactive', 'active'],
    });
  });

  it('validates durations', () => {
    const ok = coerceOperatorValue(field('createdAt'), 'last', { amount: 7, unit: 'day' });
    expect(ok).toEqual({ ok: true, value: { amount: 7, unit: 'day' } });
    expect(coerceOperatorValue(field('createdAt'), 'last', 7).ok).toBe(false);
    expect(coerceOperatorValue(field('createdAt'), 'last', [7]).ok).toBe(false);
    expect(coerceOperatorValue(field('createdAt'), 'last', { amount: 0, unit: 'day' }).ok).toBe(
      false,
    );
    expect(coerceOperatorValue(field('createdAt'), 'last', { amount: 1.5, unit: 'day' }).ok).toBe(
      false,
    );
    expect(
      coerceOperatorValue(field('createdAt'), 'last', { amount: 1, unit: 'fortnight' } as never).ok,
    ).toBe(false);
    expect(coerceOperatorValue(field('birthDate'), 'last', { amount: 3, unit: 'hour' }).ok).toBe(
      false,
    );
    expect(coerceOperatorValue(field('createdAt'), 'last', { amount: 3, unit: 'hour' }).ok).toBe(
      true,
    );
  });
});

describe('validateQuery', () => {
  it('accepts and coerces a valid query', () => {
    const r = validateQuery(
      query({
        search: { query: '  rahul ', fields: ['name', 'name', 'email'] },
        filter: group([
          cond('age', 'gt', '25'),
          cond('status', 'eq', 'Active'),
          group(
            [cond('country', 'eq', 'India'), cond('country', 'eq', 'US', { id: 'c_us' })],
            'or',
            'g2',
          ),
        ]),
        sort: [
          { field: 'createdAt', direction: 'desc' },
          { field: 'age', direction: 'asc', nulls: 'first' },
        ],
        context: { timezone: 'Asia/Kolkata' },
      }),
      usersSchema,
    );
    expect(r.issues).toEqual([]);
    expect(r.value?.search).toEqual({ query: 'rahul', fields: ['name', 'email'] });
    const children = r.value!.filter!.children;
    expect((children[0] as FilterCondition).value).toBe(25);
    expect((children[1] as FilterCondition).value).toBe('active');
    expect(r.value?.sort[1]).toEqual({ field: 'age', direction: 'asc', nulls: 'first' });
    expect(r.value?.context).toEqual({ timezone: 'Asia/Kolkata' });
  });

  it('reports unknown and hidden fields identically', () => {
    const unknown = validateQuery(query({ filter: group([cond('wage', 'gt', 1)]) }), usersSchema);
    const hidden = validateQuery(query({ filter: group([cond('salary', 'gt', 1)]) }), usersSchema);
    expect(codes(unknown)).toEqual(['UNKNOWN_FIELD']);
    expect(codes(hidden)).toEqual(['UNKNOWN_FIELD']);
    expect(hidden.issues[0]?.message).toBe('Unknown field "salary".');
    expect(JSON.stringify(hidden.issues)).not.toMatch(/hidden/i);
    expect(JSON.stringify(hidden.issues[0]?.details)).not.toContain('"salary"');
  });

  it('rejects illegal and unknown operators with the allowed list', () => {
    const r = validateQuery(query({ filter: group([cond('age', 'contains', 25)]) }), usersSchema);
    expect(codes(r)).toEqual(['INVALID_OPERATOR']);
    expect(r.issues[0]?.details?.['allowed']).toContain('eq');
    expect(
      codes(
        validateQuery(query({ filter: group([cond('age', 'approximately', 25)]) }), usersSchema),
      ),
    ).toEqual(['INVALID_OPERATOR']);
  });

  it('honours per-field operator narrowing and capability flags', () => {
    const schema = defineSchema({
      schemaVersion: '1',
      resource: 't',
      fields: [
        { id: 'a', label: 'A', type: 'number', operators: ['eq'] },
        { id: 'b', label: 'B', type: 'string', filterable: false },
      ],
      capabilities: { search: false },
    });
    const base = { ...query(), resource: 't' };
    expect(codes(validateQuery({ ...base, filter: group([cond('a', 'gt', 1)]) }, schema))).toEqual([
      'INVALID_OPERATOR',
    ]);
    const notFilterable = validateQuery({ ...base, filter: group([cond('b', 'eq', 'x')]) }, schema);
    expect(codes(notFilterable)).toEqual(['UNSUPPORTED_OPERATION']);
    expect(codes(validateQuery({ ...base, search: { query: 'x' } }, schema))).toEqual([
      'CAPABILITY_UNSUPPORTED',
    ]);
  });

  it('rejects caseSensitive outside text comparisons', () => {
    expect(
      codes(
        validateQuery(
          query({ filter: group([cond('age', 'eq', 1, { options: { caseSensitive: true } })]) }),
          usersSchema,
        ),
      ),
    ).toEqual(['VALIDATION_ERROR']);
    const ok = validateQuery(
      query({ filter: group([cond('name', 'eq', 'x', { options: { caseSensitive: true } })]) }),
      usersSchema,
    );
    expect((ok.value!.filter!.children[0] as FilterCondition).options).toEqual({
      caseSensitive: true,
    });
  });

  it('rejects duplicate node ids, mismatched resources and bad timezones', () => {
    expect(
      codes(
        validateQuery(
          query({ filter: group([cond('age', 'gt', 1), cond('age', 'gt', 1)]) }),
          usersSchema,
        ),
      ),
    ).toEqual(['VALIDATION_ERROR']);
    expect(codes(validateQuery(query({ resource: 'orders' }), usersSchema))).toEqual([
      'UNKNOWN_RESOURCE',
    ]);
    expect(
      codes(validateQuery(query({ context: { timezone: 'Mars/Base' } }), usersSchema)),
    ).toEqual(['INVALID_VALUE']);
  });

  it('enforces tree limits', () => {
    const many = group(
      Array.from({ length: 21 }, (_, i) => ({ ...cond('age', 'gt', i), id: `c${i}` })),
    );
    expect(codes(validateQuery(query({ filter: many }), usersSchema))).toEqual(['LIMIT_EXCEEDED']);
    const deep = group([
      group([group([group([cond('age', 'gt', 1)], 'and', 'g4')], 'or', 'g3')], 'and', 'g2'),
    ]);
    expect(codes(validateQuery(query({ filter: deep }), usersSchema))).toEqual(['LIMIT_EXCEEDED']);
    expect(
      validateQuery(query({ filter: deep }), usersSchema, { limits: { maxDepth: 5 } }).issues,
    ).toEqual([]);
  });

  it('validates search', () => {
    expect(codes(validateQuery(query({ search: { query: '   ' } }), usersSchema))).toEqual([
      'INVALID_VALUE',
    ]);
    expect(
      codes(validateQuery(query({ search: { query: 'x', fields: [] } }), usersSchema)),
    ).toEqual(['INVALID_VALUE']);
    expect(
      codes(validateQuery(query({ search: { query: 'x', fields: ['age'] } }), usersSchema)),
    ).toEqual(['UNSUPPORTED_OPERATION']);
    expect(
      codes(validateQuery(query({ search: { query: 'x', fields: ['salary'] } }), usersSchema)),
    ).toEqual(['UNKNOWN_FIELD']);
    expect(validateQuery(query({ search: { query: 'x' } }), usersSchema).value?.search).toEqual({
      query: 'x',
    });
  });

  it('validates sort', () => {
    expect(
      codes(validateQuery(query({ sort: [{ field: 'phone', direction: 'asc' }] }), usersSchema)),
    ).toEqual(['UNSUPPORTED_OPERATION']);
    const dup = validateQuery(
      query({
        sort: [
          { field: 'age', direction: 'asc' },
          { field: 'age', direction: 'desc' },
        ],
      }),
      usersSchema,
    );
    expect(dup.value?.sort).toEqual([{ field: 'age', direction: 'asc' }]);
    expect(dup.warnings[0]?.code).toBe('DUPLICATE_REMOVED');
    const tooMany = Array.from({ length: 6 }, () => ({ field: 'age', direction: 'asc' as const }));
    expect(codes(validateQuery(query({ sort: tooMany }), usersSchema))).toEqual(['LIMIT_EXCEEDED']);
  });

  it('validates pagination against capabilities', () => {
    expect(
      codes(
        validateQuery(query({ pagination: { type: 'page', page: 1, pageSize: 101 } }), usersSchema),
      ),
    ).toEqual(['LIMIT_EXCEEDED']);
    const clamped = validateQuery(
      query({ pagination: { type: 'offset', offset: 0, limit: 500 } }),
      usersSchema,
      { pageSizeOverflow: 'clamp' },
    );
    expect(clamped.value?.pagination).toEqual({ type: 'offset', offset: 0, limit: 100 });
    expect(clamped.warnings[0]?.code).toBe('VALUE_CLAMPED');
    const pageOnly = defineSchema({
      schemaVersion: '1',
      resource: 't',
      fields: [{ id: 'a', label: 'A', type: 'string' }],
    });
    expect(
      codes(
        validateQuery(
          { ...query(), resource: 't', pagination: { type: 'cursor', cursor: null, limit: 5 } },
          pageOnly,
        ),
      ),
    ).toEqual(['CAPABILITY_UNSUPPORTED']);
    expect(
      validateQuery(query({ pagination: { type: 'cursor', cursor: 'abc', limit: 5 } }), usersSchema)
        .issues,
    ).toEqual([]);
  });
});

describe('validateMutations', () => {
  it('validates and coerces every mutation kind', () => {
    const mutations: Mutation[] = [
      { op: 'setSearch', search: { query: 'x' } },
      { op: 'clearSearch' },
      { op: 'addFilter', node: cond('age', 'gt', '5'), logic: 'or' },
      { op: 'addFilter', node: cond('age', 'lt', 50) },
      { op: 'replaceFilter', node: cond('country', 'eq', 'India') },
      { op: 'replaceFilter', node: null },
      { op: 'removeFilter', target: { field: 'age' } },
      { op: 'removeFilter', target: { id: 'abc' } },
      { op: 'clearFilters' },
      { op: 'setSort', sort: [{ field: 'age', direction: 'desc' }] },
      { op: 'addSort', spec: { field: 'name', direction: 'asc' } },
      { op: 'removeSort', field: 'name' },
      { op: 'clearSort' },
      { op: 'setPage', page: 3 },
      { op: 'nextPage' },
      { op: 'prevPage' },
      { op: 'setPageSize', size: 50 },
      { op: 'reset' },
    ];
    const r = validateMutations(mutations, usersSchema);
    expect(r.issues).toEqual([]);
    expect(r.value).toHaveLength(mutations.length);
    expect(r.value?.[2]).toEqual({ op: 'addFilter', node: cond('age', 'gt', 5), logic: 'or' });
  });

  it('reports every invalid mutation with its path', () => {
    const r = validateMutations(
      [
        { op: 'addFilter', node: cond('salary', 'gt', 1) },
        { op: 'removeFilter', target: { field: 'wage' } },
        { op: 'removeSort', field: 'salary' },
        { op: 'setSort', sort: [{ field: 'phone', direction: 'asc' }] },
        { op: 'addSort', spec: { field: 'nope', direction: 'asc' } },
        { op: 'setSearch', search: { query: ' ' } },
        { op: 'setPageSize', size: 1000 },
      ],
      usersSchema,
    );
    expect(r.value).toBeUndefined();
    expect(codes(r)).toEqual([
      'UNKNOWN_FIELD',
      'UNKNOWN_FIELD',
      'UNKNOWN_FIELD',
      'UNSUPPORTED_OPERATION',
      'UNKNOWN_FIELD',
      'INVALID_VALUE',
      'LIMIT_EXCEEDED',
    ]);
    expect(r.issues[0]?.path).toEqual(['mutations', 0, 'node', 'field']);
    expect(r.issues[6]?.path).toEqual(['mutations', 6, 'size']);
  });

  it('clamps page size when configured', () => {
    const r = validateMutations([{ op: 'setPageSize', size: 1000 }], usersSchema, {
      pageSizeOverflow: 'clamp',
    });
    expect(r.value).toEqual([{ op: 'setPageSize', size: 100 }]);
  });

  it('rejects page jumps on cursor-only schemas and oversized filter trees', () => {
    const cursorOnly = defineSchema({
      schemaVersion: '1',
      resource: 't',
      fields: [{ id: 'a', label: 'A', type: 'number' }],
      capabilities: { pagination: ['cursor'] },
    });
    expect(codes(validateMutations([{ op: 'setPage', page: 5 }], cursorOnly))).toEqual([
      'CAPABILITY_UNSUPPORTED',
    ]);
    const big = group(
      Array.from({ length: 21 }, (_, i) => ({ ...cond('age', 'gt', i), id: `c${i}` })),
    );
    expect(codes(validateMutations([{ op: 'addFilter', node: big }], usersSchema))).toEqual([
      'LIMIT_EXCEEDED',
    ]);
  });
});
