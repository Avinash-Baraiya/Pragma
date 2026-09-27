import type { Operator } from '../operators/catalog.js';
import { RELATIVE_DATE_OPERATORS } from '../operators/catalog.js';
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  RelativeDuration,
  TableQuery,
} from '../protocol/types.js';
import type { ResolvedSchema } from '../schema/types.js';
import {
  addMonths,
  epochDayInZone,
  formatEpochDay,
  fromEpochDay,
  parseDateTimeOperand,
  parsePlainDate,
  shiftInZone,
  startOfDayInZone,
  startOfWeek,
  toEpochDay,
  type Interval,
} from './calendar.js';

/** Inputs needed to give relative dates a concrete meaning. @public */
export interface DateContext {
  /** Current instant, epoch ms. */
  readonly now: number;
  readonly timezone: string;
  /** Default 1 (Monday). */
  readonly weekStartsOn?: 0 | 1;
}

/**
 * Compiled date predicate: the row value (epoch ms for datetime, epoch day for
 * date) must fall inside `[start, end)`, or outside it when `negate` is set.
 * A `null` bound is unbounded.
 *
 * @public
 */
export interface DateRange {
  readonly start: number | null;
  readonly end: number | null;
  readonly negate: boolean;
}

type DateFieldType = 'date' | 'datetime';

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * Compile a date/datetime condition into a {@link DateRange}. Returns `undefined`
 * for null operators (handled by callers) or when a value cannot be interpreted
 * (validated queries never hit this).
 *
 * @public
 */
export function compileDateRange(
  condition: FilterCondition,
  fieldType: DateFieldType,
  ctx: DateContext,
): DateRange | undefined {
  const { operator, value } = condition;
  if (RELATIVE_DATE_OPERATORS.has(operator)) {
    const interval = relativeInterval(
      operator,
      value as RelativeDuration | undefined,
      fieldType,
      ctx,
    );
    return interval ? { start: interval.start, end: interval.end, negate: false } : undefined;
  }
  switch (operator) {
    case 'eq':
    case 'neq':
    case 'before':
    case 'after':
    case 'onOrBefore':
    case 'onOrAfter': {
      const operand =
        typeof value === 'string' ? operandInterval(value, fieldType, ctx.timezone) : undefined;
      if (!operand) return undefined;
      return singleOperandRange(operator, operand);
    }
    case 'between':
    case 'notBetween': {
      if (!Array.isArray(value) || value.length !== 2) return undefined;
      const [a, b] = value as readonly unknown[];
      const from = typeof a === 'string' ? operandInterval(a, fieldType, ctx.timezone) : undefined;
      const to = typeof b === 'string' ? operandInterval(b, fieldType, ctx.timezone) : undefined;
      if (!from || !to) return undefined;
      return { start: from.start, end: to.end, negate: operator === 'notBetween' };
    }
    default:
      return undefined;
  }
}

function singleOperandRange(operator: Operator, operand: Interval): DateRange {
  switch (operator) {
    case 'eq':
      return { start: operand.start, end: operand.end, negate: false };
    case 'neq':
      return { start: operand.start, end: operand.end, negate: true };
    case 'before':
      return { start: null, end: operand.start, negate: false };
    case 'after':
      return { start: operand.end, end: null, negate: false };
    case 'onOrBefore':
      return { start: null, end: operand.end, negate: false };
    default: // onOrAfter
      return { start: operand.start, end: null, negate: false };
  }
}

/** Interval of a single operand: epoch days for `date`, epoch ms for `datetime`. @public */
export function operandInterval(
  value: string,
  fieldType: DateFieldType,
  timezone: string,
): Interval | undefined {
  if (fieldType === 'date') {
    const plain = parsePlainDate(value);
    if (!plain) return undefined;
    const day = toEpochDay(plain);
    return { start: day, end: day + 1 };
  }
  return parseDateTimeOperand(value, timezone);
}

/** Test a comparable row value against a compiled range. @public */
export function inDateRange(value: number, range: DateRange): boolean {
  const inside =
    (range.start === null || value >= range.start) && (range.end === null || value < range.end);
  return range.negate ? !inside : inside;
}

