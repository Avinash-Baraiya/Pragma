import { createIssue, createWarning, type PragmaIssue, type PragmaWarning } from '../errors/errors.js';
import { collectNodeIds, createInitialQuery, firstPage, pageSizeOf } from '../protocol/query.js';
import type { FilterGroup, FilterNode, Mutation, Pagination, SortSpec, TableQuery } from '../protocol/types.js';
import type { ResolvedSchema } from '../schema/types.js';
import { assertNever, randomId, type IdGenerator } from '../util/ids.js';

/** Cursor information the consumer's backend returned with the current page. @public */
export interface PageInfo {
  /** Cursor for the next page; absent/null when there is no next page. */
  readonly nextCursor?: string | null;
  /** Cursor for the previous page; `null` means "the first page". Absent when unknown. */
  readonly prevCursor?: string | null;
}

/** @public */
export interface ApplyOptions {
  readonly schema: ResolvedSchema;
  readonly idGenerator?: IdGenerator;
  readonly pageInfo?: PageInfo;
}

/** @public */
export interface ApplyResult {
  readonly query: TableQuery;
  /** Blocking problems (e.g. removing a filter that does not exist). The query is unchanged when present. */
  readonly issues: readonly PragmaIssue[];
  readonly warnings: readonly PragmaWarning[];
}

const PAGE_RESETTING_OPS: ReadonlySet<Mutation['op']> = new Set([
  'setSearch',
  'clearSearch',
  'addFilter',
  'removeFilter',
  'replaceFilter',
  'clearFilters',
  'setSort',
  'addSort',
  'removeSort',
  'clearSort',
  'setPageSize',
]);
const PAGE_EXPLICIT_OPS: ReadonlySet<Mutation['op']> = new Set(['setPage', 'nextPage', 'prevPage']);

/**
 * Apply validated mutations, in order, to the current query.
 *
 * Semantics:
 * - Mutations compose: "clear filters and only India" = `clearFilters` then `addFilter`.
 * - Any change to search, filters, sort or page size returns to the first page,
 *   unless the same batch explicitly navigates (`setPage`/`nextPage`/`prevPage`).
 * - `reset` restores schema defaults but keeps the pagination style and context.
 * - Node ids are kept unique; colliding ids from interpreters are re-generated.
 *
 * All-or-nothing: if any mutation fails, the original query is returned with issues.
 *
 * @public
 */
