import {
  DURATION_UNITS,
  MUTATION_OPS,
  type Ambiguity,
  type FilterNode,
  type FilterValue,
  type IdGenerator,
  type Mutation,
  type Operator,
  type ResolvedSchema,
  type Suggestion,
} from '@pragma/core';
import { z } from 'zod';
import type { Proposal } from '../types.js';

/**
 * The model-facing output format. It is intentionally flatter than the internal
 * Mutation union: every property is present (nullable when unused), which is what
 * structured-output modes handle most reliably. `toProposal` converts it; the
 * engine then validates everything against the schema.
 */

const nullable = (schema: Record<string, unknown>): Record<string, unknown> => ({
  anyOf: [schema, { type: 'null' }],
});

const scalar = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };

const valueSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: scalar },
    {
      type: 'object',
      properties: {
        amount: { type: 'integer' },
        unit: { type: 'string', enum: [...DURATION_UNITS] },
      },
      required: ['amount', 'unit'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const conditionSchema = {
  type: 'object',
  description: 'A single condition: field + operator + value.',
  properties: {
    field: { type: 'string' },
    operator: { type: 'string' },
    value: valueSchema,
    caseSensitive: nullable({ type: 'boolean' }),
  },
  required: ['field', 'operator', 'value', 'caseSensitive'],
  additionalProperties: false,
};

// Deliberately non-recursive (some structured-output implementations reject
// recursive schemas): a filter is one condition, or one group of conditions.
// Separate addFilter actions are AND-ed, so (A or B) and (C or D) is two actions.
const filterSchema = {
  type: 'object',
  description:
    'A condition (field + operator + value), or, when "conditions" is non-empty, a group combining those conditions with "logic".',
  properties: {
    field: nullable({ type: 'string' }),
    operator: nullable({ type: 'string' }),
    value: valueSchema,
    caseSensitive: nullable({ type: 'boolean' }),
    logic: nullable({ type: 'string', enum: ['and', 'or'] }),
    not: nullable({ type: 'boolean' }),
    conditions: nullable({ type: 'array', items: { $ref: '#/$defs/condition' } }),
  },
  required: ['field', 'operator', 'value', 'caseSensitive', 'logic', 'not', 'conditions'],
  additionalProperties: false,
};

const actionSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...MUTATION_OPS] },
    filter: nullable({ $ref: '#/$defs/filter' }),
    logic: nullable({ type: 'string', enum: ['and', 'or'] }),
    field: nullable({ type: 'string' }),
    filterId: nullable({ type: 'string' }),
    sort: nullable({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['field', 'direction'],
        additionalProperties: false,
      },
    }),
    search: nullable({
      type: 'object',
      properties: {
        query: { type: 'string' },
        fields: nullable({ type: 'array', items: { type: 'string' } }),
      },
      required: ['query', 'fields'],
      additionalProperties: false,
    }),
    page: nullable({ type: 'integer' }),
    pageSize: nullable({ type: 'integer' }),
  },
  required: ['op', 'filter', 'logic', 'field', 'filterId', 'sort', 'search', 'page', 'pageSize'],
  additionalProperties: false,
};

/** JSON Schema of the model output. @public */
export const MODEL_OUTPUT_JSON_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  $defs: { condition: conditionSchema, filter: filterSchema, action: actionSchema },
  properties: {
    actions: { type: 'array', items: { $ref: '#/$defs/action' } },
    ambiguities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          kind: { type: 'string', enum: ['field', 'value', 'date_range', 'operator', 'intent'] },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                actions: { type: 'array', items: { $ref: '#/$defs/action' } },
                isDefault: { type: 'boolean' },
              },
              required: ['label', 'actions', 'isDefault'],
              additionalProperties: false,
            },
          },
        },
        required: ['question', 'kind', 'options'],
        additionalProperties: false,
      },
    },
    unsupported: nullable({
      type: 'object',
      properties: {
        reason: { type: 'string' },
        suggestedFields: { type: 'array', items: { type: 'string' } },
      },
      required: ['reason', 'suggestedFields'],
      additionalProperties: false,
    }),
  },
  required: ['actions', 'ambiguities', 'unsupported'],
  additionalProperties: false,
};

/* ------------------------------ lenient parsing ----------------------------- */
// Parsing is deliberately more forgiving than the JSON Schema (missing keys are
// treated as null) because many models and gateways do not enforce schemas.

const opt = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const zScalar = z.union([z.string().max(1000), z.number(), z.boolean()]);
const zValue = z.union([
  zScalar,
  z.array(zScalar).max(100),
  z.object({ amount: z.number(), unit: z.string() }),
]);

interface ModelFilter {
  field?: string | null | undefined;
  operator?: string | null | undefined;
  value?: z.infer<typeof zValue> | null | undefined;
  caseSensitive?: boolean | null | undefined;
  logic?: 'and' | 'or' | null | undefined;
  not?: boolean | null | undefined;
  conditions?: ModelFilter[] | null | undefined;
}

const zFilter: z.ZodType<ModelFilter> = z.lazy(() =>
  z.object({
    field: opt(z.string().max(128)),
    operator: opt(z.string().max(64)),
    value: opt(zValue),
    caseSensitive: opt(z.boolean()),
    logic: opt(z.enum(['and', 'or'])),
    not: opt(z.boolean()),
    conditions: opt(z.array(zFilter).max(50)),
  }),
);

