import { describe, expect, it } from 'vitest';
import { OPERATORS, OPERATORS_BY_TYPE, OPERATOR_ARITY, OPERATOR_LABELS, isOperator } from '../operators/catalog.js';
import { parseMutations, parseTableQuery } from './parse.js';
import { collectNodeIds, countConditions, firstPage, flattenFilter, groupDepth, pageSizeOf } from './query.js';
import type { FilterGroup, TableQuery } from './types.js';

const base: TableQuery = {
  version: '1.0',
  resource: 'users',
  search: null,
  filter: null,
  sort: [],
  pagination: { type: 'page', page: 1, pageSize: 20 },
};

describe('operator catalog', () => {
  it('defines arity and label for every operator', () => {
    for (const op of OPERATORS) {
      expect(OPERATOR_ARITY[op]).toBeDefined();
      expect(OPERATOR_LABELS[op]).toBeDefined();
    }
  });

  it('only lists known operators per type', () => {
    for (const ops of Object.values(OPERATORS_BY_TYPE)) for (const op of ops) expect(isOperator(op)).toBe(true);
    expect(isOperator('approximately')).toBe(false);
    expect(isOperator(42)).toBe(false);
  });

  it('keeps string-only operators off numbers', () => {
    expect(OPERATORS_BY_TYPE.number).not.toContain('contains');
    expect(OPERATORS_BY_TYPE.boolean).toEqual(['eq', 'isNull', 'isNotNull']);
  });
});

describe('parseTableQuery', () => {
  it('accepts a minimal query', () => {
    const result = parseTableQuery(base);
    expect(result.success).toBe(true);
  });

  it('accepts nested filters and all pagination types', () => {
    const filter: FilterGroup = {
      type: 'group',
      id: 'g1',
      logic: 'and',
      children: [
        { type: 'condition', id: 'f1', field: 'age', operator: 'gt', value: 25 },
        {
          type: 'group',
          id: 'g2',
          logic: 'or',
          children: [
            { type: 'condition', id: 'f2', field: 'country', operator: 'eq', value: 'India' },
            { type: 'condition', id: 'f3', field: 'createdAt', operator: 'last', value: { amount: 7, unit: 'day' } },
          ],
        },
      ],
    };
    expect(parseTableQuery({ ...base, filter }).success).toBe(true);
    expect(parseTableQuery({ ...base, pagination: { type: 'offset', offset: 0, limit: 10 } }).success).toBe(true);
    expect(parseTableQuery({ ...base, pagination: { type: 'cursor', cursor: null, limit: 10 } }).success).toBe(true);
  });

  it('reports shape errors with paths', () => {
    const result = parseTableQuery({ ...base, sort: [{ field: 'age', direction: 'up' }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.code).toBe('VALIDATION_ERROR');
      expect(result.issues[0]?.path).toEqual(['sort', 0, 'direction']);
    }
  });

  it('rejects unknown properties (strict)', () => {
    expect(parseTableQuery({ ...base, sql: 'DROP TABLE users' }).success).toBe(false);
  });

  it('rejects non-finite numbers and oversized values', () => {
    const cond = (value: unknown): unknown => ({ ...base, filter: { type: 'group', id: 'g', logic: 'and', children: [{ type: 'condition', id: 'f', field: 'age', operator: 'eq', value }] } });
    expect(parseTableQuery(cond(Number.POSITIVE_INFINITY)).success).toBe(false);
    expect(parseTableQuery(cond('x'.repeat(1001))).success).toBe(false);
    expect(parseTableQuery(cond(Array.from({ length: 101 }, (_, i) => i))).success).toBe(false);
  });

  it('distinguishes unsupported major versions', () => {
    const result = parseTableQuery({ ...base, version: '2.0' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
  });

  it('rejects non-objects', () => {
    expect(parseTableQuery(null).success).toBe(false);
    expect(parseTableQuery('query').success).toBe(false);
    const r = parseTableQuery({ ...base, version: 1 });
    expect(r.success).toBe(false);
  });
});

describe('parseMutations', () => {
  it('accepts every mutation op', () => {
    const result = parseMutations([
      { op: 'setSearch', search: { query: 'rahul' } },
      { op: 'clearSearch' },
      { op: 'addFilter', node: { type: 'condition', id: 'f', field: 'age', operator: 'gt', value: 1 }, logic: 'or' },
      { op: 'removeFilter', target: { field: 'age' } },
      { op: 'removeFilter', target: { id: 'f' } },
      { op: 'replaceFilter', node: null },
      { op: 'clearFilters' },
      { op: 'setSort', sort: [{ field: 'age', direction: 'desc' }] },
      { op: 'addSort', spec: { field: 'age', direction: 'asc', nulls: 'first' } },
      { op: 'removeSort', field: 'age' },
      { op: 'clearSort' },
      { op: 'setPage', page: 2 },
      { op: 'nextPage' },
      { op: 'prevPage' },
      { op: 'setPageSize', size: 50 },
      { op: 'reset' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects unknown ops and bad payloads', () => {
    expect(parseMutations([{ op: 'dropTable' }]).success).toBe(false);
    expect(parseMutations([{ op: 'setPage', page: 0 }]).success).toBe(false);
    expect(parseMutations([{ op: 'addFilter', node: { type: 'condition', id: 'f', field: 'age', operator: 'approximately', value: 1 } }]).success).toBe(false);
    expect(parseMutations(Array.from({ length: 51 }, () => ({ op: 'reset' }))).success).toBe(false);
  });
});

describe('query helpers', () => {
  const tree: FilterGroup = {
    type: 'group',
    id: 'g1',
    logic: 'and',
    children: [
      { type: 'condition', id: 'a', field: 'age', operator: 'gt', value: 1 },
      { type: 'group', id: 'g2', logic: 'or', children: [{ type: 'condition', id: 'b', field: 'x', operator: 'isNull' }] },
    ],
  };

  it('counts and measures trees', () => {
    expect(countConditions(tree)).toBe(2);
    expect(countConditions(null)).toBe(0);
    expect(groupDepth(tree)).toBe(2);
    expect(groupDepth(null)).toBe(0);
    expect([...collectNodeIds(tree)].sort()).toEqual(['a', 'b', 'g1', 'g2']);
  });

  it('flattens only pure conjunctions', () => {
    expect(flattenFilter({ filter: null })).toEqual([]);
    expect(flattenFilter({ filter: tree })).toBeNull();
    const flat: FilterGroup = { ...tree, children: [tree.children[0]!] };
    expect(flattenFilter({ filter: flat })).toHaveLength(1);
    expect(flattenFilter({ filter: { ...flat, logic: 'or' } })).toHaveLength(1);
    expect(flattenFilter({ filter: { ...tree, logic: 'or', children: [tree.children[0]!, tree.children[0]!] } })).toBeNull();
    expect(flattenFilter({ filter: { ...flat, not: true } })).toBeNull();
  });

  it('builds first pages for every pagination type', () => {
    expect(firstPage('page', 10)).toEqual({ type: 'page', page: 1, pageSize: 10 });
    expect(firstPage('offset', 10)).toEqual({ type: 'offset', offset: 0, limit: 10 });
    expect(firstPage('cursor', 10)).toEqual({ type: 'cursor', cursor: null, limit: 10 });
    expect(pageSizeOf(firstPage('cursor', 7))).toBe(7);
    expect(pageSizeOf(firstPage('page', 9))).toBe(9);
  });
});
