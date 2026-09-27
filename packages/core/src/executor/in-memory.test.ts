import { describe, expect, it } from 'vitest';
import type { FilterCondition, FilterNode, SortSpec, TableQuery } from '../protocol/types.js';
import { userRows, usersSchema, type UserRow } from '../testing/fixtures.js';
import { compileComparator, defaultGetValue, executeQuery } from './in-memory.js';

const NOW = Date.UTC(2024, 5, 15, 12); // 2024-06-15 12:00Z

const cond = (field: string, operator: FilterCondition['operator'], value?: FilterCondition['value'], extra: Partial<FilterCondition> = {}): FilterCondition => ({
  type: 'condition',
  id: `${field}-${operator}`,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
  ...extra,
});

const query = (children: FilterNode[] = [], extra: Partial<TableQuery> = {}): TableQuery => ({
  version: '1.0',
  resource: 'users',
  search: null,
  filter: children.length === 0 ? null : { type: 'group', id: 'root', logic: 'and', children },
  sort: [],
  pagination: { type: 'page', page: 1, pageSize: 100 },
  context: { timezone: 'UTC' },
  ...extra,
});

const names = (q: TableQuery): string[] => executeQuery(userRows, q, { schema: usersSchema, now: NOW }).rows.map((r) => r.name);
const where = (...c: FilterNode[]): string[] => names(query(c));

describe('executeQuery: text', () => {
  it('compares case-insensitively by default', () => {
    expect(where(cond('name', 'contains', 'RAHUL'))).toEqual(['Rahul Sharma', 'rahul verma']);
    expect(where(cond('name', 'contains', 'Rahul', { options: { caseSensitive: true } }))).toEqual(['Rahul Sharma']);
    expect(where(cond('email', 'eq', 'rahul.v@EXAMPLE.com'))).toEqual(['rahul verma']);
    expect(where(cond('name', 'startsWith', 'john'))).toEqual(['John Smith']);
    expect(where(cond('name', 'endsWith', 'MÜLLER'))).toEqual(['Anna Müller']);
    expect(where(cond('country', 'in', ['india', 'us']))).toEqual(['Rahul Sharma', 'Priya Patel', 'John Smith']);
  });

  it('never matches null with value operators, including negative ones', () => {
    expect(where(cond('country', 'neq', 'India'))).toEqual(['John Smith', 'Anna Müller']);
    expect(where(cond('country', 'notIn', ['India']))).toEqual(['John Smith', 'Anna Müller']);
    expect(where(cond('email', 'notContains', 'rahul'))).toEqual(['Priya Patel', 'John Smith']);
  });

  it('distinguishes isNull from isEmpty', () => {
    expect(where(cond('phone', 'isNull'))).toEqual(['Priya Patel']);
    expect(where(cond('phone', 'isEmpty'))).toEqual(['Priya Patel', 'Anna Müller']);
    expect(where(cond('phone', 'isNotEmpty'))).toHaveLength(3);
    expect(where(cond('phone', 'isNotNull'))).toHaveLength(4);
  });

  it('reads nested and dotted fields', () => {
    expect(where(cond('address.city', 'eq', 'pune'))).toEqual(['rahul verma']);
    expect(defaultGetValue({ 'address.city': 'flat' }, 'address.city')).toBe('flat');
    expect(defaultGetValue({ a: null }, 'a.b')).toBeUndefined();
    expect(defaultGetValue(null, 'a')).toBeUndefined();
    expect(defaultGetValue({ a: 1 }, 'b')).toBeUndefined();
  });
});