const zAction = z.object({
  op: z.enum(MUTATION_OPS as unknown as [string, ...string[]]),
  filter: opt(zFilter),
  logic: opt(z.enum(['and', 'or'])),
  field: opt(z.string().max(128)),
  filterId: opt(z.string().max(128)),
  sort: opt(
    z.array(z.object({ field: z.string().max(128), direction: z.enum(['asc', 'desc']) })).max(20),
  ),
  search: opt(
    z.object({ query: z.string().max(200), fields: opt(z.array(z.string().max(128)).max(50)) }),
  ),
  page: opt(z.number().int()),
  pageSize: opt(z.number().int()),
});

export const modelOutputSchema = z.object({
  actions: z.array(zAction).max(50).default([]),
  ambiguities: z
    .array(
      z.object({
        question: z.string().max(500),
        kind: z.enum(['field', 'value', 'date_range', 'operator', 'intent']).catch('intent'),
        options: z
          .array(
            z.object({
              label: z.string().max(200),
              actions: z.array(zAction).max(20),
              isDefault: opt(z.boolean()),
            }),
          )
          .max(20),
      }),
    )
    .max(10)
    .default([]),
  unsupported: opt(
    z.object({
      reason: z.string().max(500),
      suggestedFields: opt(z.array(z.string().max(128)).max(20)),
    }),
  ),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;
type ModelAction = z.infer<typeof zAction>;

/** Pull a JSON object out of free-form model text (code fences, prose around it). @internal */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new SyntaxError('No JSON object found in model output');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Convert model output into a proposal. Structural only: fields, operators and
 * values are validated later by the engine against the schema.
 *
 * @internal
 */
export function toProposal(
  output: ModelOutput,
  schema: ResolvedSchema,
  ids: IdGenerator,
): Proposal {
  if (output.unsupported) {
    const suggestions: Suggestion[] = (output.unsupported.suggestedFields ?? []).flatMap((id) => {
      const field = schema.fieldsById.get(id.replace(/^@/, ''));
      return field
        ? [
            {
              kind: 'field' as const,
              label: field.label,
              insertText: `@${field.id}`,
              field: field.id,
            },
          ]
        : [];
    });
    return {
      mutations: [],
      ambiguities: [],
      unsupported: {
        reason: output.unsupported.reason,
        messageKey: 'model.unsupported',
        suggestions,
      },
    };
  }
  const mutations = output.actions.flatMap((a) => toMutation(a, ids));
  const ambiguities: Ambiguity[] = output.ambiguities
    .map((a) => ({
      id: ids('amb'),
      kind: a.kind,
      message: a.question,
      messageKey: 'model.ambiguity',
      options: a.options.map((o) => ({
        id: ids('opt'),
        label: o.label,
        mutations: o.actions.flatMap((act) => toMutation(act, ids)),
        ...(o.isDefault === true ? { isDefault: true } : {}),
      })),
    }))
    .filter((a) => a.options.length > 0);
  return { mutations, ambiguities };
}

function toMutation(action: ModelAction, ids: IdGenerator): Mutation[] {
  switch (action.op) {
    case 'setSearch':
      if (!action.search) return [];
      return [
        {
          op: 'setSearch',
          search: action.search.fields
            ? { query: action.search.query, fields: action.search.fields }
            : { query: action.search.query },
        },
      ];
    case 'addFilter':
    case 'replaceFilter': {
      const node = action.filter ? toNode(action.filter, ids) : undefined;
      if (action.op === 'replaceFilter') return [{ op: 'replaceFilter', node: node ?? null }];
      if (!node) return [];
      return [{ op: 'addFilter', node, ...(action.logic ? { logic: action.logic } : {}) }];
    }
    case 'removeFilter':
      if (action.filterId) return [{ op: 'removeFilter', target: { id: action.filterId } }];
      return action.field ? [{ op: 'removeFilter', target: { field: action.field } }] : [];
    case 'setSort':
      return action.sort ? [{ op: 'setSort', sort: action.sort }] : [];
    case 'addSort':
      return action.sort?.[0] ? [{ op: 'addSort', spec: action.sort[0] }] : [];
    case 'removeSort':
      return action.field ? [{ op: 'removeSort', field: action.field }] : [];
    case 'setPage':
      return typeof action.page === 'number' ? [{ op: 'setPage', page: action.page }] : [];
    case 'setPageSize':
      return typeof action.pageSize === 'number'
        ? [{ op: 'setPageSize', size: action.pageSize }]
        : [];
    case 'clearSearch':
    case 'clearFilters':
    case 'clearSort':
    case 'nextPage':
    case 'prevPage':
    case 'reset':
      return [{ op: action.op }];
    default:
      return [];
  }
}

function toNode(filter: ModelFilter, ids: IdGenerator): FilterNode | undefined {
  if (filter.conditions && filter.conditions.length > 0) {
    const children = filter.conditions
      .map((c) => toNode(c, ids))
      .filter((c): c is FilterNode => c !== undefined);
    if (children.length === 0) return undefined;
    return {
      type: 'group',
      id: ids('g'),
      logic: filter.logic ?? 'and',
      ...(filter.not === true ? { not: true } : {}),
      children,
    };
  }
  if (!filter.field || !filter.operator) return undefined;
  const value = toValue(filter.value);
  return {
    type: 'condition',
    id: ids('f'),
    field: filter.field.replace(/^@/, ''),
    operator: filter.operator as Operator,
    ...(value === undefined ? {} : { value }),
    ...(typeof filter.caseSensitive === 'boolean'
      ? { options: { caseSensitive: filter.caseSensitive } }
      : {}),
  };
}

function toValue(value: ModelFilter['value']): FilterValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object')
    return { amount: value.amount, unit: value.unit as (typeof DURATION_UNITS)[number] };
  return value;
}