export function applyMutations(state: TableQuery, mutations: readonly Mutation[], options: ApplyOptions): ApplyResult {
  const ids = options.idGenerator ?? randomId;
  const issues: PragmaIssue[] = [];
  const warnings: PragmaWarning[] = [];
  let query = state;
  let resetPage = false;
  let explicitPage = false;

  for (const [index, mutation] of mutations.entries()) {
    if (issues.length > 0) break;
    const path = ['mutations', index];
    if (PAGE_RESETTING_OPS.has(mutation.op)) resetPage = true;
    if (PAGE_EXPLICIT_OPS.has(mutation.op)) explicitPage = true;

    switch (mutation.op) {
      case 'setSearch':
        query = { ...query, search: mutation.search };
        break;
      case 'clearSearch':
        query = { ...query, search: null };
        break;
      case 'addFilter': {
        const node = withUniqueIds(mutation.node, collectNodeIds(query.filter), ids);
        query = { ...query, filter: addNode(query.filter, node, mutation.logic ?? 'and', ids) };
        break;
      }
      case 'replaceFilter':
        query = { ...query, filter: mutation.node === null ? null : asRootGroup(withUniqueIds(mutation.node, new Set(), ids), ids) };
        break;
      case 'removeFilter': {
        const { filter, removed } = removeNodes(query.filter, (node) =>
          'id' in mutation.target ? node.id === mutation.target.id : node.type === 'condition' && node.field === mutation.target.field,
        );
        if (removed === 0) {
          const target = 'id' in mutation.target ? mutation.target.id : mutation.target.field;
          const label = 'field' in mutation.target ? (options.schema.fieldsById.get(mutation.target.field)?.label ?? target) : target;
          issues.push(
            createIssue('TARGET_NOT_FOUND', {
              message: 'field' in mutation.target ? `There is no filter on "${label}" to remove.` : `There is no filter with id "${target}".`,
              messageKey: 'filter.notFound',
              params: { target: label },
              path,
              ...('field' in mutation.target ? { field: mutation.target.field } : {}),
            }),
          );
          continue;
        }
        if (removed > 1) {
          warnings.push(
            createWarning('MULTIPLE_TARGETS_AFFECTED', {
              message: `Removed ${removed} filters.`,
              messageKey: 'filter.removedMultiple',
              params: { count: removed },
              path,
            }),
          );
        }
        query = { ...query, filter };
        break;
      }
      case 'clearFilters':
        query = { ...query, filter: null };
        break;
      case 'setSort':
        query = { ...query, sort: mutation.sort };
        break;
      case 'addSort': {
        const rest = query.sort.filter((s) => s.field !== mutation.spec.field);
        const sort: SortSpec[] = [...rest, mutation.spec];
        if (sort.length > options.schema.capabilities.maxSorts) {
          issues.push(
            createIssue('LIMIT_EXCEEDED', {
              message: `Too many sort fields; the maximum is ${options.schema.capabilities.maxSorts}.`,
              messageKey: 'limit.sorts',
              params: { count: sort.length, max: options.schema.capabilities.maxSorts },
              path,
            }),
          );
          continue;
        }
        query = { ...query, sort };
        break;
      }
      case 'removeSort': {
        if (!query.sort.some((s) => s.field === mutation.field)) {
          const label = options.schema.fieldsById.get(mutation.field)?.label ?? mutation.field;
          issues.push(
            createIssue('TARGET_NOT_FOUND', {
              message: `The table is not sorted by "${label}".`,
              messageKey: 'sort.notFound',
              params: { target: label },
              path,
              field: mutation.field,
            }),
          );
          continue;
        }
        query = { ...query, sort: query.sort.filter((s) => s.field !== mutation.field) };
        break;
      }
      case 'clearSort':
        query = { ...query, sort: [] };
        break;
      case 'setPage': {
        const next = jumpToPage(query.pagination, mutation.page);
        if (!next) {
          issues.push(
            createIssue('CAPABILITY_UNSUPPORTED', {
              message: 'Jumping to a specific page is not possible with cursor pagination.',
              messageKey: 'capability.pageJump',
              path,
            }),
          );
          continue;
        }
        query = { ...query, pagination: next };
        break;
      }
      case 'nextPage':
      case 'prevPage': {
        const moved = step(query.pagination, mutation.op === 'nextPage' ? 1 : -1, options.pageInfo);
        if ('issue' in moved) {
          issues.push(createIssue('TARGET_NOT_FOUND', { ...moved.issue, path }));
          continue;
        }
        if (moved.clamped) {
          warnings.push(createWarning('PAGE_CLAMPED', { message: 'Already on the first page.', messageKey: 'pagination.firstPage', path }));
        }
        query = { ...query, pagination: moved.pagination };
        break;
      }
      case 'setPageSize':
        query = { ...query, pagination: withPageSize(query.pagination, mutation.size) };
        break;
      case 'reset': {
        const initial = createInitialQuery(options.schema, {
          paginationType: query.pagination.type,
          ...(query.context ? { context: query.context } : {}),
        });
        query = initial;
        break;
      }
      default:
        assertNever(mutation, 'Unknown mutation');
    }
  }

  if (issues.length > 0) return { query: state, issues, warnings };
  if (resetPage && !explicitPage) {
    query = { ...query, pagination: firstPage(query.pagination.type, pageSizeOf(query.pagination)) };
  }
  return { query, issues, warnings };
}

/* ------------------------------ filter helpers ----------------------------- */

function asRootGroup(node: FilterNode, ids: IdGenerator): FilterGroup {
  return node.type === 'group' ? node : { type: 'group', id: ids('g'), logic: 'and', children: [node] };
}

