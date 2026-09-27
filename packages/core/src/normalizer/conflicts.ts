import { compileDateRange } from '../dates/intervals.js';
import { createWarning, type PragmaWarning } from '../errors/errors.js';
import type { FilterCondition, FilterGroup, FilterNode, ScalarValue, TableQuery } from '../protocol/types.js';
import type { ResolvedField, ResolvedSchema } from '../schema/types.js';

/** @public */
export interface ConflictOptions {
  /** "Now" used to evaluate relative date conditions. Default `Date.now()`. */
  readonly now?: number;
}

/**
 * Detect filters that are valid but can never match anything, such as
 * `age > 30 AND age < 20`. The query is *not* changed: the engine reports what
 * the user asked for and warns, rather than silently "fixing" intent.
 *
 * Only AND groups (without negation) are analysed; OR branches may legitimately
 * be individually empty.
 *
 * @public
 */
export function analyzeConflicts(query: TableQuery, schema: ResolvedSchema, options: ConflictOptions = {}): PragmaWarning[] {
  const warnings: PragmaWarning[] = [];
  if (query.filter === null) return warnings;
  const ctx = { now: options.now ?? Date.now(), timezone: query.context?.timezone ?? 'UTC', weekStartsOn: query.context?.weekStartsOn ?? 1 };
  visit(query.filter);
  return warnings;

  function visit(node: FilterNode): void {
    if (node.type === 'condition') return;
    if (node.logic === 'and' && node.not !== true) analyzeAndGroup(node);
    node.children.forEach(visit);
  }

  function analyzeAndGroup(group: FilterGroup): void {
    const byField = new Map<string, FilterCondition[]>();
    for (const child of group.children) {
      if (child.type !== 'condition') continue;
      const list = byField.get(child.field) ?? [];
      list.push(child);
      byField.set(child.field, list);
    }
    for (const [fieldId, conditions] of byField) {
      if (conditions.length < 2) continue;
      const field = schema.fieldsById.get(fieldId);
      if (!field) continue;
      const warning = checkNull(field, conditions) ?? checkMembership(field, conditions) ?? checkRange(field, conditions);
      if (warning) warnings.push(warning);
    }
  }

  function checkRange(field: ResolvedField, conditions: FilterCondition[]): PragmaWarning | undefined {
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    // Widened to boolean: they are reassigned inside the closures below.
    let loInclusive = true as boolean;
    let hiInclusive = true as boolean;
    let constrained = 0;

    const tightenLo = (v: number, inclusive: boolean): void => {
      if (v > lo || (v === lo && !inclusive)) {
        lo = v;
        loInclusive = inclusive;
      }
    };
    const tightenHi = (v: number, inclusive: boolean): void => {
      if (v < hi || (v === hi && !inclusive)) {
        hi = v;
        hiInclusive = inclusive;
      }
    };

    for (const c of conditions) {
      if (field.type === 'number') {
        const v = c.value;
        switch (c.operator) {
          case 'gt':
            tightenLo(v as number, false);
            break;
          case 'gte':
            tightenLo(v as number, true);
            break;
          case 'lt':
            tightenHi(v as number, false);
            break;
          case 'lte':
            tightenHi(v as number, true);
            break;
          case 'eq':
            tightenLo(v as number, true);
            tightenHi(v as number, true);
            break;
          case 'between': {
            const [a, b] = v as readonly [number, number];
            tightenLo(a, true);
            tightenHi(b, true);
            break;
          }
          default:
            continue;
        }
        constrained++;
      } else if (field.type === 'date' || field.type === 'datetime') {
        const range = compileDateRange(c, field.type, ctx);
        if (!range || range.negate) continue;
        if (range.start !== null) tightenLo(range.start, true);
        if (range.end !== null) tightenHi(range.end, false);
        constrained++;
      }
    }
    if (constrained < 2) return undefined;
    const empty = lo > hi || (lo === hi && !(loInclusive && hiInclusive));
    if (!empty) return undefined;
    return createWarning('EMPTY_RANGE', {
      message: `The conditions on "${field.label}" cannot all be true at once, so no rows will match.`,
      messageKey: 'conflict.emptyRange',
      params: { field: field.label },
      field: field.id,
    });
  }

  function checkMembership(field: ResolvedField, conditions: FilterCondition[]): PragmaWarning | undefined {
    if (field.type === 'date' || field.type === 'datetime') return undefined;
    // Compare exactly only when every condition is case-sensitive; otherwise fold
    // all values, so a warning is raised only when no row can possibly match.
    const membership = conditions.filter((c) => c.operator === 'eq' || c.operator === 'in');
    const exact = field.type !== 'string' || membership.every((c) => c.options?.caseSensitive === true);
    const key = (v: ScalarValue): string => (exact ? String(v) : String(v).toLowerCase());
    const sets: { values: Set<string>; fromEq: boolean }[] = [];
    for (const c of membership) {
      if (c.operator === 'eq') sets.push({ values: new Set([key(c.value as ScalarValue)]), fromEq: true });
      else if (c.operator === 'in') sets.push({ values: new Set((c.value as readonly ScalarValue[]).map(key)), fromEq: false });
    }
    if (sets.length < 2) return undefined;
    let intersection = sets[0]!.values;
    for (const s of sets.slice(1)) intersection = new Set([...intersection].filter((v) => s.values.has(v)));
    if (intersection.size > 0) return undefined;
    const allEq = sets.every((s) => s.fromEq);
    return createWarning(allEq ? 'CONFLICTING_EQUALITY' : 'EMPTY_INTERSECTION', {
      message: allEq
        ? `"${field.label}" cannot equal two different values at once, so no rows will match.`
        : `The allowed values for "${field.label}" do not overlap, so no rows will match.`,
      messageKey: allEq ? 'conflict.equality' : 'conflict.intersection',
      params: { field: field.label },
      field: field.id,
    });
  }

  function checkNull(field: ResolvedField, conditions: FilterCondition[]): PragmaWarning | undefined {
    const requiresNull = conditions.some((c) => c.operator === 'isNull');
    if (!requiresNull) return undefined;
    const requiresValue = conditions.some((c) => c.operator !== 'isNull' && c.operator !== 'isEmpty' && c.operator !== 'neq' && c.operator !== 'notIn' && c.operator !== 'notContains' && c.operator !== 'notBetween');
    if (!requiresValue) return undefined;
    return createWarning('CONFLICTING_NULL', {
      message: `"${field.label}" cannot both have no value and match a value, so no rows will match.`,
      messageKey: 'conflict.null',
      params: { field: field.label },
      field: field.id,
    });
  }
}
