import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FilterCondition, FilterGroup, FilterNode, TableQuery } from '../protocol/types.js';
import { usersSchema } from '../testing/fixtures.js';
import { analyzeConflicts } from './conflicts.js';
import {
  canonicalizeQuery,
  compareScalars,
  hashQuery,
  normalizeQuery,
  queriesEqual,
} from './normalize.js';

let n = 0;
const cond = (
  field: string,
  operator: FilterCondition['operator'],
  value?: FilterCondition['value'],
  extra: Partial<FilterCondition> = {},
): FilterCondition => ({
  type: 'condition',
  id: `c${++n}`,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
  ...extra,
});
const group = (
  logic: 'and' | 'or',
  children: FilterNode[],
  extra: Partial<FilterGroup> = {},
): FilterGroup => ({ type: 'group', id: `g${++n}`, logic, children, ...extra });
const query = (filter: FilterGroup | null, extra: Partial<TableQuery> = {}): TableQuery => ({
  version: '1.0',
  resource: 'users',
  search: null,
  filter,
  sort: [],
  pagination: { type: 'page', page: 1, pageSize: 20 },
  ...extra,
});
const field = (id: string) => usersSchema.fieldsById.get(id)!;

describe('normalizeQuery', () => {
  it('flattens same-logic groups and unwraps single children', () => {
    const q = query(
      group('and', [
        cond('age', 'gt', 1),
        group('and', [cond('age', 'lt', 50), group('or', [cond('country', 'eq', 'India')])]),
      ]),
    );
    const { query: out } = normalizeQuery(q, usersSchema);
    expect(
      out.filter?.children.map((c) => (c.type === 'condition' ? c.operator : c.logic)),
    ).toEqual(['gt', 'lt', 'eq']);
  });

  it('keeps negated groups intact', () => {
    const neg = group('and', [cond('age', 'gt', 1)], { not: true });
    const { query: out } = normalizeQuery(
      query(group('and', [neg, cond('verified', 'eq', true)])),
      usersSchema,
    );
    expect(out.filter?.children[0]).toMatchObject({ type: 'group', not: true });
  });

  it('turns an empty tree into null and wraps a bare root condition', () => {
    expect(
      normalizeQuery(query(group('and', [group('or', [])])), usersSchema).query.filter,
    ).toBeNull();
    const single = normalizeQuery(query(group('or', [cond('age', 'gt', 1)])), usersSchema).query
      .filter;
    expect(single).toMatchObject({ type: 'group', logic: 'and', children: [{ operator: 'gt' }] });
    expect(normalizeQuery(query(null), usersSchema).query.filter).toBeNull();
  });

  it('keeps a different-logic child as the root when it is the only child', () => {
    const inner = group('or', [cond('age', 'lt', 5), cond('verified', 'eq', true)]);
    expect(normalizeQuery(query(group('and', [inner])), usersSchema).query.filter).toEqual(inner);
  });

  it('removes duplicate conditions with a warning', () => {
    const r = normalizeQuery(
      query(
        group('and', [
          cond('age', 'gt', 1),
          cond('age', 'gt', 1),
          group('or', [cond('age', 'lt', 3), cond('verified', 'eq', true)]),
          group('or', [cond('verified', 'eq', true), cond('age', 'lt', 3)]),
        ]),
      ),
      usersSchema,
    );
    expect(r.query.filter?.children).toHaveLength(2);
    expect(r.warnings.filter((w) => w.code === 'DUPLICATE_REMOVED')).toHaveLength(2);
  });

  it('swaps reversed between bounds with a warning', () => {
    const r = normalizeQuery(
      query(
        group('and', [
          cond('age', 'between', [40, 25]),
          cond('birthDate', 'notBetween', ['2024-01-10', '2024-01-01']),
        ]),
      ),
      usersSchema,
    );
    expect((r.query.filter?.children[0] as FilterCondition).value).toEqual([25, 40]);
    expect((r.query.filter?.children[1] as FilterCondition).value).toEqual([
      '2024-01-01',
      '2024-01-10',
    ]);
    expect(r.warnings.map((w) => w.code)).toEqual(['BOUNDS_REORDERED', 'BOUNDS_REORDERED']);
    const ok = normalizeQuery(query(group('and', [cond('age', 'between', [1, 2])])), usersSchema);
    expect(ok.warnings).toEqual([]);
  });

  it('dedupes in-list values', () => {
    const r = normalizeQuery(
      query(group('and', [cond('country', 'in', ['India', 'US', 'India'])])),
      usersSchema,
    );
    expect((r.query.filter?.children[0] as FilterCondition).value).toEqual(['India', 'US']);
  });

  it('collapses OR-ed equality into `in` and unwraps the resulting group', () => {
    const q = query(
      group('and', [
        cond('age', 'gt', 25),
        group('or', [
          cond('country', 'eq', 'India'),
          cond('country', 'eq', 'US'),
          cond('country', 'in', ['US', 'UK']),
        ]),
      ]),
    );
    const r = normalizeQuery(q, usersSchema);
    expect(r.query.filter?.children[1]).toMatchObject({
      field: 'country',
      operator: 'in',
      value: ['India', 'US', 'UK'],
    });
    expect(r.warnings.map((w) => w.code)).toContain('CONDITIONS_MERGED');
  });

  it('does not collapse across case-sensitivity or onto fields without `in`', () => {
    const r = normalizeQuery(
      query(
        group('or', [
          cond('name', 'eq', 'a'),
          cond('name', 'eq', 'b', { options: { caseSensitive: true } }),
          cond('verified', 'eq', true),
          cond('verified', 'eq', false),
        ]),
      ),
      usersSchema,
    );
    expect(r.query.filter?.children).toHaveLength(4);
  });

  it('is idempotent', () => {
    const q = query(
      group('and', [
        cond('age', 'between', [9, 1]),
        group('or', [cond('country', 'eq', 'a'), cond('country', 'eq', 'b')]),
        group('and', [cond('age', 'gt', 1)]),
      ]),
    );
    const once = normalizeQuery(q, usersSchema).query;
    const twice = normalizeQuery(once, usersSchema);
    expect(twice.query).toEqual(once);
    expect(twice.warnings).toEqual([]);
  });

  it('ignores conditions on unknown fields', () => {
    const c = cond('ghost', 'between', [2, 1]);
    expect(normalizeQuery(query(group('and', [c])), usersSchema).query.filter?.children[0]).toBe(c);
  });
});

