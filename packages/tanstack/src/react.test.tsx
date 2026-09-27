import { createInitialQuery, defineSchema, type TableQuery } from '@pragma/core';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { usePragmaTable } from './react.js';

interface Row {
  id: number;
  name: string;
  age: number | null;
}

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'people',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
  ],
  defaults: { pageSize: 2 },
});

const data: Row[] = [
  { id: 1, name: 'Cara', age: 31 },
  { id: 2, name: 'abe', age: null },
  { id: 3, name: 'Bea', age: 22 },
  { id: 4, name: 'dan', age: 40 },
  { id: 5, name: 'Eve', age: 22 },
];
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'age', header: 'Age' },
];

function useHarness(mode: 'client' | 'server' = 'client', initial?: TableQuery) {
  const [query, setQuery] = useState<TableQuery>(initial ?? createInitialQuery(schema));
  const result = usePragmaTable<Row>({
    schema,
    query,
    onQueryChange: setQuery,
    data,
    columns: columns,
    mode,
    rowCount: 42,
  });
  const ids = result.table.getRowModel().rows.map((r) => r.original.id);
  return { query, ids, ...result };
}

describe('usePragmaTable', () => {
  it('renders the Pragma-executed page in client mode', () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.ids).toEqual([1, 2]);
    expect(result.current.rowCount).toBe(5);
    expect(result.current.table.getPageCount()).toBe(3);
  });

  it('routes header sorting back into the query', () => {
    const { result } = renderHook(() => useHarness());
    act(() => {
      result.current.table.setSorting([{ id: 'age', desc: false }]);
    });
    expect(result.current.query.sort).toEqual([{ field: 'age', direction: 'asc' }]);
    expect(result.current.ids).toEqual([3, 5]);
    act(() => {
      result.current.table.setSorting((prev) => prev.map((s) => ({ ...s, desc: true })));
    });
    expect(result.current.ids).toEqual([4, 1]);
  });

  it('routes pager interactions back into the query', () => {
    const { result } = renderHook(() => useHarness());
    act(() => {
      result.current.table.nextPage();
    });
    expect(result.current.query.pagination).toEqual({ type: 'page', page: 2, pageSize: 2 });
    expect(result.current.ids).toEqual([3, 4]);
    act(() => {
      result.current.table.setPageSize(4);
    });
    expect(result.current.query.pagination).toEqual({ type: 'page', page: 1, pageSize: 4 });
  });

  it('passes server pages through untouched', () => {
    const { result } = renderHook(() => useHarness('server'));
    expect(result.current.ids).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.rowCount).toBe(42);
    expect(result.current.pageInfo).toBeUndefined();
  });

  it('reflects offset and cursor pagination', () => {
    const offset = renderHook(() =>
      useHarness('client', {
        ...createInitialQuery(schema),
        pagination: { type: 'offset', offset: 2, limit: 2 },
      }),
    );
    expect(offset.result.current.table.state.pagination).toEqual({ pageIndex: 1, pageSize: 2 });
    const cursor = renderHook(() =>
      useHarness('server', {
        ...createInitialQuery(schema),
        pagination: { type: 'cursor', cursor: null, limit: 3 },
      }),
    );
    expect(cursor.result.current.table.state.pagination).toEqual({ pageIndex: 0, pageSize: 3 });
  });
});
