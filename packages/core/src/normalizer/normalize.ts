import { parseDateTimeOperand, parsePlainDate, toEpochDay } from '../dates/calendar.js';
import { createWarning, type PragmaWarning } from '../errors/errors.js';
import { sha256, stableStringify } from '../hash/sha256.js';
import type { FilterCondition, FilterGroup, FilterNode, ScalarValue, TableQuery } from '../protocol/types.js';
import type { ResolvedField, ResolvedSchema } from '../schema/types.js';

/** @public */
export interface NormalizeResult {
  readonly query: TableQuery;
  readonly warnings: readonly PragmaWarning[];
}

/**
 * Put a validated query into canonical form without changing its meaning:
 *
 * - flatten nested groups with the same logic; unwrap single-child groups;
 * - drop empty groups (an empty root becomes `filter: null`);
 * - de-duplicate identical conditions and `in` list values;
 * - swap reversed `between` bounds (warning `BOUNDS_REORDERED`);
 * - collapse OR-ed equality on one field into `in` (warning `CONDITIONS_MERGED`).
 *
 * Emitted child order is preserved (it is meaningful to users); only hashing
 * uses a sorted order.
 *
 * @public
 */
export function normalizeQuery(query: TableQuery, schema: ResolvedSchema): NormalizeResult {
  const warnings: PragmaWarning[] = [];
  if (query.filter === null) return { query, warnings };
  const normalized = normalizeGroup(query.filter, schema, warnings);
  let filter: FilterGroup | null;
  if (normalized === null) filter = null;
  else if (normalized.type === 'group') filter = normalized;
  else filter = { type: 'group', id: query.filter.id, logic: 'and', children: [normalized] };
  return { query: { ...query, filter }, warnings };
}

function normalizeNode(node: FilterNode, schema: ResolvedSchema, warnings: PragmaWarning[]): FilterNode | null {
  return node.type === 'condition' ? normalizeCondition(node, schema, warnings) : normalizeGroup(node, schema, warnings);
}

function normalizeGroup(group: FilterGroup, schema: ResolvedSchema, warnings: PragmaWarning[]): FilterNode | null {
  let children: FilterNode[] = [];
  for (const child of group.children) {
    const normalized = normalizeNode(child, schema, warnings);
    if (normalized === null) continue;
    if (normalized.type === 'group' && normalized.logic === group.logic && normalized.not !== true) children.push(...normalized.children);
    else children.push(normalized);
  }

  // De-duplicate structurally identical children.
  const seen = new Set<string>();
  const unique: FilterNode[] = [];
  for (const child of children) {
    const key = nodeKey(child);
    if (seen.has(key)) {
      warnings.push(
        createWarning('DUPLICATE_REMOVED', {
          message: 'A duplicate filter condition was removed.',
          messageKey: 'filter.duplicate',
          ...(child.type === 'condition' ? { field: child.field } : {}),
        }),
      );
      continue;
    }
    seen.add(key);
    unique.push(child);
  }
  children = unique;

  if (group.logic === 'or') children = collapseOrEquality(children, schema, warnings);

  if (children.length === 0) return null;
  if (children.length === 1 && group.not !== true) return children[0]!;
  return { ...group, children };
}

function normalizeCondition(condition: FilterCondition, schema: ResolvedSchema, warnings: PragmaWarning[]): FilterCondition {
  const field = schema.fieldsById.get(condition.field);
  if (!field) return condition;
  if ((condition.operator === 'between' || condition.operator === 'notBetween') && Array.isArray(condition.value)) {
    const [from, to] = condition.value as unknown as readonly [ScalarValue, ScalarValue];
    if (compareScalars(field, from, to) > 0) {
      warnings.push(
        createWarning('BOUNDS_REORDERED', {
          message: `The range for "${field.label}" was given in reverse order and has been corrected.`,
          messageKey: 'filter.boundsReordered',
          params: { field: field.label },
          field: field.id,
        }),
      );
      return { ...condition, value: [to, from] };
    }
  }
  if ((condition.operator === 'in' || condition.operator === 'notIn') && Array.isArray(condition.value)) {
    const values = condition.value as readonly ScalarValue[];
    const deduped = [...new Set(values)];
    if (deduped.length !== values.length) return { ...condition, value: deduped };
  }
  return condition;
}