describe('canonical form', () => {
  it('ignores node ids and child order', () => {
    const a = query(group('and', [cond('age', 'gt', 1), cond('country', 'in', ['a', 'b'])]));
    const b = query(group('and', [cond('country', 'in', ['b', 'a']), cond('age', 'gt', 1)]));
    expect(queriesEqual(a, b)).toBe(true);
    expect(hashQuery(a)).toBe(hashQuery(b));
    expect(queriesEqual(a, query(group('and', [cond('age', 'gt', 2)])))).toBe(false);
  });

  it('distinguishes sort order, search fields and pagination', () => {
    const a = query(null, {
      sort: [
        { field: 'age', direction: 'asc' },
        { field: 'name', direction: 'asc' },
      ],
    });
    const b = query(null, {
      sort: [
        { field: 'name', direction: 'asc' },
        { field: 'age', direction: 'asc' },
      ],
    });
    expect(queriesEqual(a, b)).toBe(false);
    expect(canonicalizeQuery(query(null, { search: { query: 'x', fields: ['b', 'a'] } }))).toBe(
      canonicalizeQuery(query(null, { search: { query: 'x', fields: ['a', 'b'] } })),
    );
    expect(
      queriesEqual(
        query(null),
        query(null, { pagination: { type: 'page', page: 2, pageSize: 20 } }),
      ),
    ).toBe(false);
  });

  it('compares scalars by field type', () => {
    expect(compareScalars(field('age'), 2, 10)).toBeLessThan(0);
    expect(compareScalars(field('birthDate'), '2024-01-02', '2023-12-31')).toBeGreaterThan(0);
    expect(
      compareScalars(field('createdAt'), '2024-01-01T00:00:00Z', '2024-01-01T00:00:01Z'),
    ).toBeLessThan(0);
    expect(compareScalars(field('name'), 'b', 'a')).toBe(1);
    expect(compareScalars(field('name'), 'a', 'a')).toBe(0);
    expect(compareScalars(field('birthDate'), 'x', 'y')).toBe(-1);
  });

  it('property: canonical form is invariant under child shuffles', () => {
    const conditions = [
      cond('age', 'gt', 1),
      cond('country', 'eq', 'India'),
      cond('verified', 'eq', true),
      cond('status', 'in', ['active']),
      cond('name', 'contains', 'a'),
    ];
    fc.assert(
      fc.property(fc.shuffledSubarray(conditions, { minLength: 1 }), (subset) => {
        const shuffled = [...subset].reverse();
        expect(canonicalizeQuery(query(group('and', subset)))).toBe(
          canonicalizeQuery(query(group('and', shuffled))),
        );
      }),
    );
  });
});

