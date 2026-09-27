/**
 * Adapter conformance suite (internal).
 *
 * Every adapter that executes TableQuery payloads (TanStack native row models,
 * server/database adapters, ...) must return exactly the rows the reference
 * executor returns, in the same order, for every case below.
 */
import {
  defineSchema,
  executeQuery,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type Pagination,
  type SearchSpec,
  type SortSpec,
  type TableQuery,
} from '@avinash-baraiya/pragma-core';

/* --------------------------------- schema --------------------------------- */

export const conformanceSchema = defineSchema({
  schemaVersion: '1',
  resource: 'people',
  fields: [
    { id: 'id', label: 'Id', type: 'number' },
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'email', label: 'Email', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'score', label: 'Score', type: 'number' },
    { id: 'country', label: 'Country', type: 'string' },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'pending', label: 'Pending' },
      ],
    },
    { id: 'verified', label: 'Verified', type: 'boolean' },
    { id: 'birthDate', label: 'Birth Date', type: 'date' },
    { id: 'createdAt', label: 'Created At', type: 'datetime' },
  ],
  capabilities: { pagination: ['page', 'offset', 'cursor'], maxPageSize: 100 },
});

export interface Person {
  id: number;
  name: string;
  email: string | null;
  age: number | null;
  score: number;
  country: string | null;
  status: 'active' | 'inactive' | 'pending';
  verified: boolean;
  birthDate: string | null;
  createdAt: string;
}

/* ---------------------------- seeded dataset ----------------------------- */

/** Mulberry32: tiny deterministic PRNG so the dataset is identical everywhere. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Rahul',
  'priya',
  'John',
  'anna',
  'Zoë',
  'Émile',
  'li',
  'Carlos',
  'aisha',
  'Tom',
  'Rahul',
  'Mia',
];
const LAST = [
  'Sharma',
  'patel',
  'Smith',
  'Müller',
  'Dupont',
  'Wei',
  'garcia',
  'Khan',
  'Lee',
  'Brown',
];
const COUNTRIES = ['India', 'india', 'US', 'Germany', 'France', 'China', null, 'Brazil'];
const STATUSES = ['active', 'inactive', 'pending'] as const;

export const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

function buildDataset(size: number): Person[] {
  const rand = prng(20240615);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const rows: Person[] = [];
  for (let i = 1; i <= size; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const ageRoll = rand();
    const day = Math.floor(rand() * 400); // spans more than a year before NOW
    const created = new Date(NOW - day * 86_400_000 - Math.floor(rand() * 86_400_000));
    const birthYear = 1960 + Math.floor(rand() * 45);
    rows.push({
      id: i,
      name: `${first} ${last}`,
      email: rand() < 0.15 ? null : `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      age: ageRoll < 0.1 ? null : 18 + Math.floor(rand() * 50),
      score: Math.round(rand() * 10) * 10, // many ties
      country: pick(COUNTRIES),
      status: pick(STATUSES),
      verified: rand() < 0.55,
      birthDate:
        rand() < 0.1
          ? null
          : `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
      createdAt: created.toISOString(),
    });
  }
  return rows;
}

export const conformanceDataset: readonly Person[] = buildDataset(120);

/* ---------------------------------- cases --------------------------------- */

export interface ConformanceCase {
  readonly name: string;
  readonly query: TableQuery;
  /** Requires per-query null placement (not expressible in some native row models). */
  readonly needsNullsFirst?: boolean;
}

let nextId = 0;
const c = (
  field: string,
  operator: FilterCondition['operator'],
  value?: FilterCondition['value'],
  caseSensitive?: boolean,
): FilterCondition => ({
  type: 'condition',
  id: `c${++nextId}`,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
  ...(caseSensitive === undefined ? {} : { options: { caseSensitive } }),
});
const and = (...children: FilterNode[]): FilterGroup => ({
  type: 'group',
  id: `g${++nextId}`,
  logic: 'and',
  children,
});
const or = (...children: FilterNode[]): FilterGroup => ({
  type: 'group',
  id: `g${++nextId}`,
  logic: 'or',
  children,
});
const not = (group: FilterGroup): FilterGroup => ({ ...group, not: true });

const ALL: Pagination = { type: 'page', page: 1, pageSize: 100 };
const BY_ID: SortSpec[] = [{ field: 'id', direction: 'asc' }];