describe('executeQuery: numbers, booleans, enums', () => {
  it('compares numbers and skips nulls', () => {
    expect(where(cond('age', 'gt', 30))).toEqual(['Rahul Sharma', 'John Smith']);
    expect(where(cond('age', 'between', [24, 27]))).toEqual(['Priya Patel', 'rahul verma']);
    expect(where(cond('age', 'notBetween', [24, 40]))).toEqual(['John Smith']);
    expect(where(cond('age', 'in', [24, 45]))).toEqual(['Priya Patel', 'John Smith']);
    expect(where(cond('age', 'notIn', [24, 45]))).toEqual(['Rahul Sharma', 'rahul verma']);
    expect(where(cond('age', 'neq', 31))).toHaveLength(3);
    expect(where(cond('age', 'gte', 45), cond('age', 'lte', 45), cond('age', 'eq', 45))).toEqual(['John Smith']);
    expect(where(cond('age', 'lt', 25))).toEqual(['Priya Patel']);
    expect(where(cond('discount', 'gt', 0.2))).toEqual(['Priya Patel']);
  });

  it('matches booleans and enums', () => {
    expect(where(cond('verified', 'eq', true))).toEqual(['Rahul Sharma', 'John Smith', 'rahul verma']);
    expect(where(cond('verified', 'eq', false))).toEqual(['Priya Patel', 'Anna Müller']);
    expect(where(cond('status', 'eq', 'active'))).toHaveLength(3);
    expect(where(cond('status', 'notIn', ['active', 'pending']))).toEqual(['Anna Müller']);
  });

  it('coerces numeric strings and boolean strings in rows', () => {
    const rows = [{ n: '5', b: 'true' }, { n: 'x', b: 'no' }, { n: '', b: false }];
    const schema = usersSchema;
    const q = query([cond('age', 'eq', 5)]);
    const got = executeQuery(rows, q, { schema, getValue: (r, f) => (f === 'age' ? r.n : r.b) });
    expect(got.total).toBe(1);
    const bools = executeQuery(rows, query([cond('verified', 'eq', true)]), { schema, getValue: (r) => r.b });
    expect(bools.total).toBe(1);
  });
});

describe('executeQuery: dates', () => {
  it('evaluates date fields by calendar day', () => {
    expect(where(cond('birthDate', 'before', '1990-01-01'))).toEqual(['John Smith']);
    expect(where(cond('birthDate', 'onOrAfter', '2001-07-01'))).toEqual(['Priya Patel']);
  });

  it('evaluates relative datetime ranges against the injected clock and timezone', () => {
    expect(where(cond('createdAt', 'last', { amount: 7, unit: 'day' }))).toEqual(['Rahul Sharma', 'Priya Patel', 'rahul verma']);
    expect(where(cond('createdAt', 'today'))).toEqual(['rahul verma']);
    // In Kolkata, 2024-06-15T00:30Z is 06:00 on the 15th and 2024-06-14T18:30Z is midnight of the 15th.
    const kolkata = names(query([cond('createdAt', 'today')], { context: { timezone: 'Asia/Kolkata' } }));
    expect(kolkata).toEqual(['Priya Patel', 'rahul verma']);
    expect(where(cond('createdAt', 'eq', '2024-06-10'))).toEqual(['Rahul Sharma']);
    expect(where(cond('createdAt', 'isNull'))).toEqual([]);
  });

  it('ignores malformed operands instead of throwing', () => {
    expect(where(cond('createdAt', 'eq', 'nonsense'))).toEqual([]);
  });

  it('defaults to UTC when the query has no context', () => {
    const q = query([cond('createdAt', 'today')]);
    delete (q as { context?: unknown }).context;
    expect(names(q)).toEqual(['rahul verma']);
  });
});

describe('executeQuery: groups and search', () => {
  it('supports OR and negated groups', () => {
    const or: FilterNode = { type: 'group', id: 'g', logic: 'or', children: [cond('age', 'lt', 25), cond('age', 'gt', 40)] };
    expect(where(or)).toEqual(['Priya Patel', 'John Smith']);
    expect(where({ ...or, not: true })).toEqual(['Rahul Sharma', 'Anna Müller', 'rahul verma']);
  });

  it('searches searchable fields and enum labels', () => {
    expect(names(query([], { search: { query: 'example.com' } }))).toHaveLength(4);
    expect(names(query([], { search: { query: 'Rahul', fields: ['name'] } }))).toEqual(['Rahul Sharma', 'rahul verma']);
    expect(names(query([], { search: { query: 'Inact', fields: ['status'] } }))).toEqual(['Anna Müller']);
    expect(names(query([], { search: { query: 'act', fields: ['status'] } }))).toHaveLength(4);
    expect(names(query([cond('verified', 'eq', true)], { search: { query: 'rahul' } }))).toEqual(['Rahul Sharma', 'rahul verma']);
    expect(names(query([], { search: { query: 'x', fields: ['ghost'] } }))).toEqual([]);
  });

  it('returns nothing for conditions on unknown fields', () => {
    expect(where(cond('ghost', 'eq', 'x'))).toEqual([]);
  });

  it('handles non-text cell values safely', () => {
    const rows = [{ name: { first: 'x' } }, { name: new Date(Date.UTC(2024, 0, 1)) }, { name: 5 }];
    const got = executeQuery(rows as unknown as UserRow[], query([], { search: { query: '2024', fields: ['name'] } }), { schema: usersSchema });
    expect(got.total).toBe(1);
  });
});

