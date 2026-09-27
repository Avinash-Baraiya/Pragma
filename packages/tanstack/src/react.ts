import type { ResolvedSchema, TableQuery, ValueGetter } from '@pragma/core';
import {
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
  type TableFeatures,
  type Updater,
} from '@tanstack/react-table';
import { useCallback, useMemo, useRef } from 'react';
import { executeForTable } from './controlled.js';
import { fromTanStackState } from './state.js';

/**
 * Minimal feature set for a Pragma-driven table. Pass your own `features`
 * (including these two) when you need more, and keep it module-level/stable.
 *
 * @public
 */
export const pragmaTableFeatures = tableFeatures({ rowSortingFeature, rowPaginationFeature });

/** @public */
export interface UsePragmaTableOptions<TFeatures extends TableFeatures, TData extends RowData> {
  readonly schema: ResolvedSchema;
  /** The current query (single source of truth, e.g. from `usePragma`). */
  readonly query: TableQuery;
  /** Called when the user sorts or pages through the table UI. */
  readonly onQueryChange: (query: TableQuery) => void;
  /**
   * `client` (default): `data` is the full dataset; Pragma filters, sorts and paginates it.
   * `server`: `data` is the already-processed current page and `rowCount` the total.
   */
  readonly mode?: 'client' | 'server';
  readonly data: readonly TData[];
  readonly columns: readonly ColumnDef<TFeatures, TData>[];
  /** Must include rowSortingFeature and rowPaginationFeature. Default {@link pragmaTableFeatures}. */
  readonly features?: TFeatures;
  /** Total matching rows (server mode). */
  readonly rowCount?: number;
  readonly getValue?: ValueGetter<TData>;
  /** Clock for relative dates (client mode). */
  readonly now?: () => number;
}

/**
 * Wire a TanStack Table v9 instance to a Pragma query in controlled mode:
 * the query drives sorting and pagination state, TanStack header and pager
 * interactions flow back through `onQueryChange`, and (in client mode) rows are
 * produced by the Pragma reference executor.
 *
 * @public
 */
export function usePragmaTable<
  TData extends RowData,
  TFeatures extends TableFeatures = typeof pragmaTableFeatures,
>(options: UsePragmaTableOptions<TFeatures, TData>) {
  const {
    schema,
    query,
    onQueryChange,
    mode = 'client',
    data,
    columns,
    rowCount,
    getValue,
    now,
  } = options;
  const features = (options.features ?? pragmaTableFeatures) as TFeatures;

  const execution = useMemo(
    () =>
      mode === 'client'
        ? executeForTable(data, query, {
            schema,
            ...(getValue ? { getValue } : {}),
            ...(now ? { now: now() } : {}),
          })
        : undefined,
    [mode, data, query, schema, getValue, now],
  );

  const sorting: SortingState = useMemo(
    () => query.sort.map((s) => ({ id: s.field, desc: s.direction === 'desc' })),
    [query.sort],
  );
  const pagination: PaginationState = useMemo(() => {
    const p = query.pagination;
    if (p.type === 'page') return { pageIndex: p.page - 1, pageSize: p.pageSize };
    if (p.type === 'offset')
      return { pageIndex: Math.floor(p.offset / p.limit), pageSize: p.limit };
    return { pageIndex: 0, pageSize: p.limit };
  }, [query.pagination]);

  // Keep callbacks stable while reading the latest query.
  const latest = useRef({ query, onQueryChange, sorting, pagination });
  latest.current = { query, onQueryChange, sorting, pagination };

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const { query: q, onQueryChange: emit, sorting: current } = latest.current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      emit(fromTanStackState(q, { sorting: next }, schema));
    },
    [schema],
  );
  const onPaginationChange = useCallback(
    (updater: Updater<PaginationState>) => {
      const { query: q, onQueryChange: emit, pagination: current } = latest.current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      emit(fromTanStackState(q, { pagination: next }, schema));
    },
    [schema],
  );

  const tableData = (execution?.rows ?? data) as TData[];
  const table = useTable({
    features,
    columns: columns as ColumnDef<TFeatures, TData>[],
    data: tableData,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    rowCount: execution?.rowCount ?? rowCount ?? data.length,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    // useTable validates feature slots with a conditional type that a generic
    // wrapper cannot satisfy statically; the caller's `features` is checked at its own call site.
  } as unknown as Parameters<typeof useTable<TFeatures, TData>>[0]);

  return {
    table,
    rowCount: execution?.rowCount ?? rowCount ?? data.length,
    pageInfo: execution?.pageInfo,
  };
}
