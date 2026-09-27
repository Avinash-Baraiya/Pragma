import {
  firstPage,
  flattenFilter,
  pageSizeOf,
  type FilterCondition,
  type FilterGroup,
  type Pagination,
  type QueryContext,
  type ResolvedSchema,
  type SearchSpec,
  type SortSpec,
  type TableQuery,
} from '@pragma/core';

/*
 * State shapes shared by TanStack Table v8 and v9. Declared structurally so the
 * mapping works with either major version without importing its types.
 */

/** @public */
export interface TanStackColumnSort {
  readonly id: string;
  readonly desc: boolean;
}

/** @public */
export interface TanStackColumnFilter {
  readonly id: string;
  readonly value: unknown;
}

/** @public */
export interface TanStackPagination {
  readonly pageIndex: number;
  readonly pageSize: number;
}

/**
 * Column filter value produced by Pragma: every AND-ed condition on one column.
 * Evaluated by `pragmaFilterFn`.
 *
 * @public
 */
export interface PragmaColumnFilterValue {
  readonly kind: 'pragma';
  readonly conditions: readonly FilterCondition[];
  readonly context?: QueryContext;
}

/**
 * Global filter value produced by Pragma for search and for filters that are
 * not a plain conjunction (OR groups, negation, nesting). Evaluated by
 * `pragmaGlobalFilterFn` against the whole row.
 *
 * @public
 */
export interface PragmaGlobalFilterValue {
  readonly kind: 'pragma';
  readonly search: SearchSpec | null;
  readonly filter: FilterGroup | null;
  readonly context?: QueryContext;
}

/** @public */
export interface TanStackState {
  readonly sorting: TanStackColumnSort[];
  readonly columnFilters: TanStackColumnFilter[];
  /** `undefined` when neither search nor a non-conjunctive filter is active. */
  readonly globalFilter: PragmaGlobalFilterValue | undefined;
  /** Present for page and offset pagination; `undefined` for cursor pagination (server-driven). */
  readonly pagination: TanStackPagination | undefined;
}

/**
 * Map a TableQuery to TanStack Table state.
 *
 * - Plain AND filters become `columnFilters` (one entry per field) so column
 *   filter UIs can reflect them.
 * - Search and any OR / negated / nested filter become a single `globalFilter`
 *   evaluated against the whole row.
 * - Sorting and page/offset pagination map directly.
 *
 * @public
 */
export function toTanStackState(query: TableQuery): TanStackState {
  const flat = flattenFilter(query);
  const columnFilters: TanStackColumnFilter[] = [];
  let globalFilter: PragmaGlobalFilterValue | undefined;

  if (flat !== null) {
    const byField = new Map<string, FilterCondition[]>();
    for (const condition of flat) {
      const list = byField.get(condition.field) ?? [];
      list.push(condition);
      byField.set(condition.field, list);
    }
    for (const [id, conditions] of byField) {
      const value: PragmaColumnFilterValue = {
        kind: 'pragma',
        conditions,
        ...(query.context ? { context: query.context } : {}),
      };
      columnFilters.push({ id, value });
    }
  }
  const globalNeeded = query.search !== null || (flat === null && query.filter !== null);
  if (globalNeeded) {
    globalFilter = {
      kind: 'pragma',
      search: query.search,
      filter: flat === null ? query.filter : null,
      ...(query.context ? { context: query.context } : {}),
    };
  }

  return {
    sorting: query.sort.map((s) => ({ id: s.field, desc: s.direction === 'desc' })),
    columnFilters,
    globalFilter,
    pagination: toTanStackPagination(query.pagination),
  };
}

function toTanStackPagination(pagination: Pagination): TanStackPagination | undefined {
  switch (pagination.type) {
    case 'page':
      return { pageIndex: pagination.page - 1, pageSize: pagination.pageSize };
    case 'offset':
      return {
        pageIndex: Math.floor(pagination.offset / pagination.limit),
        pageSize: pagination.limit,
      };
    case 'cursor':
      return undefined;
  }
}

/** @public */
export interface TanStackStatePatch {
  readonly sorting?: readonly TanStackColumnSort[];
  readonly pagination?: TanStackPagination;
}

/**
 * Fold TanStack UI changes (header sort toggles, pager buttons) back into the
 * TableQuery, so the query stays the single source of truth.
 *
 * Unknown or non-sortable columns are ignored. Changing the sort or page size
 * returns to the first page, matching the engine's mutation semantics.
 *
 * @public
 */
export function fromTanStackState(
  query: TableQuery,
  patch: TanStackStatePatch,
  schema: ResolvedSchema,
): TableQuery {
  let next = query;
  let sortChanged = false;
  if (patch.sorting) {
    const sort: SortSpec[] = [];
    const seen = new Set<string>();
    for (const s of patch.sorting) {
      const field = schema.fieldsById.get(s.id);
      if (!field?.sortable || seen.has(field.id)) continue;
      seen.add(field.id);
      const existing = query.sort.find((q) => q.field === field.id);
      sort.push({
        field: field.id,
        direction: s.desc ? 'desc' : 'asc',
        ...(existing?.nulls ? { nulls: existing.nulls } : {}),
      });
    }
    const limited = sort.slice(0, schema.capabilities.maxSorts);
    sortChanged = !sameSort(limited, query.sort);
    if (sortChanged) next = { ...next, sort: limited };
  }

  if (patch.pagination) {
    const size = Math.min(
      Math.max(1, Math.floor(patch.pagination.pageSize)),
      schema.capabilities.maxPageSize,
    );
    const index = Math.max(0, Math.floor(patch.pagination.pageIndex));
    const sizeChanged = size !== pageSizeOf(query.pagination);
    next = {
      ...next,
      pagination: paginationFor(query.pagination, sizeChanged || sortChanged ? 0 : index, size),
    };
  } else if (sortChanged) {
    next = { ...next, pagination: firstPage(query.pagination.type, pageSizeOf(query.pagination)) };
  }
  return next;
}

function paginationFor(current: Pagination, pageIndex: number, size: number): Pagination {
  switch (current.type) {
    case 'page':
      return { type: 'page', page: pageIndex + 1, pageSize: size };
    case 'offset':
      return { type: 'offset', offset: pageIndex * size, limit: size };
    case 'cursor':
      // Cursor navigation is server-driven; only the page size can change here.
      return size === current.limit ? current : { type: 'cursor', cursor: null, limit: size };
  }
}

function sameSort(a: readonly SortSpec[], b: readonly SortSpec[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.field !== y.field || x.direction !== y.direction) return false;
  }
  return true;
}
