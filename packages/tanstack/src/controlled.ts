import { executeQuery, type PageInfo, type ResolvedSchema, type TableQuery, type ValueGetter } from '@pragma/core';
import { toTanStackState, type TanStackColumnSort, type TanStackPagination } from './state.js';

/** @public */
export interface ExecuteForTableOptions<Row> {
  readonly schema: ResolvedSchema;
  /** Clock for relative dates. Default `Date.now()`. */
  readonly now?: number;
  readonly getValue?: ValueGetter<Row>;
  readonly locale?: string;
}

/** @public */
export interface TableExecution<Row> {
  /** Rows of the current page, filtered and sorted — pass as TanStack `data` with `manual*` flags. */
  readonly rows: Row[];
  /** Total matching rows — pass as TanStack `rowCount`. */
  readonly rowCount: number;
  readonly pageInfo: PageInfo;
  /** Controlled TanStack state reflecting the query (for header sort indicators and pagers). */
  readonly sorting: TanStackColumnSort[];
  readonly pagination: TanStackPagination | undefined;
}

/**
 * Controlled (recommended) client-side integration: execute the query with the
 * Pragma reference executor and hand TanStack the finished page. Results match
 * the protocol semantics exactly, including `nulls: 'first'`.
 *
 * Use with `manualFiltering`, `manualSorting` and `manualPagination` set to `true`.
 *
 * @public
 */
export function executeForTable<Row>(rows: readonly Row[], query: TableQuery, options: ExecuteForTableOptions<Row>): TableExecution<Row> {
  const result = executeQuery(rows, query, {
    schema: options.schema,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.getValue ? { getValue: options.getValue } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
  });
  const state = toTanStackState(query);
  return { rows: result.rows, rowCount: result.total, pageInfo: result.pageInfo, sorting: state.sorting, pagination: state.pagination };
}
