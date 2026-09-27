import { compileComparator, compilePredicate, type FilterGroup, type ResolvedSchema } from '@pragma/core';
import type { PragmaColumnFilterValue, PragmaGlobalFilterValue } from './state.js';

/** The part of a TanStack row these functions need (v8 and v9 compatible). @public */
export interface ValueRow {
  getValue(columnId: string): unknown;
}

/** @public */
export interface PragmaFnOptions {
  /** Clock for relative dates. Default `Date.now`. */
  readonly now?: () => number;
}

type Predicate = (row: ValueRow) => boolean;

/** Column filter function with TanStack's `autoRemove` hook. @public */
export type PragmaColumnFilterFn = ((row: ValueRow, columnId: string, filterValue: unknown) => boolean) & {
  readonly autoRemove: (value: unknown) => boolean;
};

/** Text form of a primitive cell or filter value; objects have none. */
function textOf(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return undefined;
  }
}

const readValue = (row: ValueRow, fieldId: string): unknown => row.getValue(fieldId);

function isPragmaValue(value: unknown): value is { kind: 'pragma' } {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'pragma';
}

/**
 * Column `filterFn` evaluating Pragma conditions with the protocol's reference
 * semantics (case-insensitive text, SQL-style nulls, timezone-aware dates).
 *
 * A non-Pragma filter value (e.g. typed into a plain column filter input) is
 * treated as a case-insensitive "contains" on the cell text.
 *
 * @public
 */
export function pragmaFilterFn(schema: ResolvedSchema, options: PragmaFnOptions = {}): PragmaColumnFilterFn {
  const cache = new WeakMap<object, Predicate>();
  const fn = (row: ValueRow, columnId: string, filterValue: unknown): boolean => {
    if (!isPragmaValue(filterValue)) {
      const needle = textOf(filterValue);
      if (needle === undefined || needle === '') return true;
      const cell = textOf(row.getValue(columnId));
      return cell !== undefined && cell.toLowerCase().includes(needle.toLowerCase());
    }
    let predicate = cache.get(filterValue);
    if (!predicate) {
      const value = filterValue as PragmaColumnFilterValue;
      const filter: FilterGroup = { type: 'group', id: '_column', logic: 'and', children: value.conditions };
      predicate = compilePredicate<ValueRow>(
        { search: null, filter, ...(value.context ? { context: value.context } : {}) },
        { schema, getValue: readValue, now: (options.now ?? Date.now)() },
      );
      cache.set(filterValue, predicate);
    }
    return predicate(row);
  };
  // Remove the filter from state when its value is cleared.
  const autoRemove = (value: unknown): boolean =>
    value === undefined || value === null || value === '' || (isPragmaValue(value) && (value as PragmaColumnFilterValue).conditions.length === 0);
  return Object.assign(fn, { autoRemove });
}

/**
 * Table `globalFilterFn` evaluating Pragma search and non-conjunctive filters
 * against the whole row. It ignores the column it is called for, so the result
 * is the same whichever column TanStack asks about.
 *
 * Requires every column to be eligible, e.g. `getColumnCanGlobalFilter: () => true`.
 *
 * @public
 */
export function pragmaGlobalFilterFn(schema: ResolvedSchema, options: PragmaFnOptions = {}): (row: ValueRow, columnId: string, filterValue: unknown) => boolean {
  const cache = new WeakMap<object, Predicate>();
  return (row, _columnId, filterValue) => {
    if (!isPragmaValue(filterValue)) return true;
    let predicate = cache.get(filterValue);
    if (!predicate) {
      const value = filterValue as PragmaGlobalFilterValue;
      predicate = compilePredicate<ValueRow>(
        { search: value.search, filter: value.filter, ...(value.context ? { context: value.context } : {}) },
        { schema, getValue: readValue, now: (options.now ?? Date.now)() },
      );
      cache.set(filterValue, predicate);
    }
    return predicate(row);
  };
}

/**
 * Column `sortFn` with the reference ordering (locale-aware, numeric-aware
 * strings; chronological dates; numeric values). Returns an ascending
 * comparison; TanStack reverses it for descending sorts.
 *
 * @public
 */
export function pragmaSortFn(schema: ResolvedSchema, options: { readonly locale?: string } = {}): (rowA: ValueRow, rowB: ValueRow, columnId: string) => number {
  const comparators = new Map<string, (a: ValueRow, b: ValueRow) => number>();
  return (rowA, rowB, columnId) => {
    let compare = comparators.get(columnId);
    if (!compare) {
      compare =
        compileComparator<ValueRow>([{ field: columnId, direction: 'asc' }], {
          schema,
          getValue: readValue,
          ...(options.locale ? { locale: options.locale } : {}),
        }) ?? ((): number => 0);
      comparators.set(columnId, compare);
    }
    return compare(rowA, rowB);
  };
}
