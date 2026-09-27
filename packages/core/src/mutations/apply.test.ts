import { describe, expect, it } from 'vitest';
import { createInitialQuery } from '../protocol/query.js';
import type { FilterCondition, FilterGroup, Mutation, TableQuery } from '../protocol/types.js';
import { usersSchema } from '../testing/fixtures.js';
import { sequentialIds } from '../util/ids.js';
import { applyMutations, type ApplyOptions } from './apply.js';

const cond = (
  id: string,
  field: string,
  operator: FilterCondition['operator'],
  value?: FilterCondition['value'],
): FilterCondition => ({
  type: 'condition',
  id,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});

const initial = createInitialQuery(usersSchema, { context: { timezone: 'Asia/Kolkata' } });
const opts = (extra: Partial<ApplyOptions> = {}): ApplyOptions => ({
  schema: usersSchema,
  idGenerator: sequentialIds(),
  ...extra,
});
const apply = (state: TableQuery, mutations: Mutation[], extra: Partial<ApplyOptions> = {}) =>
  applyMutations(state, mutations, opts(extra));

const withIndia = apply(initial, [
  { op: 'addFilter', node: cond('f1', 'country', 'eq', 'India') },
]).query;

describe('applyMutations: filters', () => {
  it('wraps the first filter in a root AND group', () => {
    expect(withIndia.filter).toEqual({
      type: 'group',
      id: 'g_1',
      logic: 'and',
      children: [cond('f1', 'country', 'eq', 'India')],
    });
  });

  it('merges: sorting keeps existing filters', () => {
    const r = apply(withIndia, [
      { op: 'setSort', sort: [{ field: 'createdAt', direction: 'desc' }] },
    ]);
    expect(r.query.filter).toEqual(withIndia.filter);
    expect(r.query.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
  });

  it('appends AND filters without nesting and splices same-logic groups', () => {
    const r = apply(withIndia, [
      { op: 'addFilter', node: cond('f2', 'age', 'gt', 25) },
      {
        op: 'addFilter',
        node: {
          type: 'group',
          id: 'gx',
          logic: 'and',
          children: [cond('f3', 'verified', 'eq', true)],
        },
      },
    ]);
    expect(r.query.filter?.children.map((c) => c.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('wraps when combining with a different logic', () => {
    const r = apply(withIndia, [
      { op: 'addFilter', node: cond('f2', 'country', 'eq', 'US'), logic: 'or' },
    ]);
    expect(r.query.filter?.logic).toBe('or');
    expect(r.query.filter?.children).toHaveLength(2);
    expect(r.query.filter?.children[0]?.id).toBe('g_1');
  });

  it('re-generates colliding node ids', () => {
    const r = apply(withIndia, [{ op: 'addFilter', node: cond('f1', 'age', 'gt', 1) }]);
    const ids = r.query.filter!.children.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toBe('f_1');
  });

  it('removes by field, pruning empty groups, and warns on multiple matches', () => {
    const state = apply(withIndia, [
      {
        op: 'addFilter',
        node: {
          type: 'group',
          id: 'g2',
          logic: 'or',
          children: [cond('f2', 'country', 'eq', 'US'), cond('f3', 'country', 'eq', 'UK')],
        },
      },
      { op: 'addFilter', node: cond('f4', 'age', 'gt', 25) },
    ]).query;
    const r = apply(state, [{ op: 'removeFilter', target: { field: 'country' } }]);
    expect(r.issues).toEqual([]);
    expect(r.query.filter?.children.map((c) => c.id)).toEqual(['f4']);
    expect(r.warnings[0]).toMatchObject({
      code: 'MULTIPLE_TARGETS_AFFECTED',
      params: { count: 3 },
    });
  });

  it('removes by id, including whole groups and the root', () => {
    const state = apply(withIndia, [
      {
        op: 'addFilter',
        node: {
          type: 'group',
          id: 'g2',
          logic: 'or',
          children: [cond('f2', 'age', 'lt', 5), cond('f3', 'age', 'gt', 60)],
        },
      },
    ]).query;
    const r = apply(state, [{ op: 'removeFilter', target: { id: 'g2' } }]);
    expect(r.query.filter?.children.map((c) => c.id)).toEqual(['f1']);
    expect(apply(state, [{ op: 'removeFilter', target: { id: 'g_1' } }]).query.filter).toBeNull();
    expect(
      apply(withIndia, [{ op: 'removeFilter', target: { id: 'f1' } }]).query.filter,
    ).toBeNull();
  });

  it('reports removing a filter that does not exist and leaves state unchanged', () => {
    const r = apply(withIndia, [{ op: 'removeFilter', target: { field: 'age' } }]);
    expect(r.issues[0]).toMatchObject({
      code: 'TARGET_NOT_FOUND',
      message: 'There is no filter on "Age" to remove.',
    });
    expect(r.query).toBe(withIndia);
    expect(apply(initial, [{ op: 'removeFilter', target: { id: 'zzz' } }]).issues[0]?.code).toBe(
      'TARGET_NOT_FOUND',
    );
  });

  it('replaces and clears filters', () => {
    const replaced = apply(withIndia, [
      { op: 'replaceFilter', node: cond('f9', 'age', 'gt', 1) },
    ]).query;
    expect((replaced.filter as FilterGroup).children.map((c) => c.id)).toEqual(['f9']);
    const group: FilterGroup = {
      type: 'group',
      id: 'gr',
      logic: 'or',
      children: [cond('a', 'age', 'gt', 1)],
    };
    expect(apply(withIndia, [{ op: 'replaceFilter', node: group }]).query.filter).toEqual(group);
    expect(apply(withIndia, [{ op: 'replaceFilter', node: null }]).query.filter).toBeNull();
    expect(apply(withIndia, [{ op: 'clearFilters' }]).query.filter).toBeNull();
  });

  it('applies mutations in order ("clear filters and only India")', () => {
    const state = apply(withIndia, [{ op: 'addFilter', node: cond('f2', 'age', 'gt', 25) }]).query;
    const r = apply(state, [
      { op: 'clearFilters' },
      { op: 'addFilter', node: cond('f3', 'country', 'eq', 'India') },
    ]);
    expect(r.query.filter?.children.map((c) => c.id)).toEqual(['f3']);
  });
});

describe('applyMutations: search and sort', () => {
  it('sets and clears search', () => {
    const s = apply(initial, [{ op: 'setSearch', search: { query: 'rahul' } }]).query;
    expect(s.search).toEqual({ query: 'rahul' });
    expect(apply(s, [{ op: 'clearSearch' }]).query.search).toBeNull();
  });

  it('adds sorts, replacing an existing spec for the same field', () => {
    const s = apply(initial, [
      { op: 'addSort', spec: { field: 'country', direction: 'asc' } },
      { op: 'addSort', spec: { field: 'age', direction: 'desc' } },
      { op: 'addSort', spec: { field: 'country', direction: 'desc' } },
    ]).query;
    expect(s.sort).toEqual([
      { field: 'age', direction: 'desc' },
      { field: 'country', direction: 'desc' },
    ]);
    expect(apply(s, [{ op: 'removeSort', field: 'age' }]).query.sort).toEqual([
      { field: 'country', direction: 'desc' },
    ]);
    expect(apply(s, [{ op: 'clearSort' }]).query.sort).toEqual([]);
  });

  it('enforces maxSorts and reports removing an absent sort', () => {
    const fields = ['name', 'email', 'age', 'country', 'status', 'verified'];
    const r = apply(
      initial,
      fields.map((field) => ({ op: 'addSort', spec: { field, direction: 'asc' } })),
    );
    expect(r.issues[0]?.code).toBe('LIMIT_EXCEEDED');
    expect(apply(initial, [{ op: 'removeSort', field: 'age' }]).issues[0]).toMatchObject({
      code: 'TARGET_NOT_FOUND',
      field: 'age',
    });
  });
});

describe('applyMutations: pagination', () => {
  const page4 = { ...withIndia, pagination: { type: 'page' as const, page: 4, pageSize: 20 } };

  it('returns to the first page when the result set changes', () => {
    for (const m of [
      { op: 'addFilter', node: cond('x', 'age', 'gt', 1) },
      { op: 'setSearch', search: { query: 'x' } },
      { op: 'setSort', sort: [] },
      { op: 'clearFilters' },
    ] as Mutation[]) {
      expect(apply(page4, [m]).query.pagination).toEqual({ type: 'page', page: 1, pageSize: 20 });
    }
  });

  it('keeps an explicit page in the same batch', () => {
    const r = apply(page4, [
      { op: 'setPageSize', size: 50 },
      { op: 'setPage', page: 3 },
    ]);
    expect(r.query.pagination).toEqual({ type: 'page', page: 3, pageSize: 50 });
    expect(apply(page4, [{ op: 'setPageSize', size: 50 }]).query.pagination).toEqual({
      type: 'page',
      page: 1,
      pageSize: 50,
    });
  });

  it('navigates page-based pagination and clamps at page 1', () => {
    expect(apply(page4, [{ op: 'nextPage' }]).query.pagination).toMatchObject({ page: 5 });
    expect(apply(page4, [{ op: 'prevPage' }]).query.pagination).toMatchObject({ page: 3 });
    const r = apply(initial, [{ op: 'prevPage' }]);
    expect(r.query.pagination).toMatchObject({ page: 1 });
    expect(r.warnings[0]?.code).toBe('PAGE_CLAMPED');
  });

  it('navigates offset pagination', () => {
    const offset = { ...initial, pagination: { type: 'offset' as const, offset: 40, limit: 20 } };
    expect(apply(offset, [{ op: 'nextPage' }]).query.pagination).toEqual({
      type: 'offset',
      offset: 60,
      limit: 20,
    });
    expect(apply(offset, [{ op: 'setPage', page: 2 }]).query.pagination).toEqual({
      type: 'offset',
      offset: 20,
      limit: 20,
    });
    expect(apply(offset, [{ op: 'setPageSize', size: 10 }]).query.pagination).toEqual({
      type: 'offset',
      offset: 0,
      limit: 10,
    });
    const near = { ...initial, pagination: { type: 'offset' as const, offset: 5, limit: 20 } };
    const back = apply(near, [{ op: 'prevPage' }]);
    expect(back.query.pagination).toEqual({ type: 'offset', offset: 0, limit: 20 });
    expect(back.warnings).toEqual([]);
    const atStart = { ...initial, pagination: { type: 'offset' as const, offset: 0, limit: 20 } };
    expect(apply(atStart, [{ op: 'prevPage' }]).warnings[0]?.code).toBe('PAGE_CLAMPED');
  });

  it('navigates cursor pagination with page info', () => {
    const first = { ...initial, pagination: { type: 'cursor' as const, cursor: null, limit: 20 } };
    expect(
      apply(first, [{ op: 'nextPage' }], { pageInfo: { nextCursor: 'abc' } }).query.pagination,
    ).toEqual({ type: 'cursor', cursor: 'abc', limit: 20 });
    expect(
      apply(first, [{ op: 'nextPage' }], { pageInfo: { nextCursor: null } }).issues[0],
    ).toMatchObject({ code: 'TARGET_NOT_FOUND', messageKey: 'pagination.noNextPage' });
    expect(apply(first, [{ op: 'nextPage' }]).issues[0]?.code).toBe('TARGET_NOT_FOUND');
    expect(apply(first, [{ op: 'prevPage' }]).warnings[0]?.code).toBe('PAGE_CLAMPED');
    const second = { ...first, pagination: { ...first.pagination, cursor: 'abc' } };
    expect(
      apply(second, [{ op: 'prevPage' }], { pageInfo: { prevCursor: null } }).query.pagination,
    ).toMatchObject({ cursor: null });
    expect(
      apply(second, [{ op: 'prevPage' }], { pageInfo: { prevCursor: 'p1' } }).query.pagination,
    ).toMatchObject({ cursor: 'p1' });
    expect(apply(second, [{ op: 'prevPage' }]).issues[0]?.messageKey).toBe('pagination.noPrevPage');
    expect(apply(first, [{ op: 'setPage', page: 3 }]).issues[0]?.code).toBe(
      'CAPABILITY_UNSUPPORTED',
    );
    expect(apply(first, [{ op: 'setPageSize', size: 5 }]).query.pagination).toEqual({
      type: 'cursor',
      cursor: null,
      limit: 5,
    });
  });
});

describe('applyMutations: reset and atomicity', () => {
  it('reset restores defaults but keeps pagination style and context', () => {
    const offsetState: TableQuery = {
      ...withIndia,
      search: { query: 'x' },
      sort: [{ field: 'age', direction: 'asc' }],
      pagination: { type: 'offset', offset: 60, limit: 50 },
    };
    const r = apply(offsetState, [{ op: 'reset' }]);
    expect(r.query).toEqual({
      version: '1.0',
      resource: 'users',
      search: null,
      filter: null,
      sort: [],
      pagination: { type: 'offset', offset: 0, limit: 20 },
      context: { timezone: 'Asia/Kolkata' },
    });
    const noContext: TableQuery = { ...withIndia };
    delete (noContext as { context?: unknown }).context;
    expect(apply(noContext, [{ op: 'reset' }]).query.context).toBeUndefined();
  });

  it('is all-or-nothing', () => {
    const r = apply(withIndia, [
      { op: 'clearFilters' },
      { op: 'removeSort', field: 'age' },
      { op: 'setSearch', search: { query: 'x' } },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.query).toBe(withIndia);
  });

  it('uses random ids by default', () => {
    const r = applyMutations(initial, [{ op: 'addFilter', node: cond('f1', 'age', 'gt', 1) }], {
      schema: usersSchema,
    });
    expect(r.query.filter?.id).toMatch(/^g_[0-9a-z]{10}$/);
  });
});
