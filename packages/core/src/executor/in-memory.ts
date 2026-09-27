import { rowEpochDay, rowInstant } from '../dates/calendar.js';
import { compileDateRange, inDateRange } from '../dates/intervals.js';
import type { PageInfo } from '../mutations/apply.js';
import type { FilterCondition, FilterNode, ScalarValue, SortSpec, TableQuery } from '../protocol/types.js';
import type { ResolvedField, ResolvedSchema } from '../schema/types.js';

/** @public */
export type ValueGetter<Row> = (row: Row, fieldId: string) => unknown;

/** @public */
export interface ExecuteOptions<Row> {
  readonly schema: ResolvedSchema;
  /** Instant used for relative dates, epoch ms. Default `Date.now()`. */
  readonly now?: number;
  /** How to read a field from a row. Default: {@link defaultGetValue}. */
  readonly getValue?: ValueGetter<Row>;
  /** Locale used for string ordering. Default `en`. */
  readonly locale?: string;
}

/** @public */
export interface ExecuteResult<Row> {
  readonly rows: Row[];
  /** Number of rows matching search + filter (before pagination). */
  readonly total: number;
  readonly pageInfo: PageInfo;
}

type Predicate<Row> = (row: Row) => boolean;

/**
 * Read `fieldId` from a row: an exact own key wins (`"address.city"`), otherwise
 * dot-separated segments are followed (`row.address.city`).
 *
 * @public
 */