function q(
  filter: FilterGroup | null,
  extra: { search?: SearchSpec; sort?: SortSpec[]; pagination?: Pagination } = {},
): TableQuery {
  return {
    version: '1.0',
    resource: 'people',
    search: extra.search ?? null,
    filter,
    sort: extra.sort ?? BY_ID,
    pagination: extra.pagination ?? ALL,
    context: { timezone: 'Asia/Kolkata', weekStartsOn: 1 },
  };
}

export const conformanceCases: readonly ConformanceCase[] = [
  // text
  { name: 'string eq is case-insensitive', query: q(and(c('country', 'eq', 'INDIA'))) },
  { name: 'string eq case-sensitive', query: q(and(c('country', 'eq', 'India', true))) },
  { name: 'string neq excludes nulls', query: q(and(c('country', 'neq', 'India'))) },
  {
    name: 'contains / startsWith / endsWith',
    query: q(
      and(
        c('name', 'contains', 'ra'),
        c('email', 'endsWith', '.com'),
        c('name', 'startsWith', 'R'),
      ),
    ),
  },
  { name: 'notContains excludes nulls', query: q(and(c('email', 'notContains', 'rahul'))) },
  {
    name: 'string in / notIn',
    query: q(and(c('country', 'in', ['India', 'US']), c('name', 'notIn', ['Rahul Sharma']))),
  },
  { name: 'isEmpty vs isNull', query: q(or(c('email', 'isNull'), c('country', 'isEmpty'))) },
  {
    name: 'isNotEmpty / isNotNull',
    query: q(and(c('email', 'isNotEmpty'), c('age', 'isNotNull'))),
  },
  { name: 'unicode folding', query: q(and(c('name', 'contains', 'ZOË'))) },
  // numbers
  { name: 'number comparisons', query: q(and(c('age', 'gt', 30), c('age', 'lte', 50))) },
  { name: 'number gte / lt', query: q(and(c('score', 'gte', 50), c('score', 'lt', 90))) },
  { name: 'number between inclusive', query: q(and(c('age', 'between', [25, 35]))) },
  { name: 'number notBetween excludes nulls', query: q(and(c('age', 'notBetween', [25, 60]))) },
  { name: 'number eq / neq', query: q(or(c('score', 'eq', 0), c('age', 'neq', 30))) },
  {
    name: 'number in / notIn',
    query: q(and(c('score', 'in', [10, 20, 30]), c('age', 'notIn', [18, 19]))),
  },
  // enum & boolean
  { name: 'enum eq / neq', query: q(and(c('status', 'neq', 'inactive'))) },
  { name: 'enum in', query: q(and(c('status', 'in', ['active', 'pending']))) },
  { name: 'boolean', query: q(and(c('verified', 'eq', false))) },
  // dates
  {
    name: 'date before / after',
    query: q(and(c('birthDate', 'after', '1970-06-30'), c('birthDate', 'before', '1995-01-01'))),
  },
  {
    name: 'date onOrBefore / onOrAfter',
    query: q(
      and(c('birthDate', 'onOrAfter', '1980-01-01'), c('birthDate', 'onOrBefore', '1989-12-31')),
    ),
  },
  {
    name: 'date between / eq',
    query: q(
      or(
        c('birthDate', 'between', ['1990-01-01', '1990-12-31']),
        c('birthDate', 'eq', '1975-03-03'),
      ),
    ),
  },
  {
    name: 'datetime last 30 days (tz)',
    query: q(and(c('createdAt', 'last', { amount: 30, unit: 'day' }))),
  },
  {
    name: 'datetime this month / last month',
    query: q(or(c('createdAt', 'thisMonth'), c('createdAt', 'lastMonth'))),
  },
  {
    name: 'datetime this week / today / yesterday',
    query: q(or(c('createdAt', 'thisWeek'), c('createdAt', 'today'), c('createdAt', 'yesterday'))),
  },
  {
    name: 'datetime plain-date eq covers the local day',
    query: q(
      and(c('createdAt', 'onOrAfter', '2024-01-01'), c('createdAt', 'before', '2024-03-01')),
    ),
  },
  {
    name: 'datetime this year / next',
    query: q(or(c('createdAt', 'thisYear'), c('createdAt', 'next', { amount: 1, unit: 'week' }))),
  },
  { name: 'date relative last week', query: q(and(c('createdAt', 'lastWeek'))) },
  { name: 'date null checks', query: q(and(c('birthDate', 'isNull'))) },
  // groups
  { name: 'or group', query: q(or(c('country', 'eq', 'France'), c('status', 'eq', 'pending'))) },
  {
    name: 'and of ors',
    query: q(
      and(
        or(c('country', 'eq', 'India'), c('country', 'eq', 'US')),
        or(c('verified', 'eq', true), c('age', 'lt', 25)),
      ),
    ),
  },
  {
    name: 'negated group',
    query: q(and(not(or(c('status', 'eq', 'active'), c('age', 'gt', 60))))),
  },
  {
    name: 'deep nesting',
    query: q(
      or(
        and(c('age', 'gt', 40), or(c('country', 'eq', 'Germany'), c('score', 'gte', 80))),
        c('name', 'startsWith', 'mia'),
      ),
    ),
  },
  // search
  {
    name: 'global search (all searchable fields)',
    query: q(null, { search: { query: 'SHARMA' } }),
  },
  {
    name: 'search scoped to fields',
    query: q(null, { search: { query: 'example', fields: ['email'] } }),
  },
  {
    name: 'search + filters',
    query: q(and(c('verified', 'eq', true)), { search: { query: 'a' } }),
  },
  {
    name: 'search + or filter',
    query: q(or(c('age', 'lt', 25), c('age', 'gt', 60)), { search: { query: 'e' } }),
  },
  // sorting
  {
    name: 'sort string asc (collation, ties by input order)',
    query: q(null, { sort: [{ field: 'name', direction: 'asc' }] }),
  },
  { name: 'sort string desc', query: q(null, { sort: [{ field: 'country', direction: 'desc' }] }) },
  {
    name: 'sort number with nulls last (asc)',
    query: q(null, { sort: [{ field: 'age', direction: 'asc' }] }),
  },
  {
    name: 'sort number with nulls last (desc)',
    query: q(null, { sort: [{ field: 'age', direction: 'desc' }] }),
  },
  {
    name: 'multi-key sort with ties',
    query: q(null, {
      sort: [
        { field: 'score', direction: 'desc' },
        { field: 'name', direction: 'asc' },
        { field: 'id', direction: 'desc' },
      ],
    }),
  },
  {
    name: 'sort by date and datetime',
    query: q(null, {
      sort: [
        { field: 'birthDate', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ],
    }),
  },
  {
    name: 'sort by boolean and enum',
    query: q(null, {
      sort: [
        { field: 'verified', direction: 'desc' },
        { field: 'status', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
    }),
  },
  { name: 'unsorted keeps input order', query: q(and(c('age', 'gt', 30)), { sort: [] }) },
  {
    name: 'nulls first (explicit)',
    query: q(null, { sort: [{ field: 'age', direction: 'asc', nulls: 'first' }] }),
    needsNullsFirst: true,
  },
  // pagination
  {
    name: 'page 2 of 25',
    query: q(and(c('verified', 'eq', true)), {
      sort: [
        { field: 'name', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
      pagination: { type: 'page', page: 2, pageSize: 25 },
    }),
  },
  {
    name: 'last partial page',
    query: q(null, { pagination: { type: 'page', page: 5, pageSize: 27 } }),
  },
  {
    name: 'page beyond the end',
    query: q(null, { pagination: { type: 'page', page: 99, pageSize: 10 } }),
  },
  {
    name: 'offset pagination',
    query: q(null, {
      sort: [
        { field: 'score', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
      pagination: { type: 'offset', offset: 30, limit: 15 },
    }),
  },
];

/** Ids of the rows the reference executor returns for a case. */
export function referenceIds(
  testCase: ConformanceCase,
  rows: readonly Person[] = conformanceDataset,
): number[] {
  return executeQuery(rows, testCase.query, { schema: conformanceSchema, now: NOW }).rows.map(
    (r) => r.id,
  );
}

/** Total matches (before pagination) according to the reference executor. */
export function referenceTotal(
  testCase: ConformanceCase,
  rows: readonly Person[] = conformanceDataset,
): number {
  return executeQuery(rows, testCase.query, { schema: conformanceSchema, now: NOW }).total;
}