function addNode(root: FilterGroup | null, node: FilterNode, logic: 'and' | 'or', ids: IdGenerator): FilterGroup {
  if (root === null) return asRootGroup(node, ids);
  if (root.logic === logic && root.not !== true) {
    // Splice same-logic groups in rather than nesting them.
    const incoming = node.type === 'group' && node.logic === logic && node.not !== true ? node.children : [node];
    return { ...root, children: [...root.children, ...incoming] };
  }
  return { type: 'group', id: ids('g'), logic, children: [root, node] };
}

function removeNodes(root: FilterGroup | null, match: (node: FilterNode) => boolean): { filter: FilterGroup | null; removed: number } {
  if (root === null) return { filter: null, removed: 0 };
  let removed = 0;
  const visit = (node: FilterNode): FilterNode | null => {
    if (match(node)) {
      removed += node.type === 'condition' ? 1 : Math.max(1, countLeaves(node));
      return null;
    }
    if (node.type === 'condition') return node;
    const children = node.children.map(visit).filter((c): c is FilterNode => c !== null);
    if (children.length === 0) return null;
    return children.length === node.children.length ? node : { ...node, children };
  };
  if (match(root)) return { filter: null, removed: Math.max(1, countLeaves(root)) };
  const result = visit(root);
  return { filter: result === null ? null : (result as FilterGroup), removed };
}

function countLeaves(node: FilterNode): number {
  return node.type === 'condition' ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0);
}

function withUniqueIds(node: FilterNode, taken: Set<string>, ids: IdGenerator): FilterNode {
  const id = taken.has(node.id) ? freshId(node.type === 'group' ? 'g' : 'f', taken, ids) : node.id;
  taken.add(id);
  if (node.type === 'condition') return id === node.id ? node : { ...node, id };
  const children = node.children.map((c) => withUniqueIds(c, taken, ids));
  return { ...node, id, children };
}

function freshId(prefix: string, taken: Set<string>, ids: IdGenerator): string {
  for (;;) {
    const id = ids(prefix);
    if (!taken.has(id)) return id;
  }
}

/* ---------------------------- pagination helpers --------------------------- */

function withPageSize(pagination: Pagination, size: number): Pagination {
  return pagination.type === 'page' ? { ...pagination, pageSize: size } : { ...pagination, limit: size };
}

function jumpToPage(pagination: Pagination, page: number): Pagination | undefined {
  switch (pagination.type) {
    case 'page':
      return { ...pagination, page };
    case 'offset':
      return { ...pagination, offset: (page - 1) * pagination.limit };
    case 'cursor':
      return undefined;
  }
}

type StepResult =
  | { readonly pagination: Pagination; readonly clamped: boolean }
  | { readonly issue: { readonly message: string; readonly messageKey: string } };

function step(pagination: Pagination, direction: 1 | -1, pageInfo: PageInfo | undefined): StepResult {
  switch (pagination.type) {
    case 'page': {
      const page = pagination.page + direction;
      return page < 1 ? { pagination, clamped: true } : { pagination: { ...pagination, page }, clamped: false };
    }
    case 'offset': {
      const offset = pagination.offset + direction * pagination.limit;
      return offset < 0
        ? { pagination: { ...pagination, offset: 0 }, clamped: pagination.offset === 0 }
        : { pagination: { ...pagination, offset }, clamped: false };
    }
    case 'cursor': {
      if (direction === 1) {
        const next = pageInfo?.nextCursor;
        if (next === undefined || next === null) {
          return { issue: { message: 'There is no next page available.', messageKey: 'pagination.noNextPage' } };
        }
        return { pagination: { ...pagination, cursor: next }, clamped: false };
      }
      if (pagination.cursor === null) return { pagination, clamped: true };
      const prev = pageInfo?.prevCursor;
      if (prev === undefined) {
        return { issue: { message: 'The previous page cursor is not known.', messageKey: 'pagination.noPrevPage' } };
      }
      return { pagination: { ...pagination, cursor: prev }, clamped: false };
    }
  }
}
