import type { MessageParam } from '../errors/errors.js';
import { OPERATOR_ARITY, OPERATOR_LABELS } from '../operators/catalog.js';
import type { ExplanationItem, FilterCondition, FilterNode, RelativeDuration, ScalarValue, TableQuery } from '../protocol/types.js';
import type { ResolvedField, ResolvedSchema } from '../schema/types.js';

/**
 * Deterministic, human-readable explanation of a query. Generated from the
 * validated query (never from model prose), so it always describes exactly what
 * will be executed. Each root-level filter becomes its own item carrying the
 * node id, so UIs can render removable chips.
 *
 * @public
 */
export function explainQuery(query: TableQuery, schema: ResolvedSchema): ExplanationItem[] {
  const items: ExplanationItem[] = [];

  if (query.search !== null) {
    const scope = query.search.fields?.map((f) => labelOf(schema, f)).join(', ');
    items.push({
      kind: 'search',
      text: scope ? `Search "${query.search.query}" in ${scope}` : `Search "${query.search.query}"`,
      messageKey: scope ? 'explain.searchIn' : 'explain.search',
      params: scope ? { query: query.search.query, fields: scope } : { query: query.search.query },
    });
  }

  if (query.filter !== null) {
    const root = query.filter;
    const topLevel = root.logic === 'and' && root.not !== true ? root.children : [root];
    for (const node of topLevel) {
      if (node.type === 'condition') {
        const { text, messageKey, params } = describeCondition(node, schema);
        items.push({ kind: 'filter', nodeId: node.id, field: node.field, text, messageKey, params });
      } else {
        const text = describeNode(node, schema, false);
        items.push({ kind: 'filter', nodeId: node.id, text, messageKey: 'explain.group', params: { text } });
      }
    }
  }

  for (const spec of query.sort) {
    const label = labelOf(schema, spec.field);
    const direction = spec.direction === 'asc' ? 'ascending' : 'descending';
    items.push({
      kind: 'sort',
      field: spec.field,
      text: `Sorted by ${label} (${direction})`,
      messageKey: `explain.sort.${spec.direction}`,
      params: { field: label },
    });
  }

  const p = query.pagination;
  switch (p.type) {
    case 'page':
      items.push({
        kind: 'pagination',
        text: `Page ${p.page}, ${p.pageSize} per page`,
        messageKey: 'explain.page',
        params: { page: p.page, pageSize: p.pageSize },
      });
      break;
    case 'offset':
      items.push({
        kind: 'pagination',
        text: `Rows ${p.offset + 1}–${p.offset + p.limit}`,
        messageKey: 'explain.offset',
        params: { from: p.offset + 1, to: p.offset + p.limit },
      });
      break;
    case 'cursor':
      items.push({ kind: 'pagination', text: `${p.limit} per page`, messageKey: 'explain.cursor', params: { limit: p.limit } });
      break;
  }

  return items;
}

/** Plain-text description of a whole filter tree. @public */
export function describeFilter(node: FilterNode | null, schema: ResolvedSchema): string {
  return node === null ? '' : describeNode(node, schema, false);
}

function describeNode(node: FilterNode, schema: ResolvedSchema, nested: boolean): string {
  if (node.type === 'condition') return describeCondition(node, schema).text;
  const inner = node.children.map((c) => describeNode(c, schema, true)).join(node.logic === 'and' ? ' and ' : ' or ');
  if (node.not === true) return `not (${inner})`;
  return nested && node.children.length > 1 ? `(${inner})` : inner;
}

function describeCondition(
  condition: FilterCondition,
  schema: ResolvedSchema,
): { text: string; messageKey: string; params: Record<string, MessageParam> } {
  const field = schema.fieldsById.get(condition.field);
  const label = field?.label ?? condition.field;
  const op = OPERATOR_LABELS[condition.operator];
  const messageKey = `explain.condition.${condition.operator}`;
  switch (OPERATOR_ARITY[condition.operator]) {
    case 'none':
      return { text: `${label} ${op}`, messageKey, params: { field: label } };
    case 'single': {
      const value = formatValue(field, condition.value as ScalarValue);
      return { text: `${label} ${op} ${value}`, messageKey, params: { field: label, value } };
    }
    case 'range': {
      const [a, b] = condition.value as readonly [ScalarValue, ScalarValue];
      const from = formatValue(field, a);
      const to = formatValue(field, b);
      return { text: `${label} ${op} ${from} and ${to}`, messageKey, params: { field: label, from, to } };
    }
    case 'list': {
      const value = (condition.value as readonly ScalarValue[]).map((v) => formatValue(field, v)).join(', ');
      return { text: `${label} ${op} ${value}`, messageKey, params: { field: label, value } };
    }
    case 'duration': {
      const { amount, unit } = condition.value as RelativeDuration;
      const value = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
      return { text: `${label} ${op} ${value}`, messageKey, params: { field: label, amount, unit } };
    }
  }
}

/** Format a value for display using field metadata (enum labels, currency, percent). @public */
export function formatValue(field: ResolvedField | undefined, value: ScalarValue): string {
  if (!field) return String(value);
  switch (field.type) {
    case 'enum':
      return field.values.find((v) => v.value === value)?.label ?? String(value);
    case 'boolean':
      return value === true ? 'yes' : 'no';
    case 'number': {
      if (typeof value !== 'number') return String(value);
      if (field.format === 'currency' && field.currency) {
        try {
          return new Intl.NumberFormat('en', { style: 'currency', currency: field.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
        } catch {
          return `${value} ${field.currency}`;
        }
      }
      if (field.format === 'percent') return `${field.percentScale === 'fraction' ? round(value * 100) : value}%`;
      return String(value);
    }
    case 'string':
      return `"${String(value)}"`;
    case 'date':
    case 'datetime':
      return String(value);
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function labelOf(schema: ResolvedSchema, fieldId: string): string {
  return schema.fieldsById.get(fieldId)?.label ?? fieldId;
}
