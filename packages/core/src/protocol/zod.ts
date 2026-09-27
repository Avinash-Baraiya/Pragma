import { z } from 'zod';
import { DURATION_UNITS, OPERATORS } from '../operators/catalog.js';
import { FIELD_FORMATS, FIELD_TYPES } from '../schema/types.js';
import { type MUTATION_OPS, PAGINATION_TYPES, PROTOCOL_VERSION } from './types.js';

/**
 * Structural (shape-only) runtime schemas for protocol payloads.
 *
 * These guard every trust boundary: model output, HTTP bodies, `currentState`
 * supplied by callers. Semantic checks against a table schema happen in the
 * validator. Size limits here exist to bound work on hostile input.
 */

export const LIMITS = {
  maxIdLength: 128,
  maxStringValueLength: 1000,
  maxListLength: 100,
  maxGroupChildren: 50,
  maxSearchLength: 200,
  maxSorts: 20,
  maxMutations: 50,
  maxDurationAmount: 10_000,
  maxLabelLength: 200,
  maxDescriptionLength: 1000,
  maxFields: 500,
  maxAliases: 50,
  maxEnumValues: 1000,
} as const;

const id = z.string().min(1).max(LIMITS.maxIdLength);
const fieldRef = z.string().min(1).max(LIMITS.maxIdLength);

export const scalarValueSchema = z.union([
  z.string().max(LIMITS.maxStringValueLength),
  z.number().refine(Number.isFinite, 'must be a finite number'),
  z.boolean(),
]);

export const relativeDurationSchema = z.strictObject({
  amount: z.number().int().positive().max(LIMITS.maxDurationAmount),
  unit: z.enum(DURATION_UNITS),
});

export const filterValueSchema = z.union([
  scalarValueSchema,
  z.array(scalarValueSchema).max(LIMITS.maxListLength),
  relativeDurationSchema,
]);

export const conditionOptionsSchema = z.strictObject({
  caseSensitive: z.boolean().optional(),
});

export const filterConditionSchema = z.strictObject({
  type: z.literal('condition'),
  id,
  field: fieldRef,
  operator: z.enum(OPERATORS),
  value: filterValueSchema.optional(),
  options: conditionOptionsSchema.optional(),
});

export const filterGroupSchema = z.strictObject({
  type: z.literal('group'),
  id,
  logic: z.enum(['and', 'or']),
  not: z.boolean().optional(),
  get children() {
    return z.array(filterNodeSchema).max(LIMITS.maxGroupChildren);
  },
});

export const filterNodeSchema = z.discriminatedUnion('type', [
  filterConditionSchema,
  filterGroupSchema,
]);

export const sortSpecSchema = z.strictObject({
  field: fieldRef,
  direction: z.enum(['asc', 'desc']),
  nulls: z.enum(['first', 'last']).optional(),
});

export const searchSpecSchema = z.strictObject({
  query: z.string().min(1).max(LIMITS.maxSearchLength),
  fields: z.array(fieldRef).max(LIMITS.maxFields).optional(),
});

const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const paginationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('page'), page: positiveInt, pageSize: positiveInt }),
  z.strictObject({
    type: z.literal('offset'),
    offset: z.number().int().min(0),
    limit: positiveInt,
  }),
  z.strictObject({
    type: z.literal('cursor'),
    cursor: z.string().max(4096).nullable(),
    limit: positiveInt,
  }),
]);

export const queryContextSchema = z.strictObject({
  timezone: z.string().min(1).max(64),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const tableQuerySchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  resource: z.string().min(1).max(LIMITS.maxIdLength),
  search: searchSpecSchema.nullable(),
  filter: filterGroupSchema.nullable(),
  sort: z.array(sortSpecSchema).max(LIMITS.maxSorts),
  pagination: paginationSchema,
  context: queryContextSchema.optional(),
});

const filterTargetSchema = z.union([z.strictObject({ id }), z.strictObject({ field: fieldRef })]);

export const mutationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('setSearch'), search: searchSpecSchema }),
  z.strictObject({ op: z.literal('clearSearch') }),
  z.strictObject({
    op: z.literal('addFilter'),
    node: filterNodeSchema,
    logic: z.enum(['and', 'or']).optional(),
  }),
  z.strictObject({ op: z.literal('removeFilter'), target: filterTargetSchema }),
  z.strictObject({ op: z.literal('replaceFilter'), node: filterNodeSchema.nullable() }),
  z.strictObject({ op: z.literal('clearFilters') }),
  z.strictObject({ op: z.literal('setSort'), sort: z.array(sortSpecSchema).max(LIMITS.maxSorts) }),
  z.strictObject({ op: z.literal('addSort'), spec: sortSpecSchema }),
  z.strictObject({ op: z.literal('removeSort'), field: fieldRef }),
  z.strictObject({ op: z.literal('clearSort') }),
  z.strictObject({ op: z.literal('setPage'), page: positiveInt }),
  z.strictObject({ op: z.literal('nextPage') }),
  z.strictObject({ op: z.literal('prevPage') }),
  z.strictObject({ op: z.literal('setPageSize'), size: positiveInt }),
  z.strictObject({ op: z.literal('reset') }),
]);

export const mutationListSchema = z.array(mutationSchema).max(LIMITS.maxMutations);

// Compile-time guard: every mutation op declared in types.ts has a schema branch.
type _AssertTrue<T extends true> = T;
type _MutationOpsCovered = _AssertTrue<
  (typeof MUTATION_OPS)[number] extends z.infer<typeof mutationSchema>['op'] ? true : false
>;

/* ---------------------------------- schema --------------------------------- */

const label = z.string().min(1).max(LIMITS.maxLabelLength);
const aliasList = z.array(label).max(LIMITS.maxAliases);

export const enumValueSchema = z.strictObject({
  value: z.string().min(1).max(LIMITS.maxLabelLength),
  label: label.optional(),
  aliases: aliasList.optional(),
});

export const fieldDefSchema = z.strictObject({
  id: fieldRef,
  label,
  type: z.enum(FIELD_TYPES as [string, ...string[]]),
  aliases: aliasList.optional(),
  description: z.string().max(LIMITS.maxDescriptionLength).optional(),
  format: z.enum(FIELD_FORMATS as [string, ...string[]]).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code')
    .optional(),
  percentScale: z.enum(['fraction', 'whole']).optional(),
  values: z.array(enumValueSchema).max(LIMITS.maxEnumValues).optional(),
  operators: z.array(z.enum(OPERATORS)).optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  searchable: z.boolean().optional(),
  nullable: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

export const tableSchemaSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  resource: z.string().min(1).max(LIMITS.maxIdLength),
  label: label.optional(),
  aliases: aliasList.optional(),
  description: z.string().max(LIMITS.maxDescriptionLength).optional(),
  fields: z.array(fieldDefSchema).min(1).max(LIMITS.maxFields),
  defaults: z
    .strictObject({
      pageSize: positiveInt.optional(),
      sort: z.array(sortSpecSchema).max(LIMITS.maxSorts).optional(),
      recencyField: fieldRef.optional(),
    })
    .optional(),
  capabilities: z
    .strictObject({
      search: z.boolean().optional(),
      pagination: z
        .array(z.enum(PAGINATION_TYPES as [string, ...string[]]))
        .min(1)
        .optional(),
      maxPageSize: positiveInt.optional(),
      maxSorts: positiveInt.max(LIMITS.maxSorts).optional(),
    })
    .optional(),
});
