import type { FieldType } from '../schema/types.js';

/**
 * Every operator understood by protocol version 1.0.
 * Operator names are part of the protocol and never change within a major version.
 *
 * @public
 */
export const OPERATORS = [
  // equality / membership
  'eq',
  'neq',
  'in',
  'notIn',
  // string
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  // numeric comparison
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'notBetween',
  // date comparison
  'before',
  'after',
  'onOrBefore',
  'onOrAfter',
  // relative date
  'last',
  'next',
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  // null
  'isNull',
  'isNotNull',
] as const;

/** @public */
export type Operator = (typeof OPERATORS)[number];

/**
 * Shape of the value an operator expects.
 * - `none`: no value (e.g. `isNull`, `today`)
 * - `single`: one scalar
 * - `range`: tuple `[from, to]`
 * - `list`: non-empty array of scalars
 * - `duration`: `{ amount, unit }` relative duration
 *
 * @public
 */
export type OperatorArity = 'none' | 'single' | 'range' | 'list' | 'duration';

/** @public */
export const OPERATOR_ARITY: Readonly<Record<Operator, OperatorArity>> = {
  eq: 'single',
  neq: 'single',
  in: 'list',
  notIn: 'list',
  contains: 'single',
  notContains: 'single',
  startsWith: 'single',
  endsWith: 'single',
  isEmpty: 'none',
  isNotEmpty: 'none',
  gt: 'single',
  gte: 'single',
  lt: 'single',
  lte: 'single',
  between: 'range',
  notBetween: 'range',
  before: 'single',
  after: 'single',
  onOrBefore: 'single',
  onOrAfter: 'single',
  last: 'duration',
  next: 'duration',
  today: 'none',
  yesterday: 'none',
  thisWeek: 'none',
  lastWeek: 'none',
  thisMonth: 'none',
  lastMonth: 'none',
  thisYear: 'none',
  isNull: 'none',
  isNotNull: 'none',
};

const DATE_OPERATORS: readonly Operator[] = [
  'eq',
  'neq',
  'before',
  'after',
  'onOrBefore',
  'onOrAfter',
  'between',
  'notBetween',
  'last',
  'next',
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'isNull',
  'isNotNull',
];

/**
 * Operators legal for each field type. A field's own `operators` list may only
 * narrow this set.
 *
 * @public
 */
export const OPERATORS_BY_TYPE: Readonly<Record<FieldType, readonly Operator[]>> = {
  string: [
    'eq',
    'neq',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'in',
    'notIn',
    'isEmpty',
    'isNotEmpty',
    'isNull',
    'isNotNull',
  ],
  number: [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'notBetween',
    'in',
    'notIn',
    'isNull',
    'isNotNull',
  ],
  boolean: ['eq', 'isNull', 'isNotNull'],
  enum: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  date: DATE_OPERATORS,
  datetime: DATE_OPERATORS,
};

/** Relative date operators whose meaning depends on "now" and a timezone. @public */
export const RELATIVE_DATE_OPERATORS: ReadonlySet<Operator> = new Set<Operator>([
  'last',
  'next',
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
]);

/** Operators that compare text and accept the `caseSensitive` option. @public */
export const TEXT_OPERATORS: ReadonlySet<Operator> = new Set<Operator>([
  'eq',
  'neq',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
]);

/** Units accepted in relative durations (`last`/`next`). @public */
export const DURATION_UNITS = ['minute', 'hour', 'day', 'week', 'month', 'year'] as const;

/** @public */
export type DurationUnit = (typeof DURATION_UNITS)[number];

const OPERATOR_SET: ReadonlySet<string> = new Set(OPERATORS);

/** Type guard for {@link Operator}. @public */
export function isOperator(value: unknown): value is Operator {
  return typeof value === 'string' && OPERATOR_SET.has(value);
}

/** Human-readable symbol/phrase for each operator, used by explanations. @public */
export const OPERATOR_LABELS: Readonly<Record<Operator, string>> = {
  eq: '=',
  neq: '≠',
  in: 'is any of',
  notIn: 'is none of',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  notBetween: 'not between',
  before: 'before',
  after: 'after',
  onOrBefore: 'on or before',
  onOrAfter: 'on or after',
  last: 'in the last',
  next: 'in the next',
  today: 'is today',
  yesterday: 'is yesterday',
  thisWeek: 'is this week',
  lastWeek: 'is last week',
  thisMonth: 'is this month',
  lastMonth: 'is last month',
  thisYear: 'is this year',
  isNull: 'has no value',
  isNotNull: 'has a value',
};