describe('executeQuery: sorting', () => {
  const sorted = (sort: SortSpec[]) => names(query([], { sort }));

  it('sorts by multiple keys with nulls last by default', () => {
    expect(sorted([{ field: 'age', direction: 'asc' }])).toEqual(['Priya Patel', 'rahul verma', 'Rahul Sharma', 'John Smith', 'Anna Müller']);
    expect(sorted([{ field: 'age', direction: 'desc' }])).toEqual(['John Smith', 'Rahul Sharma', 'rahul verma', 'Priya Patel', 'Anna Müller']);
    expect(sorted([{ field: 'age', direction: 'asc', nulls: 'first' }])[0]).toBe('Anna Müller');
    expect(sorted([{ field: 'verified', direction: 'desc' }, { field: 'name', direction: 'asc' }])).toEqual(['John Smith', 'Rahul Sharma', 'rahul verma', 'Anna Müller', 'Priya Patel']);
  });

  it('sorts dates, datetimes and strings with a locale-aware collator', () => {
    expect(sorted([{ field: 'createdAt', direction: 'desc' }])[0]).toBe('rahul verma');
    expect(sorted([{ field: 'birthDate', direction: 'asc' }])).toEqual(['John Smith', 'Rahul Sharma', 'rahul verma', 'Priya Patel', 'Anna Müller']);
    expect(sorted([{ field: 'country', direction: 'asc' }])).toEqual(['Anna Müller', 'Rahul Sharma', 'Priya Patel', 'John Smith', 'rahul verma']);
    expect(sorted([{ field: 'status', direction: 'asc' }])[0]).toBe('Rahul Sharma');
  });

  it('keeps input order for ties and when unsorted', () => {
    expect(sorted([])).toEqual(userRows.map((r) => r.name));
    expect(compileComparator([], { schema: usersSchema })).toBeUndefined();
    expect(sorted([{ field: 'ghost', direction: 'asc' }])).toEqual(userRows.map((r) => r.name));
  });
});

describe('executeQuery: pagination', () => {
  const run = (pagination: TableQuery['pagination']) => executeQuery(userRows, query([], { pagination }), { schema: usersSchema });

  it('paginates by page and offset', () => {
    const p2 = run({ type: 'page', page: 2, pageSize: 2 });
    expect(p2.rows.map((r) => r.name)).toEqual(['John Smith', 'Anna Müller']);
    expect(p2.total).toBe(5);
    expect(run({ type: 'offset', offset: 4, limit: 2 }).rows).toHaveLength(1);
  });

  it('issues and follows opaque cursors', () => {
    const first = run({ type: 'cursor', cursor: null, limit: 2 });
    expect(first.pageInfo.prevCursor).toBeUndefined();
    const second = run({ type: 'cursor', cursor: first.pageInfo.nextCursor!, limit: 2 });
    expect(second.rows.map((r) => r.name)).toEqual(['John Smith', 'Anna Müller']);
    expect(second.pageInfo.prevCursor).toBeNull();
    const third = run({ type: 'cursor', cursor: second.pageInfo.nextCursor!, limit: 2 });
    expect(third.rows).toHaveLength(1);
    expect(third.pageInfo.nextCursor).toBeNull();
    expect(third.pageInfo.prevCursor).toBe(first.pageInfo.nextCursor);
    expect(run({ type: 'cursor', cursor: 'garbage!', limit: 2 }).rows[0]?.name).toBe('Rahul Sharma');
  });
});
