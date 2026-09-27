import type { ResolvedSchema } from '../schema/types.js';
import {
  PROTOCOL_VERSION,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type Pagination,
  type PaginationType,
  type QueryContext,
  type TableQuery,
} from './types.js';

/** Options for {@link createInitialQuery}. @public */
export interface InitialQueryOptions {
  readonly context?: QueryContext;
  /** Pagination style; defaults to the schema's first declared style. */
  readonly paginationType?: PaginationType;
}

/**
 * The query a table starts with (and returns to on `reset`): no search, no
 * filters, the schema's default sort and the first page.
 *
 * @public
 */
export function createInitialQuery(schema: ResolvedSchema, options: InitialQueryOptions = {}): TableQuery {
  const type = options.paginationType ?? schema.capabilities.pagination[0] ?? 'page';
  const query: TableQuery = {
    version: PROTOCOL_VERSION,
    resource: schema.resource,
    search: null,
    filter: null,
    sort: schema.defaults.sort,
    pagination: firstPage(type, schema.defaults.pageSize),
  };
  return options.context ? { ...query, context: options.context } : query;
}

/** First page for the given pagination style. @public */
export function firstPage(type: PaginationType, size: number): Pagination {
  switch (type) {
    case 'page':
      return { type: 'page', page: 1, pageSize: size };
    case 'offset':
      return { type: 'offset', offset: 0, limit: size };
    case 'cursor':
      return { type: 'cursor', cursor: null, limit: size };
  }
}

/** Page size regardless of pagination style. @public */
export function pageSizeOf(pagination: Pagination): number {
  return pagination.type === 'page' ? pagination.pageSize : pagination.limit;
}

/** Depth-first iteration over every condition in a filter tree. @public */
export function* iterateConditions(node: FilterNode | null): Generator<FilterCondition> {
  if (node === null) return;
  if (node.type === 'condition') {
    yield node;
    return;
  }
  for (const child of node.children) yield* iterateConditions(child);
}

/** Number of conditions in a filter tree. @public */
export function countConditions(node: FilterNode | null): number {
  let count = 0;
  for (const _ of iterateConditions(node)) count++;
  return count;
}

/** Group nesting depth (a root group containing only conditions has depth 1). @public */
export function groupDepth(node: FilterNode | null): number {
  if (node === null || node.type === 'condition') return 0;
  let max = 0;
  for (const child of node.children) max = Math.max(max, groupDepth(child));
  return max + 1;
}

/**
 * If the filter is a plain conjunction of conditions (a single AND group without
 * negation or nesting), return its conditions. Otherwise return `null`.
 * Adapters use this for the common fast path (e.g. TanStack column filters).
 *
 * @public
 */
export function flattenFilter(query: Pick<TableQuery, 'filter'>): readonly FilterCondition[] | null {
  const root = query.filter;
  if (root === null) return [];
  if (root.logic !== 'and' || root.not === true) return root.children.length <= 1 && root.not !== true ? onlyConditions(root) : null;
  return onlyConditions(root);
}

function onlyConditions(group: FilterGroup): readonly FilterCondition[] | null {
  const out: FilterCondition[] = [];
  for (const child of group.children) {
    if (child.type !== 'condition') return null;
    out.push(child);
  }
  return out;
}

/** Collect every node id in a filter tree. @public */
export function collectNodeIds(node: FilterNode | null, into: Set<string> = new Set()): Set<string> {
  if (node === null) return into;
  into.add(node.id);
  if (node.type === 'group') for (const child of node.children) collectNodeIds(child, into);
  return into;
}
