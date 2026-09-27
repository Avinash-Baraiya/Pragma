import { isValidTimeZone } from '../dates/calendar.js';
import {
  createIssue,
  createWarning,
  type PragmaIssue,
  type PragmaWarning,
} from '../errors/errors.js';
import { isOperator, TEXT_OPERATORS } from '../operators/catalog.js';
import { countConditions, groupDepth } from '../protocol/query.js';
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  Mutation,
  Pagination,
  SearchSpec,
  SortSpec,
  TableQuery,
} from '../protocol/types.js';
import { suggestFields } from '../schema/lookup.js';
import type { ResolvedField, ResolvedSchema } from '../schema/types.js';
import { assertNever } from '../util/ids.js';
import { coerceOperatorValue } from './values.js';

/** Structural limits enforced on every query. @public */
export interface QueryLimits {
  /** Maximum number of conditions in the filter tree. Default 20. */
  readonly maxConditions: number;
  /** Maximum group nesting depth (root group = 1). Default 3. */
  readonly maxDepth: number;
}

/** @public */
export const DEFAULT_QUERY_LIMITS: QueryLimits = { maxConditions: 20, maxDepth: 3 };

/** @public */
export interface ValidationOptions {
  readonly limits?: Partial<QueryLimits>;
  /**
   * What to do when a requested page size exceeds `capabilities.maxPageSize`:
   * `error` (default) reports `LIMIT_EXCEEDED`; `clamp` clamps and warns.
   */
  readonly pageSizeOverflow?: 'error' | 'clamp';
}

/** @public */
export interface ValidationResult<T> {
  /** The coerced value; present only when there are no issues. */
  readonly value: T | undefined;
  readonly issues: readonly PragmaIssue[];
  readonly warnings: readonly PragmaWarning[];
}

type Path = readonly (string | number)[];

class Collector {
  readonly issues: PragmaIssue[] = [];
  readonly warnings: PragmaWarning[] = [];
}

/* -------------------------------------------------------------------------- */
/* Field resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Report an unknown field. Hidden fields produce exactly the same issue as
 * non-existent ones so that their existence is never revealed.
 */
function unknownField(
  schema: ResolvedSchema,
  fieldId: string,
  path: Path,
  predicate?: (f: ResolvedField) => boolean,
): PragmaIssue {
  const suggestions = suggestFields(schema, fieldId, predicate ? { predicate } : {});
  return createIssue('UNKNOWN_FIELD', {
    message: `Unknown field "${fieldId}".`,
    messageKey: 'field.unknown',
    params: { field: fieldId, suggestions: suggestions.map((f) => f.label) },
    path,
    field: fieldId,
    details: { suggestions: suggestions.map((f) => ({ id: f.id, label: f.label, type: f.type })) },
  });
}