export function defaultGetValue(row: unknown, fieldId: string): unknown {
  if (row === null || typeof row !== 'object') return undefined;
  const record = row as Record<string, unknown>;
  if (Object.hasOwn(record, fieldId)) return record[fieldId];
  if (!fieldId.includes('.')) return undefined;
  let current: unknown = row;
  for (const segment of fieldId.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Reference implementation of the protocol's execution semantics.
 *
 * It is both the client-side executor for small datasets and the oracle that
 * adapter conformance tests compare against.
 *
 * Semantics (documented in docs/operators.md):
 * - Text comparison is case-insensitive unless `caseSensitive` is set.
 * - Null/undefined never satisfies a value operator, including negative ones
 *   (`neq`, `notIn`, `notContains`, `notBetween`): SQL-style three-valued logic.
 *   Use `isNull` to match missing values.
 * - `isEmpty` matches null, undefined and `""`.
 * - Nulls sort last by default in both directions.
 *
 * @public
 */
export function executeQuery<Row>(rows: readonly Row[], query: TableQuery, options: ExecuteOptions<Row>): ExecuteResult<Row> {
  const predicate = compilePredicate(query, options);
  const matched = rows.filter(predicate);
  const comparator = compileComparator<Row>(query.sort, options);
  const sorted = comparator ? [...matched].sort(comparator) : matched;
  const total = sorted.length;

  const p = query.pagination;
  let offset: number;
  let limit: number;
  switch (p.type) {
    case 'page':
      offset = (p.page - 1) * p.pageSize;
      limit = p.pageSize;
      break;
    case 'offset':
      offset = p.offset;
      limit = p.limit;
      break;
    case 'cursor':
      offset = p.cursor === null ? 0 : decodeCursor(p.cursor);
      limit = p.limit;
      break;
  }
  const page = sorted.slice(offset, offset + limit);
  const hasNext = offset + limit < total;
  const pageInfo: PageInfo = {
    nextCursor: hasNext ? encodeCursor(offset + limit) : null,
    ...(offset > 0 ? { prevCursor: offset - limit <= 0 ? null : encodeCursor(offset - limit) } : {}),
  };
  return { rows: page, total, pageInfo };
}

/** Compile search + filter into a single row predicate. @public */
export function compilePredicate<Row>(query: Pick<TableQuery, 'search' | 'filter' | 'context'>, options: ExecuteOptions<Row>): Predicate<Row> {
  const getValue = options.getValue ?? (defaultGetValue);
  const ctx = { now: options.now ?? Date.now(), timezone: query.context?.timezone ?? 'UTC', weekStartsOn: query.context?.weekStartsOn ?? 1 };
  const filter = query.filter === null ? undefined : compileNode<Row>(query.filter, options.schema, getValue, ctx);
  const search = query.search === null ? undefined : compileSearch<Row>(query.search.query, query.search.fields, options.schema, getValue);
  if (!filter && !search) return () => true;
  return (row) => (search ? search(row) : true) && (filter ? filter(row) : true);
}

function compileSearch<Row>(text: string, fields: readonly string[] | undefined, schema: ResolvedSchema, getValue: ValueGetter<Row>): Predicate<Row> {
  const needle = fold(text);
  const targets = (fields ?? [...schema.fieldsById.values()].filter((f) => f.searchable).map((f) => f.id))
    .map((id) => schema.fieldsById.get(id))
    .filter((f): f is ResolvedField => f !== undefined);
  return (row) =>
    targets.some((field) => {
      const raw = getValue(row, field.id);
      const text = cellText(raw);
      if (text === undefined) return false;
      if (field.type === 'enum') {
        const label = field.values.find((v) => v.value === text)?.label;
        return fold(text).includes(needle) || (label !== undefined && fold(label).includes(needle));
      }
      return fold(text).includes(needle);
    });
}

type DateCtx = { now: number; timezone: string; weekStartsOn: 0 | 1 };

function compileNode<Row>(node: FilterNode, schema: ResolvedSchema, getValue: ValueGetter<Row>, ctx: DateCtx): Predicate<Row> {
  if (node.type === 'condition') return compileCondition(node, schema, getValue, ctx);
  const children = node.children.map((c) => compileNode(c, schema, getValue, ctx));
  const combined: Predicate<Row> = node.logic === 'and' ? (row) => children.every((p) => p(row)) : (row) => children.some((p) => p(row));
  return node.not === true ? (row) => !combined(row) : combined;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Text form of a cell value for comparison. Objects and arrays have no text form
 * (they never match text operators) rather than becoming "[object Object]".
 */
function cellText(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return value instanceof Date ? value.toISOString() : undefined;
  }
}

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function compileCondition<Row>(condition: FilterCondition, schema: ResolvedSchema, getValue: ValueGetter<Row>, ctx: DateCtx): Predicate<Row> {
  const field = schema.fieldsById.get(condition.field);
  if (!field) return () => false;
  const read = (row: Row): unknown => getValue(row, field.id);
  const { operator } = condition;

  if (operator === 'isNull') return (row) => isNullish(read(row));
  if (operator === 'isNotNull') return (row) => !isNullish(read(row));
  if (operator === 'isEmpty') return (row) => {
    const v = read(row);
    return isNullish(v) || v === '';
  };
  if (operator === 'isNotEmpty') return (row) => {
    const v = read(row);
    return !isNullish(v) && v !== '';
  };

  if (field.type === 'date' || field.type === 'datetime') {
    const range = compileDateRange(condition, field.type, ctx);
    if (!range) return () => false;
    const toComparable = field.type === 'date' ? (v: unknown): number | undefined => rowEpochDay(v, ctx.timezone) : (v: unknown): number | undefined => rowInstant(v, ctx.timezone);
    return (row) => {
      const v = toComparable(read(row));
      return v !== undefined && inDateRange(v, range);
    };
  }

  const caseSensitive = condition.options?.caseSensitive === true;
  const text = (v: unknown): string => (caseSensitive ? String(v) : fold(String(v)));

  switch (field.type) {
    case 'string':
      return compileTextCondition(condition, read, text);
    case 'enum': {
      const values = listOf(condition.value).map(String);
      return scalarMembership(operator, values, read, (v) => String(v));
    }
    case 'boolean': {
      const expected = condition.value === true;
      return (row) => {
        const v = toBoolean(read(row));
        return v !== undefined && v === expected;
      };
    }
    case 'number':
      return compileNumberCondition(condition, read);
  }
}

function compileTextCondition<Row>(condition: FilterCondition, read: (row: Row) => unknown, text: (v: unknown) => string): Predicate<Row> {
  const { operator } = condition;
  if (operator === 'in' || operator === 'notIn' || operator === 'eq' || operator === 'neq') {
    return scalarMembership(operator, listOf(condition.value).map(text), read, text);
  }
  const needle = text(condition.value);
  const test = (hay: string): boolean => {
    switch (operator) {
      case 'contains':
      case 'notContains':
        return hay.includes(needle);
      case 'startsWith':
        return hay.startsWith(needle);
      case 'endsWith':
        return hay.endsWith(needle);
      default:
        return false;
    }
  };
  const negate = operator === 'notContains';
  return (row) => {
    const v = read(row);
    if (isNullish(v)) return false;
    const result = test(text(v));
    return negate ? !result : result;
  };
}

function scalarMembership<Row>(operator: string, values: readonly string[], read: (row: Row) => unknown, key: (v: unknown) => string): Predicate<Row> {
  const set = new Set(values);
  const negate = operator === 'neq' || operator === 'notIn';
  return (row) => {
    const v = read(row);
    if (isNullish(v)) return false;
    const hit = set.has(key(v));
    return negate ? !hit : hit;
  };
}

function compileNumberCondition<Row>(condition: FilterCondition, read: (row: Row) => unknown): Predicate<Row> {
  const { operator } = condition;
  const values = listOf(condition.value) as number[];
  const [a = Number.NaN, b = Number.NaN] = values;
  const test = (n: number): boolean => {
    switch (operator) {
      case 'eq':
        return n === a;
      case 'neq':
        return n !== a;
      case 'gt':
        return n > a;
      case 'gte':
        return n >= a;
      case 'lt':
        return n < a;
      case 'lte':
        return n <= a;
      case 'between':
        return n >= a && n <= b;
      case 'notBetween':
        return n < a || n > b;
      case 'in':
        return values.includes(n);
      case 'notIn':
        return !values.includes(n);
      default:
        return false;
    }
  };
  return (row) => {
    const n = toNumber(read(row));
    return n !== undefined && test(n);
  };
}

function listOf(value: FilterCondition['value']): ScalarValue[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return [...(value as readonly ScalarValue[])];
  if (typeof value === 'object') return [];
  return [value];
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Compile a multi-field, null-aware, stable comparator. Returns `undefined` when there is no sort. @public */
export function compileComparator<Row>(sort: readonly SortSpec[], options: ExecuteOptions<Row>): ((a: Row, b: Row) => number) | undefined {
  if (sort.length === 0) return undefined;
  const getValue = options.getValue ?? (defaultGetValue);
  const collator = new Intl.Collator(options.locale ?? 'en', { sensitivity: 'base', numeric: true });
  const keys = sort
    .map((spec) => ({ spec, field: options.schema.fieldsById.get(spec.field) }))
    .filter((k): k is { spec: SortSpec; field: ResolvedField } => k.field !== undefined)
    .map(({ spec, field }) => ({
      field,
      direction: spec.direction === 'asc' ? 1 : -1,
      nullsFirst: spec.nulls === 'first',
      extract: sortKeyExtractor(field),
    }));
  return (a, b) => {
    for (const key of keys) {
      const va = key.extract(getValue(a, key.field.id));
      const vb = key.extract(getValue(b, key.field.id));
      if (va === undefined && vb === undefined) continue;
      if (va === undefined) return key.nullsFirst ? -1 : 1;
      if (vb === undefined) return key.nullsFirst ? 1 : -1;
      const cmp = typeof va === 'string' && typeof vb === 'string' ? collator.compare(va, vb) : (va as number) - (vb as number);
      if (cmp !== 0) return cmp * key.direction;
    }
    return 0;
  };
}

function sortKeyExtractor(field: ResolvedField): (v: unknown) => string | number | undefined {
  switch (field.type) {
    case 'number':
      return toNumber;
    case 'boolean':
      return (v) => {
        const b = toBoolean(v);
        return b === undefined ? undefined : b ? 1 : 0;
      };
    case 'date':
      return (v) => rowEpochDay(v, 'UTC');
    case 'datetime':
      return (v) => rowInstant(v, 'UTC');
    case 'string':
    case 'enum':
      return cellText;
  }
}

function encodeCursor(offset: number): string {
  return `o${offset.toString(36)}`;
}

function decodeCursor(cursor: string): number {
  const n = /^o[0-9a-z]+$/.test(cursor) ? parseInt(cursor.slice(1), 36) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