describe('analyzeConflicts', () => {
  const warn = (filter: FilterGroup, now?: number) =>
    analyzeConflicts(
      query(filter, { context: { timezone: 'UTC' } }),
      usersSchema,
      now === undefined ? {} : { now },
    ).map((w) => w.code);

  it('detects empty numeric ranges without changing the query', () => {
    expect(warn(group('and', [cond('age', 'gt', 30), cond('age', 'lt', 20)]))).toEqual([
      'EMPTY_RANGE',
    ]);
    expect(warn(group('and', [cond('age', 'gte', 30), cond('age', 'lte', 30)]))).toEqual([]);
    expect(warn(group('and', [cond('age', 'gt', 30), cond('age', 'lte', 30)]))).toEqual([
      'EMPTY_RANGE',
    ]);
    expect(warn(group('and', [cond('age', 'between', [1, 5]), cond('age', 'eq', 9)]))).toEqual([
      'EMPTY_RANGE',
    ]);
    expect(warn(group('and', [cond('age', 'lt', 30), cond('age', 'lt', 30)]))).toEqual([]);
    expect(warn(group('and', [cond('age', 'gt', 30), cond('age', 'gt', 30)]))).toEqual([]);
    expect(warn(group('and', [cond('age', 'gt', 30), cond('age', 'neq', 5)]))).toEqual([]);
  });

  it('detects empty date ranges, including relative ones', () => {
    expect(
      warn(
        group('and', [
          cond('birthDate', 'after', '2024-01-10'),
          cond('birthDate', 'before', '2024-01-01'),
        ]),
      ),
    ).toEqual(['EMPTY_RANGE']);
    expect(
      warn(
        group('and', [cond('createdAt', 'today'), cond('createdAt', 'before', '2020-01-01')]),
        Date.UTC(2024, 5, 1),
      ),
    ).toEqual(['EMPTY_RANGE']);
    expect(
      warn(
        group('and', [cond('createdAt', 'thisYear'), cond('createdAt', 'neq', '2024-01-01')]),
        Date.UTC(2024, 5, 1),
      ),
    ).toEqual([]);
  });

  it('detects conflicting equality and empty intersections', () => {
    expect(
      warn(group('and', [cond('country', 'eq', 'India'), cond('country', 'eq', 'US')])),
    ).toEqual(['CONFLICTING_EQUALITY']);
    expect(
      warn(group('and', [cond('country', 'eq', 'India'), cond('country', 'eq', 'india')])),
    ).toEqual([]);
    // Mixed sensitivity: a row "INDIA" satisfies both, so this must not warn.
    expect(
      warn(
        group('and', [
          cond('country', 'eq', 'India'),
          cond('country', 'eq', 'INDIA', { options: { caseSensitive: true } }),
        ]),
      ),
    ).toEqual([]);
    const cs = { options: { caseSensitive: true } };
    expect(
      warn(group('and', [cond('country', 'eq', 'India', cs), cond('country', 'eq', 'india', cs)])),
    ).toEqual(['CONFLICTING_EQUALITY']);
    expect(warn(group('and', [cond('age', 'in', [1, 2]), cond('age', 'eq', 3)]))).toEqual([
      'EMPTY_INTERSECTION',
    ]);
    expect(
      warn(group('and', [cond('status', 'in', ['active']), cond('status', 'in', ['pending'])])),
    ).toEqual(['EMPTY_INTERSECTION']);
    expect(
      warn(
        group('and', [
          cond('status', 'in', ['active', 'pending']),
          cond('status', 'eq', 'pending'),
        ]),
      ),
    ).toEqual([]);
  });

  it('detects null conflicts', () => {
    expect(warn(group('and', [cond('phone', 'isNull'), cond('phone', 'contains', '9')]))).toEqual([
      'CONFLICTING_NULL',
    ]);
    expect(warn(group('and', [cond('phone', 'isNull'), cond('phone', 'isEmpty')]))).toEqual([]);
    expect(
      warn(group('and', [cond('phone', 'isNotNull'), cond('phone', 'contains', '9')])),
    ).toEqual([]);
  });

  it('ignores OR groups, negated groups and single conditions, but visits nested ANDs', () => {
    expect(warn(group('or', [cond('age', 'gt', 30), cond('age', 'lt', 20)]))).toEqual([]);
    expect(
      warn(group('and', [cond('age', 'gt', 30), cond('age', 'lt', 20)], { not: true })),
    ).toEqual([]);
    expect(warn(group('and', [cond('age', 'gt', 30)]))).toEqual([]);
    expect(
      warn(
        group('or', [
          cond('verified', 'eq', true),
          group('and', [cond('age', 'gt', 30), cond('age', 'lt', 20)]),
        ]),
      ),
    ).toEqual(['EMPTY_RANGE']);
    expect(analyzeConflicts(query(null), usersSchema)).toEqual([]);
    expect(warn(group('and', [cond('ghost', 'gt', 30), cond('ghost', 'lt', 20)]))).toEqual([]);
  });
});