function requireField(
  schema: ResolvedSchema,
  fieldId: string,
  path: Path,
  c: Collector,
  capability: 'filter' | 'sort' | 'search',
): ResolvedField | undefined {
  const field = schema.fieldsById.get(fieldId);
  const capable = (f: ResolvedField): boolean =>
    capability === 'filter' ? f.filterable : capability === 'sort' ? f.sortable : f.searchable;
  if (!field) {
    c.issues.push(unknownField(schema, fieldId, path, capable));
    return undefined;
  }
  if (!capable(field)) {
    const verb =
      capability === 'filter' ? 'filtered' : capability === 'sort' ? 'sorted' : 'searched';
    const alternatives = [...schema.fieldsById.values()].filter(capable).slice(0, 5);
    c.issues.push(
      createIssue('UNSUPPORTED_OPERATION', {
        message: `"${field.label}" cannot be ${verb}.`,
        messageKey: `field.not${capability === 'filter' ? 'Filterable' : capability === 'sort' ? 'Sortable' : 'Searchable'}`,
        params: { field: field.label },
        path,
        field: field.id,
        details: {
          suggestions: alternatives.map((f) => ({ id: f.id, label: f.label, type: f.type })),
        },
      }),
    );
    return undefined;
  }
  return field;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

function validateCondition(
  condition: FilterCondition,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
): FilterCondition | undefined {
  const field = requireField(schema, condition.field, [...path, 'field'], c, 'filter');
  if (!field) return undefined;

  if (!isOperator(condition.operator)) {
    c.issues.push(
      createIssue('INVALID_OPERATOR', {
        message: `Unknown operator "${String(condition.operator)}".`,
        messageKey: 'operator.unknown',
        params: { operator: String(condition.operator) },
        path: [...path, 'operator'],
        field: field.id,
        details: { allowed: field.operators },
      }),
    );
    return undefined;
  }
  if (!field.operators.includes(condition.operator)) {
    c.issues.push(
      createIssue('INVALID_OPERATOR', {
        message: `Operator "${condition.operator}" cannot be used with ${field.type} field "${field.label}".`,
        messageKey: 'operator.notAllowed',
        params: {
          operator: condition.operator,
          field: field.label,
          type: field.type,
          allowed: [...field.operators],
        },
        path: [...path, 'operator'],
        field: field.id,
        details: { allowed: field.operators },
      }),
    );
    return undefined;
  }

  if (
    condition.options?.caseSensitive !== undefined &&
    (field.type !== 'string' || !TEXT_OPERATORS.has(condition.operator))
  ) {
    c.issues.push(
      createIssue('VALIDATION_ERROR', {
        message: `"caseSensitive" only applies to text comparisons (field "${field.label}").`,
        messageKey: 'options.caseSensitiveNotApplicable',
        params: { field: field.label },
        path: [...path, 'options', 'caseSensitive'],
        field: field.id,
      }),
    );
    return undefined;
  }

  const coerced = coerceOperatorValue(field, condition.operator, condition.value, path);
  if (!coerced.ok) {
    c.issues.push(coerced.issue);
    return undefined;
  }
  const out: FilterCondition = {
    type: 'condition',
    id: condition.id,
    field: field.id,
    operator: condition.operator,
    ...(coerced.value === undefined ? {} : { value: coerced.value }),
    ...(condition.options?.caseSensitive === undefined
      ? {}
      : { options: { caseSensitive: condition.options.caseSensitive } }),
  };
  return out;
}

function validateNode(
  node: FilterNode,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
  ids: Set<string>,
): FilterNode | undefined {
  if (ids.has(node.id)) {
    c.issues.push(
      createIssue('VALIDATION_ERROR', {
        message: `Duplicate filter node id "${node.id}".`,
        messageKey: 'filter.duplicateId',
        params: { id: node.id },
        path: [...path, 'id'],
      }),
    );
  }
  ids.add(node.id);
  if (node.type === 'condition') return validateCondition(node, schema, path, c);
  const before = c.issues.length;
  const children = node.children.map((child, i) =>
    validateNode(child, schema, [...path, 'children', i], c, ids),
  );
  if (c.issues.length > before) return undefined;
  const group: FilterGroup = {
    type: 'group',
    id: node.id,
    logic: node.logic,
    ...(node.not === true ? { not: true } : {}),
    children: children as FilterNode[],
  };
  return group;
}

function checkTreeLimits(root: FilterNode, limits: QueryLimits, path: Path, c: Collector): void {
  const conditions = countConditions(root);
  if (conditions > limits.maxConditions) {
    c.issues.push(
      createIssue('LIMIT_EXCEEDED', {
        message: `Too many filter conditions (${conditions}); the maximum is ${limits.maxConditions}.`,
        messageKey: 'limit.conditions',
        params: { count: conditions, max: limits.maxConditions },
        path,
      }),
    );
  }
  const depth = groupDepth(root);
  if (depth > limits.maxDepth) {
    c.issues.push(
      createIssue('LIMIT_EXCEEDED', {
        message: `Filter groups are nested too deeply (${depth}); the maximum is ${limits.maxDepth}.`,
        messageKey: 'limit.depth',
        params: { depth, max: limits.maxDepth },
        path,
      }),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Search / sort / pagination                                                 */
/* -------------------------------------------------------------------------- */

function validateSearch(
  search: SearchSpec,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
): SearchSpec | undefined {
  const searchable = [...schema.fieldsById.values()].filter((f) => f.searchable);
  if (!schema.capabilities.search || searchable.length === 0) {
    c.issues.push(
      createIssue('CAPABILITY_UNSUPPORTED', {
        message: 'Search is not supported for this table.',
        messageKey: 'capability.search',
        path,
      }),
    );
    return undefined;
  }
  const query = search.query.trim();
  if (query === '') {
    c.issues.push(
      createIssue('INVALID_VALUE', {
        message: 'Search text cannot be empty.',
        messageKey: 'search.empty',
        path: [...path, 'query'],
      }),
    );
    return undefined;
  }
  if (search.fields === undefined) return { query };
  if (search.fields.length === 0) {
    c.issues.push(
      createIssue('INVALID_VALUE', {
        message: 'Search fields cannot be an empty list.',
        messageKey: 'search.emptyFields',
        path: [...path, 'fields'],
      }),
    );
    return undefined;
  }
  const before = c.issues.length;
  const fields = search.fields.map(
    (id, i) => requireField(schema, id, [...path, 'fields', i], c, 'search')?.id,
  );
  if (c.issues.length > before) return undefined;
  return { query, fields: [...new Set(fields as string[])] };
}

function validateSortList(
  sort: readonly SortSpec[],
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
): SortSpec[] | undefined {
  if (sort.length > schema.capabilities.maxSorts) {
    c.issues.push(
      createIssue('LIMIT_EXCEEDED', {
        message: `Too many sort fields (${sort.length}); the maximum is ${schema.capabilities.maxSorts}.`,
        messageKey: 'limit.sorts',
        params: { count: sort.length, max: schema.capabilities.maxSorts },
        path,
      }),
    );
    return undefined;
  }
  const before = c.issues.length;
  const seen = new Set<string>();
  const out: SortSpec[] = [];
  sort.forEach((spec, i) => {
    const field = requireField(schema, spec.field, [...path, i, 'field'], c, 'sort');
    if (!field) return;
    if (seen.has(field.id)) {
      c.warnings.push(
        createWarning('DUPLICATE_REMOVED', {
          message: `"${field.label}" appears more than once in the sort; only the first is kept.`,
          messageKey: 'sort.duplicate',
          params: { field: field.label },
          path: [...path, i],
          field: field.id,
        }),
      );
      return;
    }
    seen.add(field.id);
    out.push(
      spec.nulls === undefined
        ? { field: field.id, direction: spec.direction }
        : { field: field.id, direction: spec.direction, nulls: spec.nulls },
    );
  });
  return c.issues.length > before ? undefined : out;
}

function validatePageSize(
  size: number,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
  options: ValidationOptions,
): number | undefined {
  const max = schema.capabilities.maxPageSize;
  if (size <= max) return size;
  if (options.pageSizeOverflow === 'clamp') {
    c.warnings.push(
      createWarning('VALUE_CLAMPED', {
        message: `Page size ${size} exceeds the maximum of ${max}; using ${max}.`,
        messageKey: 'pagination.pageSizeClamped',
        params: { requested: size, max },
        path,
      }),
    );
    return max;
  }
  c.issues.push(
    createIssue('LIMIT_EXCEEDED', {
      message: `Page size ${size} exceeds the maximum of ${max}.`,
      messageKey: 'limit.pageSize',
      params: { requested: size, max },
      path,
    }),
  );
  return undefined;
}

function validatePagination(
  pagination: Pagination,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
  options: ValidationOptions,
): Pagination | undefined {
  if (!schema.capabilities.pagination.includes(pagination.type)) {
    c.issues.push(
      createIssue('CAPABILITY_UNSUPPORTED', {
        message: `Pagination type "${pagination.type}" is not supported; supported: ${schema.capabilities.pagination.join(', ')}.`,
        messageKey: 'capability.pagination',
        params: { type: pagination.type, supported: [...schema.capabilities.pagination] },
        path: [...path, 'type'],
      }),
    );
    return undefined;
  }
  switch (pagination.type) {
    case 'page': {
      const pageSize = validatePageSize(
        pagination.pageSize,
        schema,
        [...path, 'pageSize'],
        c,
        options,
      );
      return pageSize === undefined ? undefined : { ...pagination, pageSize };
    }
    case 'offset':
    case 'cursor': {
      const limit = validatePageSize(pagination.limit, schema, [...path, 'limit'], c, options);
      return limit === undefined ? undefined : { ...pagination, limit };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Semantically validate a structurally valid {@link TableQuery} against a schema:
 * fields exist and are visible, operators are legal, values coerce, capabilities
 * and limits are respected. Returns the coerced query when valid.
 *
 * Use `parseTableQuery` first for untrusted input.
 *
 * @public
 */
export function validateQuery(
  query: TableQuery,
  schema: ResolvedSchema,
  options: ValidationOptions = {},
): ValidationResult<TableQuery> {
  const c = new Collector();
  const limits = { ...DEFAULT_QUERY_LIMITS, ...options.limits };

  if (query.resource !== schema.resource) {
    c.issues.push(
      createIssue('UNKNOWN_RESOURCE', {
        message: `Query targets resource "${query.resource}" but the schema describes "${schema.resource}".`,
        messageKey: 'resource.mismatch',
        params: { resource: query.resource, expected: schema.resource },
        path: ['resource'],
      }),
    );
  }

  if (query.context !== undefined && !isValidTimeZone(query.context.timezone)) {
    c.issues.push(
      createIssue('INVALID_VALUE', {
        message: `Unknown timezone "${query.context.timezone}".`,
        messageKey: 'context.timezone',
        params: { timezone: query.context.timezone },
        path: ['context', 'timezone'],
      }),
    );
  }

  const search = query.search === null ? null : validateSearch(query.search, schema, ['search'], c);
  let filter: FilterGroup | null | undefined = null;
  if (query.filter !== null) {
    filter = validateNode(query.filter, schema, ['filter'], c, new Set()) as
      FilterGroup | undefined;
    checkTreeLimits(query.filter, limits, ['filter'], c);
  }
  const sort = validateSortList(query.sort, schema, ['sort'], c);
  const pagination = validatePagination(query.pagination, schema, ['pagination'], c, options);

  if (
    c.issues.length > 0 ||
    search === undefined ||
    filter === undefined ||
    sort === undefined ||
    pagination === undefined
  ) {
    return { value: undefined, issues: c.issues, warnings: c.warnings };
  }
  const value: TableQuery = {
    version: query.version,
    resource: query.resource,
    search,
    filter,
    sort,
    pagination,
    ...(query.context ? { context: query.context } : {}),
  };
  return { value, issues: [], warnings: c.warnings };
}

/**
 * Validate and coerce mutations proposed by an interpreter (deterministic or
 * model) before they are applied. Every field, operator and value is checked
 * against the schema; nothing unknown can pass through.
 *
 * @public
 */
export function validateMutations(
  mutations: readonly Mutation[],
  schema: ResolvedSchema,
  options: ValidationOptions = {},
): ValidationResult<Mutation[]> {
  const c = new Collector();
  const limits = { ...DEFAULT_QUERY_LIMITS, ...options.limits };
  const out: Mutation[] = [];

  mutations.forEach((mutation, i) => {
    const path: Path = ['mutations', i];
    const before = c.issues.length;
    const result = validateMutation(mutation, schema, path, c, options, limits);
    if (result !== undefined && c.issues.length === before) out.push(result);
  });

  return c.issues.length > 0
    ? { value: undefined, issues: c.issues, warnings: c.warnings }
    : { value: out, issues: [], warnings: c.warnings };
}

function validateMutation(
  mutation: Mutation,
  schema: ResolvedSchema,
  path: Path,
  c: Collector,
  options: ValidationOptions,
  limits: QueryLimits,
): Mutation | undefined {
  switch (mutation.op) {
    case 'setSearch': {
      const search = validateSearch(mutation.search, schema, [...path, 'search'], c);
      return search ? { op: 'setSearch', search } : undefined;
    }
    case 'addFilter':
    case 'replaceFilter': {
      if (mutation.op === 'replaceFilter' && mutation.node === null) return mutation;
      const node = mutation.node as FilterNode;
      const validated = validateNode(node, schema, [...path, 'node'], c, new Set());
      checkTreeLimits(node, limits, [...path, 'node'], c);
      if (!validated) return undefined;
      return mutation.op === 'addFilter'
        ? { op: 'addFilter', node: validated, ...(mutation.logic ? { logic: mutation.logic } : {}) }
        : { op: 'replaceFilter', node: validated };
    }
    case 'removeFilter': {
      if ('field' in mutation.target) {
        const field = schema.fieldsById.get(mutation.target.field);
        if (!field) {
          c.issues.push(unknownField(schema, mutation.target.field, [...path, 'target', 'field']));
          return undefined;
        }
        return { op: 'removeFilter', target: { field: field.id } };
      }
      return mutation;
    }
    case 'setSort': {
      const sort = validateSortList(mutation.sort, schema, [...path, 'sort'], c);
      return sort ? { op: 'setSort', sort } : undefined;
    }
    case 'addSort': {
      const sort = validateSortList([mutation.spec], schema, [...path, 'spec'], c);
      return sort?.[0] ? { op: 'addSort', spec: sort[0] } : undefined;
    }
    case 'removeSort': {
      const field = schema.fieldsById.get(mutation.field);
      if (!field) {
        c.issues.push(unknownField(schema, mutation.field, [...path, 'field']));
        return undefined;
      }
      return { op: 'removeSort', field: field.id };
    }
    case 'setPage': {
      if (!schema.capabilities.pagination.some((t) => t === 'page' || t === 'offset')) {
        c.issues.push(
          createIssue('CAPABILITY_UNSUPPORTED', {
            message:
              'Jumping to a specific page is not supported for this table (cursor pagination only).',
            messageKey: 'capability.pageJump',
            path,
          }),
        );
        return undefined;
      }
      return mutation;
    }
    case 'setPageSize': {
      const size = validatePageSize(mutation.size, schema, [...path, 'size'], c, options);
      return size === undefined ? undefined : { op: 'setPageSize', size };
    }
    case 'clearSearch':
    case 'clearFilters':
    case 'clearSort':
    case 'nextPage':
    case 'prevPage':
    case 'reset':
      return mutation;
    default:
      return assertNever(mutation, 'Unknown mutation');
  }
}
