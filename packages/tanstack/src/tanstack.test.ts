import { createInitialQuery, defineSchema, type FilterGroup, type TableQuery } from '@pragma/core';
import { describe, expect, it } from 'vitest';
import { schemaFromColumns, withPragmaColumns } from './columns.js';
import { pragmaFilterFn, pragmaGlobalFilterFn, pragmaSortFn, type ValueRow } from './fns.js';
import { fromTanStackState, toTanStackState, type PragmaColumnFilterValue } from './state.js';

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'users',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'country', label: 'Country', type: 'string' },
    { id: 'phone', label: 'Phone', type: 'string', sortable: false },
  ],
  capabilities: { pagination: ['page', 'offset', 'cursor'], maxPageSize: 50, maxSorts: 2 },
});
const base = createInitialQuery(schema, { context: { timezone: 'UTC' } });
const cond = (
  id: string,
  field: string,
  operator: 'eq' | 'gt' | 'lt' | 'contains',
  value: unknown,
) =>
  ({ type: 'condition' as const, id, field, operator, value }) as FilterGroup['children'][number];
const group = (logic: 'and' | 'or', ...children: FilterGroup['children']): FilterGroup => ({
  type: 'group',
  id: 'root',
  logic,
  children,
});
const row = (values: Record<string, unknown>): ValueRow => ({ getValue: (id) => values[id] });

describe('toTanStackState', () => {
  it('maps conjunctions to column filters, grouped by field', () => {
    const state = toTanStackState({
      ...base,
      filter: group(
        'and',
        cond('a', 'age', 'gt', 20),
        cond('b', 'age', 'lt', 40),
        cond('c', 'country', 'eq', 'India'),
      ),
    });
    expect(state.columnFilters.map((f) => f.id)).toEqual(['age', 'country']);
    expect((state.columnFilters[0]!.value as PragmaColumnFilterValue).conditions).toHaveLength(2);
    expect(state.globalFilter).toBeUndefined();
  });

  it('maps OR filters and search to a global filter', () => {
    const orState = toTanStackState({
      ...base,
      filter: group('or', cond('a', 'age', 'gt', 60), cond('b', 'age', 'lt', 18)),
    });
    expect(orState.columnFilters).toEqual([]);
    expect(orState.globalFilter).toMatchObject({
      kind: 'pragma',
      search: null,
      filter: { logic: 'or' },
    });
    const searchState = toTanStackState({
      ...base,
      search: { query: 'x' },
      filter: group('and', cond('a', 'age', 'gt', 1)),
    });
    expect(searchState.columnFilters).toHaveLength(1);
    expect(searchState.globalFilter).toMatchObject({ search: { query: 'x' }, filter: null });
  });

  it('maps sorting and each pagination style', () => {
    const q: TableQuery = {
      ...base,
      sort: [
        { field: 'age', direction: 'desc' },
        { field: 'name', direction: 'asc' },
      ],
      pagination: { type: 'page', page: 3, pageSize: 20 },
    };
    expect(toTanStackState(q)).toMatchObject({
      sorting: [
        { id: 'age', desc: true },
        { id: 'name', desc: false },
      ],
      pagination: { pageIndex: 2, pageSize: 20 },
    });
    expect(
      toTanStackState({ ...base, pagination: { type: 'offset', offset: 40, limit: 20 } })
        .pagination,
    ).toEqual({ pageIndex: 2, pageSize: 20 });
    expect(
      toTanStackState({ ...base, pagination: { type: 'cursor', cursor: null, limit: 20 } })
        .pagination,
    ).toBeUndefined();
    const noContext: TableQuery = { ...base, filter: group('and', cond('a', 'age', 'gt', 1)) };
    delete (noContext as { context?: unknown }).context;
    expect(
      (toTanStackState(noContext).columnFilters[0]!.value as PragmaColumnFilterValue).context,
    ).toBeUndefined();
  });
});

