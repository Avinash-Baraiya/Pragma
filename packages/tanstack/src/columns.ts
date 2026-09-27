import { defaultGetValue, defineSchema, PragmaConfigError, type FieldDef, type ResolvedSchema, type TableSchema } from '@pragma/core';
import { pragmaFilterFn, pragmaSortFn, type PragmaFnOptions } from './fns.js';

/** Pragma field metadata placed on a column's `meta.pragma`. `id` and `label` default from the column. @public */
export type PragmaColumnMeta = Omit<FieldDef, 'id' | 'label'> & { readonly id?: string; readonly label?: string };

/** The subset of a TanStack column definition Pragma reads (v8 and v9 compatible). @public */
export interface PragmaColumnLike {
  readonly id?: string;
  readonly accessorKey?: string | number | symbol;
  readonly accessorFn?: (row: never, index: number) => unknown;
  readonly header?: unknown;
  readonly columns?: readonly PragmaColumnLike[];
  readonly meta?: unknown;
}

/** @public */
export interface SchemaFromColumnsOptions extends Omit<TableSchema, 'schemaVersion' | 'fields'> {
  /** Extra fields that have no column (e.g. filter-only data). */
  readonly extraFields?: readonly FieldDef[];
}

function columnId(column: PragmaColumnLike): string | undefined {
  if (typeof column.id === 'string') return column.id;
  if (typeof column.accessorKey === 'string') return column.accessorKey;
  if (typeof column.accessorKey === 'number') return String(column.accessorKey);
  return undefined;
}

function pragmaMeta(column: PragmaColumnLike): PragmaColumnMeta | false | undefined {
  const meta = column.meta as { pragma?: PragmaColumnMeta | false } | undefined;
  return meta?.pragma;
}

function leaves(columns: readonly PragmaColumnLike[]): PragmaColumnLike[] {
  return columns.flatMap((c) => (c.columns && c.columns.length > 0 ? leaves(c.columns) : [c]));
}

/**
 * Build a Pragma schema from TanStack column definitions. Each column that
 * should be queryable declares `meta: { pragma: { type: 'number', ... } }`;
 * the column id (or `accessorKey`) becomes the field id and a string `header`
 * the label. Columns without `meta.pragma` (or with `pragma: false`) are not
 * queryable.
 *
 * @public
 */
export function schemaFromColumns(columns: readonly PragmaColumnLike[], options: SchemaFromColumnsOptions): ResolvedSchema {
  const fields: FieldDef[] = [];
  for (const column of leaves(columns)) {
    const meta = pragmaMeta(column);
    if (meta === undefined || meta === false) continue;
    const id = meta.id ?? columnId(column);
    if (id === undefined) {
      throw new PragmaConfigError('CONFIG_ERROR', 'A column with meta.pragma needs an id or a string accessorKey.');
    }
    const label = meta.label ?? (typeof column.header === 'string' ? column.header : id);
    fields.push({ ...meta, id, label });
  }
  const { extraFields, ...schema } = options;
  return defineSchema({ ...schema, schemaVersion: '1', fields: [...fields, ...(extraFields ?? [])] });
}

/** Properties `withPragmaColumns` adds to each queryable column (TanStack v9 option names). @public */
export interface PragmaColumnAdditions {
  readonly id: string;
  readonly accessorFn: (row: unknown, index: number) => unknown;
  readonly filterFn: ReturnType<typeof pragmaFilterFn>;
  readonly sortFn: ReturnType<typeof pragmaSortFn>;
  readonly sortUndefined: 'last';
  readonly enableGlobalFilter: true;
}

/**
 * Prepare column definitions for TanStack's native row models so that client
 * filtering and sorting match the Pragma reference semantics:
 *
 * - `filterFn` / `sortFn` use Pragma's evaluation and ordering;
 * - accessors map `null` to `undefined` and `sortUndefined: 'last'` keeps empty
 *   values last in both directions (TanStack only special-cases `undefined`).
 *
 * Columns whose id is not a schema field are returned unchanged. Per-query
 * `nulls: 'first'` is not expressible here (TanStack reads it statically);
 * use controlled mode (`executeForTable`) when you need it.
 *
 * @public
 */
export function withPragmaColumns<TColumn extends PragmaColumnLike>(
  columns: readonly TColumn[],
  schema: ResolvedSchema,
  options: PragmaFnOptions & { readonly locale?: string } = {},
): TColumn[] {
  const filterFn = pragmaFilterFn(schema, options);
  const sortFn = pragmaSortFn(schema, options.locale ? { locale: options.locale } : {});
  // The additions are standard TanStack column options, so the caller's column type is preserved.
  const visit = (column: TColumn): TColumn => {
    if (column.columns && column.columns.length > 0) {
      return { ...column, columns: withPragmaColumns(column.columns as readonly TColumn[], schema, options) };
    }
    const id = columnId(column);
    if (id === undefined || !schema.fieldsById.has(id)) return column;
    const original = column.accessorFn as ((row: unknown, index: number) => unknown) | undefined;
    const key = column.accessorKey === undefined ? id : String(column.accessorKey);
    const read = original ?? ((row: unknown): unknown => defaultGetValue(row, key));
    const { accessorKey: _dropped, ...rest } = column;
    const additions: PragmaColumnAdditions = {
      id,
      accessorFn: (row, index) => {
        const value = read(row, index);
        return value === null ? undefined : value;
      },
      filterFn,
      sortFn,
      sortUndefined: 'last',
      enableGlobalFilter: true,
    };
    return { ...rest, ...additions } as unknown as TColumn;
  };
  return columns.map(visit);
}