function relativeInterval(
  operator: Operator,
  duration: RelativeDuration | undefined,
  fieldType: DateFieldType,
  ctx: DateContext,
): Interval | undefined {
  const tz = ctx.timezone;
  const weekStartsOn = ctx.weekStartsOn ?? 1;
  const today = epochDayInZone(ctx.now, tz);
  const days = (start: number, end: number): Interval =>
    fieldType === 'date'
      ? { start, end }
      : { start: startOfDayInZone(start, tz), end: startOfDayInZone(end, tz) };
  const monthStart = (offset: number): number => {
    const d = fromEpochDay(today);
    return toEpochDay(addMonths({ year: d.year, month: d.month, day: 1 }, offset));
  };

  switch (operator) {
    case 'today':
      return days(today, today + 1);
    case 'yesterday':
      return days(today - 1, today);
    case 'thisWeek': {
      const sow = startOfWeek(today, weekStartsOn);
      return days(sow, sow + 7);
    }
    case 'lastWeek': {
      const sow = startOfWeek(today, weekStartsOn);
      return days(sow - 7, sow);
    }
    case 'thisMonth':
      return days(monthStart(0), monthStart(1));
    case 'lastMonth':
      return days(monthStart(-1), monthStart(0));
    case 'thisYear': {
      const { year } = fromEpochDay(today);
      return days(
        toEpochDay({ year, month: 1, day: 1 }),
        toEpochDay({ year: year + 1, month: 1, day: 1 }),
      );
    }
    case 'last':
    case 'next': {
      if (!duration) return undefined;
      return fieldType === 'date'
        ? relativeDays(operator, duration, today)
        : relativeInstants(operator, duration, ctx.now, tz);
    }
    default:
      return undefined;
  }
}

/**
 * `last N <unit>` on a date field covers N units ending today, inclusive of today
 * (e.g. last 7 days = today and the 6 previous days). `next N` starts today.
 */
function relativeDays(
  operator: 'last' | 'next',
  { amount, unit }: RelativeDuration,
  today: number,
): Interval | undefined {
  const shift = (sign: 1 | -1): number => {
    const d = fromEpochDay(today);
    switch (unit) {
      case 'day':
        return today + sign * amount;
      case 'week':
        return today + sign * amount * 7;
      case 'month':
        return toEpochDay(addMonths(d, sign * amount));
      case 'year':
        return toEpochDay(addMonths(d, sign * amount * 12));
      default:
        return Number.NaN; // minute/hour are rejected by the validator for date fields
    }
  };
  if (operator === 'last') {
    const from = shift(-1);
    return Number.isNaN(from) ? undefined : { start: from + 1, end: today + 1 };
  }
  const to = shift(1);
  return Number.isNaN(to) ? undefined : { start: today, end: to };
}

/** `last N <unit>` on a datetime field is the rolling window ending now (inclusive). */
function relativeInstants(
  operator: 'last' | 'next',
  { amount, unit }: RelativeDuration,
  now: number,
  tz: string,
): Interval {
  const shifted = (sign: 1 | -1): number => {
    switch (unit) {
      case 'minute':
        return now + sign * amount * MINUTE;
      case 'hour':
        return now + sign * amount * HOUR;
      default:
        return shiftInZone(now, tz, unit, sign * amount);
    }
  };
  return operator === 'last'
    ? { start: shifted(-1), end: now + 1 }
    : { start: now, end: shifted(1) + 1 };
}

/* -------------------------------------------------------------------------- */
/* Absolute resolution for backends                                           */
/* -------------------------------------------------------------------------- */

/**
 * Rewrite a query so it has no timezone- or clock-dependent date semantics:
 *
 * - relative operators (`last`, `today`, ...) become absolute ranges;
 * - operands on `datetime` fields become UTC ISO instants at millisecond precision
 *   (`between` is inclusive on both ends, `before` is strict, `onOrAfter` inclusive).
 *
 * Use this right before handing a query to a backend that does not want to
 * implement timezone logic. The original query should remain the source of truth
 * (it stays cacheable and semantically meaningful).
 *
 * @public
 */
export function resolveDates(
  query: TableQuery,
  schema: ResolvedSchema,
  ctx: DateContext,
): TableQuery {
  if (query.filter === null) return query;
  return { ...query, filter: resolveNode(query.filter, schema, ctx) as FilterGroup };
}

function resolveNode(node: FilterNode, schema: ResolvedSchema, ctx: DateContext): FilterNode {
  if (node.type === 'group')
    return { ...node, children: node.children.map((c) => resolveNode(c, schema, ctx)) };
  const field = schema.fieldsById.get(node.field);
  if (!field || (field.type !== 'date' && field.type !== 'datetime')) return node;
  if (node.operator === 'isNull' || node.operator === 'isNotNull') return node;
  if (field.type === 'date' && !RELATIVE_DATE_OPERATORS.has(node.operator)) return node;
  const range = compileDateRange(node, field.type, ctx);
  if (!range) return node;
  const fmt =
    field.type === 'date' ? formatEpochDay : (n: number): string => new Date(n).toISOString();
  // Ranges are half-open; the inclusive end is one unit earlier (1 day or 1 ms).
  const last = 1;
  const base = { type: 'condition' as const, id: node.id, field: node.field };
  if (range.start !== null && range.end !== null) {
    if (field.type === 'date' && range.end - range.start === 1 && !range.negate) {
      return { ...base, operator: 'eq', value: fmt(range.start) };
    }
    return {
      ...base,
      operator: range.negate ? 'notBetween' : 'between',
      value: [fmt(range.start), fmt(range.end - last)],
    };
  }
  if (range.end !== null) return { ...base, operator: 'before', value: fmt(range.end) };
  if (range.start !== null) return { ...base, operator: 'onOrAfter', value: fmt(range.start) };
  return node;
}