describe('fromTanStackState', () => {
  it('applies header sorting, ignoring unknown and non-sortable columns and returning to page 1', () => {
    const onPage3: TableQuery = {
      ...base,
      sort: [{ field: 'age', direction: 'asc', nulls: 'first' }],
      pagination: { type: 'page', page: 3, pageSize: 20 },
    };
    const next = fromTanStackState(
      onPage3,
      {
        sorting: [
          { id: 'age', desc: true },
          { id: 'phone', desc: false },
          { id: 'ghost', desc: false },
          { id: 'age', desc: false },
        ],
      },
      schema,
    );
    expect(next.sort).toEqual([{ field: 'age', direction: 'desc', nulls: 'first' }]);
    expect(next.pagination).toEqual({ type: 'page', page: 1, pageSize: 20 });
    const limited = fromTanStackState(
      base,
      {
        sorting: [
          { id: 'age', desc: false },
          { id: 'name', desc: false },
          { id: 'country', desc: false },
        ],
      },
      schema,
    );
    expect(limited.sort).toHaveLength(2);
  });

  it('leaves the query untouched when nothing changes', () => {
    const q: TableQuery = { ...base, sort: [{ field: 'age', direction: 'asc' }] };
    expect(fromTanStackState(q, { sorting: [{ id: 'age', desc: false }] }, schema)).toBe(q);
  });

  it('applies pager changes for page and offset pagination, clamping sizes', () => {
    expect(
      fromTanStackState(base, { pagination: { pageIndex: 4, pageSize: 20 } }, schema).pagination,
    ).toEqual({ type: 'page', page: 5, pageSize: 20 });
    expect(
      fromTanStackState(base, { pagination: { pageIndex: 4, pageSize: 500 } }, schema).pagination,
    ).toEqual({ type: 'page', page: 1, pageSize: 50 });
    const offset: TableQuery = { ...base, pagination: { type: 'offset', offset: 0, limit: 10 } };
    expect(
      fromTanStackState(offset, { pagination: { pageIndex: 3, pageSize: 10 } }, schema).pagination,
    ).toEqual({ type: 'offset', offset: 30, limit: 10 });
    expect(
      fromTanStackState(base, { pagination: { pageIndex: -2.5, pageSize: 0 } }, schema).pagination,
    ).toEqual({ type: 'page', page: 1, pageSize: 1 });
  });

  it('only changes the page size for cursor pagination', () => {
    const cursor: TableQuery = {
      ...base,
      pagination: { type: 'cursor', cursor: 'abc', limit: 10 },
    };
    expect(
      fromTanStackState(cursor, { pagination: { pageIndex: 5, pageSize: 10 } }, schema).pagination,
    ).toBe(cursor.pagination);
    expect(
      fromTanStackState(cursor, { pagination: { pageIndex: 5, pageSize: 25 } }, schema).pagination,
    ).toEqual({ type: 'cursor', cursor: null, limit: 25 });
    expect(
      fromTanStackState(cursor, { sorting: [{ id: 'age', desc: true }] }, schema).pagination,
    ).toEqual({ type: 'cursor', cursor: null, limit: 10 });
  });
});