/** `country = India OR country = US` → `country in [India, US]` when the field allows `in`. */
function collapseOrEquality(children: FilterNode[], schema: ResolvedSchema, warnings: PragmaWarning[]): FilterNode[] {
  const buckets = new Map<string, FilterCondition[]>();
  for (const child of children) {
    if (child.type !== 'condition' || (child.operator !== 'eq' && child.operator !== 'in')) continue;
    const field = schema.fieldsById.get(child.field);
    if (!field?.operators.includes('in')) continue;
    const key = `${child.field}|${String(child.options?.caseSensitive ?? false)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(child);
    buckets.set(key, bucket);
  }
  const merged = new Map<FilterCondition, FilterCondition | null>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const first = bucket[0]!;
    const values: ScalarValue[] = [];
    for (const c of bucket) {
      const vs = c.operator === 'in' ? (c.value as readonly ScalarValue[]) : [c.value as ScalarValue];
      for (const v of vs) if (!values.includes(v)) values.push(v);
    }
    const replacement: FilterCondition = { ...first, operator: 'in', value: values };
    merged.set(first, replacement);
    for (const c of bucket.slice(1)) merged.set(c, null);
    const label = schema.fieldsById.get(first.field)?.label ?? first.field;
    warnings.push(
      createWarning('CONDITIONS_MERGED', {
        message: `Alternatives for "${label}" were combined into one "is any of" filter.`,
        messageKey: 'filter.merged',
        params: { field: label },
        field: first.field,
      }),
    );
  }
  if (merged.size === 0) return children;
  const out: FilterNode[] = [];
  for (const child of children) {
    if (child.type === 'condition' && merged.has(child)) {
      const replacement = merged.get(child);
      if (replacement) out.push(replacement);
    } else out.push(child);
  }
  return out;
}

/**
 * Compare two scalars of a field's type. Dates compare chronologically; other
 * values numerically or lexically.
 *
 * @internal
 */
export function compareScalars(field: ResolvedField, a: ScalarValue, b: ScalarValue): number {
  if (field.type === 'number' && typeof a === 'number' && typeof b === 'number') return a - b;
  if (field.type === 'date' && typeof a === 'string' && typeof b === 'string') {
    const da = parsePlainDate(a);
    const db = parsePlainDate(b);
    if (da && db) return toEpochDay(da) - toEpochDay(db);
  }
  if (field.type === 'datetime' && typeof a === 'string' && typeof b === 'string') {
    const ia = parseDateTimeOperand(a, 'UTC');
    const ib = parseDateTimeOperand(b, 'UTC');
    if (ia && ib) return ia.start - ib.start;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Canonical form & hashing                                                   */
/* -------------------------------------------------------------------------- */

function nodeKey(node: FilterNode): string {
  return stableStringify(canonicalNode(node));
}

function canonicalNode(node: FilterNode): unknown {
  if (node.type === 'condition') {
    const value =
      (node.operator === 'in' || node.operator === 'notIn') && Array.isArray(node.value)
        ? [...(node.value as readonly ScalarValue[])].map(String).sort()
        : node.value;
    return { f: node.field, o: node.operator, v: value, cs: node.options?.caseSensitive };
  }
  const children = node.children.map((c) => stableStringify(canonicalNode(c))).sort();
  return { l: node.logic, n: node.not === true, c: children };
}

/**
 * Canonical, id-free representation of a query: logically equivalent queries
 * (same conditions in a different order, different node ids) map to the same
 * string. Used for cache keys, deduplication and comparisons.
 *
 * @public
 */
export function canonicalizeQuery(query: TableQuery): string {
  return stableStringify({
    v: query.version,
    r: query.resource,
    s: query.search === null ? null : { q: query.search.query, f: query.search.fields ? [...query.search.fields].sort() : undefined },
    f: query.filter === null ? null : canonicalNode(query.filter),
    o: query.sort,
    p: query.pagination,
    c: query.context,
  });
}

/** SHA-256 of {@link canonicalizeQuery}. @public */
export function hashQuery(query: TableQuery): string {
  return sha256(canonicalizeQuery(query));
}

/** Whether two queries are logically identical (ignoring node ids and child order). @public */
export function queriesEqual(a: TableQuery, b: TableQuery): boolean {
  return canonicalizeQuery(a) === canonicalizeQuery(b);
}
