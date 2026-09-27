/**
 * @pragma/tanstack — TanStack Table adapter. Framework-agnostic; the React hook
 * lives at `@pragma/tanstack/react`.
 *
 * @packageDocumentation
 */

export { fromTanStackState, toTanStackState } from './state.js';
export type {
  PragmaColumnFilterValue,
  PragmaGlobalFilterValue,
  TanStackColumnFilter,
  TanStackColumnSort,
  TanStackPagination,
  TanStackState,
  TanStackStatePatch,
} from './state.js';
export { pragmaFilterFn, pragmaGlobalFilterFn, pragmaSortFn } from './fns.js';
export type { PragmaColumnFilterFn, PragmaFnOptions, ValueRow } from './fns.js';
export { schemaFromColumns, withPragmaColumns } from './columns.js';
export type { PragmaColumnAdditions, PragmaColumnLike, PragmaColumnMeta, SchemaFromColumnsOptions } from './columns.js';
export { executeForTable } from './controlled.js';
export type { ExecuteForTableOptions, TableExecution } from './controlled.js';