describe('filter and sort functions', () => {
  it('evaluates Pragma column filters and caches compiled predicates', () => {
    const fn = pragmaFilterFn(schema, { now: () => 0 });
    const value: PragmaColumnFilterValue = {
      kind: 'pragma',
      conditions: [cond('a', 'age', 'gt', 20) as never, cond('b', 'age', 'lt', 40) as never],
    };
    expect(fn(row({ age: 30 }), 'age', value)).toBe(true);
    expect(fn(row({ age: 50 }), 'age', value)).toBe(false);
    expect(fn(row({ age: null }), 'age', value)).toBe(false);
  });

  it('treats plain filter values as case-insensitive contains, and auto-removes empty ones', () => {
    const fn = pragmaFilterFn(schema);
    expect(fn(row({ name: 'Rahul Sharma' }), 'name', 'SHAR')).toBe(true);
    expect(fn(row({ name: 'Rahul' }), 'name', 'x')).toBe(false);
    expect(fn(row({ name: null }), 'name', 'x')).toBe(false);
    expect(fn(row({ name: 'a' }), 'name', '')).toBe(true);
    expect(fn.autoRemove('')).toBe(true);
    expect(fn.autoRemove(undefined)).toBe(true);
    expect(fn.autoRemove({ kind: 'pragma', conditions: [] })).toBe(true);
    expect(fn.autoRemove('x')).toBe(false);
  });

  it('evaluates whole-row global filters', () => {
    const fn = pragmaGlobalFilterFn(schema);
    const value = {
      kind: 'pragma' as const,
      search: { query: 'rah' },
      filter: group('or', cond('a', 'age', 'gt', 60), cond('b', 'country', 'eq', 'India')),
    };
    expect(fn(row({ name: 'Rahul', age: 30, country: 'india' }), 'name', value)).toBe(true);
    expect(fn(row({ name: 'Rahul', age: 30, country: 'US' }), 'age', value)).toBe(false);
    expect(fn(row({ name: 'x' }), 'name', 'plain text')).toBe(true);
  });

  it('compares ascending with locale- and number-aware collation', () => {
    const sort = pragmaSortFn(schema, { locale: 'en' });
    expect(sort(row({ name: 'item 2' }), row({ name: 'Item 10' }), 'name')).toBeLessThan(0);
    expect(sort(row({ age: 5 }), row({ age: 3 }), 'age')).toBeGreaterThan(0);
    expect(pragmaSortFn(schema)(row({ ghost: 1 }), row({ ghost: 2 }), 'ghost')).toBe(0);
  });
});

describe('columns', () => {
  it('derives a schema from column metadata', () => {
    const derived = schemaFromColumns(
      [
        {
          accessorKey: 'name',
          header: 'Full name',
          meta: { pragma: { type: 'string', aliases: ['who'] } },
        },
        {
          id: 'group',
          header: 'Group',
          columns: [{ accessorKey: 'age', meta: { pragma: { type: 'number' } } }],
        },
        { accessorKey: 'avatar', header: 'Avatar' },
        { accessorKey: 'internal', meta: { pragma: false } },
        { accessorKey: 1, header: () => 'x', meta: { pragma: { type: 'number', id: 'first' } } },
      ],
      {
        resource: 'people',
        extraFields: [{ id: 'tenant', label: 'Tenant', type: 'string', hidden: true }],
      },
    );
    expect(derived.fields.map((f) => [f.id, f.label])).toEqual([
      ['name', 'Full name'],
      ['age', 'age'],
      ['first', 'first'],
      ['tenant', 'Tenant'],
    ]);
    expect(derived.fieldsById.get('name')?.aliases).toEqual(['who']);
    expect(() =>
      schemaFromColumns([{ header: 'x', meta: { pragma: { type: 'string' } } }], { resource: 'p' }),
    ).toThrow(/needs an id/);
  });

  it('prepares columns for native row models', () => {
    const accessorFn = (r: { profile: { age: number | null } }) => r.profile.age;
    const cols = withPragmaColumns(
      [
        { accessorKey: 'name' },
        { id: 'age', accessorFn },
        { accessorKey: 'avatar' },
        { header: 'G', columns: [{ accessorKey: 'country' }] },
      ],
      schema,
    );
    const name = cols[0] as unknown as {
      id: string;
      accessorFn: (r: unknown, i: number) => unknown;
      sortUndefined: string;
      accessorKey?: string;
    };
    expect(name.id).toBe('name');
    expect(name.accessorKey).toBeUndefined();
    expect(name.sortUndefined).toBe('last');
    expect(name.accessorFn({ name: null }, 0)).toBeUndefined();
    expect(name.accessorFn({ name: 'Ann' }, 0)).toBe('Ann');
    const age = cols[1] as unknown as { accessorFn: (r: unknown, i: number) => unknown };
    expect(age.accessorFn({ profile: { age: null } }, 0)).toBeUndefined();
    expect(age.accessorFn({ profile: { age: 5 } }, 0)).toBe(5);
    expect(cols[2]).toEqual({ accessorKey: 'avatar' });
    expect((cols[3] as unknown as { columns: { id: string }[] }).columns[0]!.id).toBe('country');
  });
});
