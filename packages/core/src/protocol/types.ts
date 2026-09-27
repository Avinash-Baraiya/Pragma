import type { PragmaIssue, PragmaWarning, MessageParam } from '../errors/errors.js';
import type { DurationUnit, Operator } from '../operators/catalog.js';

/** Current protocol version emitted by this library. @public */
export const PROTOCOL_VERSION = '1.0';

/** @public */
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** @public */
export type PaginationType = 'page' | 'offset' | 'cursor';

/** @public */
export const PAGINATION_TYPES: readonly PaginationType[] = ['page', 'offset', 'cursor'];

/** Relative duration used by the `last` / `next` operators. @public */
export interface RelativeDuration {
  readonly amount: number;
  readonly unit: DurationUnit;
}

/** A scalar filter value. Dates are ISO-8601 strings. @public */
export type ScalarValue = string | number | boolean;

/**
 * Value carried by a condition. Its shape is determined by the operator's arity:
 * `single` → scalar, `range` → `[from, to]`, `list` → scalar[], `duration` → {@link RelativeDuration},
 * `none` → absent.
 *
 * @public
 */
export type FilterValue =
  ScalarValue | readonly [ScalarValue, ScalarValue] | readonly ScalarValue[] | RelativeDuration;

/** @public */
export interface ConditionOptions {
  /** Text comparison is case-insensitive by default. */
  readonly caseSensitive?: boolean;
}

/** Leaf node of the filter tree. @public */
export interface FilterCondition {
  readonly type: 'condition';
  /** Stable id, unique within a query. Used for chip removal and targeted mutations. */
  readonly id: string;
  readonly field: string;
  readonly operator: Operator;
  readonly value?: FilterValue;
  readonly options?: ConditionOptions;
}

/** Boolean group node of the filter tree. @public */
export interface FilterGroup {
  readonly type: 'group';
  readonly id: string;
  readonly logic: 'and' | 'or';
  /** Negates the whole group. Prefer `neq`/`notIn` where possible. */
  readonly not?: boolean;
  readonly children: readonly FilterNode[];
}

/** @public */
export type FilterNode = FilterCondition | FilterGroup;

/** @public */
export interface SortSpec {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
  /** Default `last`. */
  readonly nulls?: 'first' | 'last';
}

/** @public */
export interface SearchSpec {
  readonly query: string;
  /** Restrict search to these fields. Default: every searchable field. */
  readonly fields?: readonly string[];
}

/** @public */
export interface PagePagination {
  readonly type: 'page';
  /** 1-based. */
  readonly page: number;
  readonly pageSize: number;
}

/** @public */
export interface OffsetPagination {
  readonly type: 'offset';
  readonly offset: number;
  readonly limit: number;
}

/** @public */
export interface CursorPagination {
  readonly type: 'cursor';
  /** Opaque cursor issued by the consumer's backend; `null` means the first page. */
  readonly cursor: string | null;
  readonly limit: number;
}

/** @public */
export type Pagination = PagePagination | OffsetPagination | CursorPagination;

/** @public */
export interface QueryContext {
  /** IANA timezone used to resolve relative dates and plain dates on datetime fields. */
  readonly timezone: string;
  /** 0 = Sunday, 1 = Monday. Default 1. */
  readonly weekStartsOn?: 0 | 1;
}

/**
 * The standard, library-agnostic table query. This is the product's core contract.
 * It knows nothing about SQL, React or any table library.
 *
 * @public
 */
export interface TableQuery {
  readonly version: ProtocolVersion;
  readonly resource: string;
  readonly search: SearchSpec | null;
  /** Root of the filter tree, always a group when present. */
  readonly filter: FilterGroup | null;
  readonly sort: readonly SortSpec[];
  readonly pagination: Pagination;
  readonly context?: QueryContext;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

/** Target of a `removeFilter` mutation. @public */
export type FilterTarget = { readonly id: string } | { readonly field: string };

/**
 * Atomic change to a {@link TableQuery}. Interpreters emit mutations, never final
 * queries; the engine applies them in order to the current state. This gives
 * merge / replace / remove / reset semantics uniformly.
 *
 * @public
 */
export type Mutation =
  | { readonly op: 'setSearch'; readonly search: SearchSpec }
  | { readonly op: 'clearSearch' }
  | { readonly op: 'addFilter'; readonly node: FilterNode; readonly logic?: 'and' | 'or' }
  | { readonly op: 'removeFilter'; readonly target: FilterTarget }
  | { readonly op: 'replaceFilter'; readonly node: FilterNode | null }
  | { readonly op: 'clearFilters' }
  | { readonly op: 'setSort'; readonly sort: readonly SortSpec[] }
  | { readonly op: 'addSort'; readonly spec: SortSpec }
  | { readonly op: 'removeSort'; readonly field: string }
  | { readonly op: 'clearSort' }
  | { readonly op: 'setPage'; readonly page: number }
  | { readonly op: 'nextPage' }
  | { readonly op: 'prevPage' }
  | { readonly op: 'setPageSize'; readonly size: number }
  | { readonly op: 'reset' };

/** @public */
export type MutationOp = Mutation['op'];

/** @public */
export const MUTATION_OPS: readonly MutationOp[] = [
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
  'setPage',
  'nextPage',
  'prevPage',
  'setPageSize',
  'reset',
];

/* -------------------------------------------------------------------------- */
/* Interpretation result                                                      */
/* -------------------------------------------------------------------------- */

/** @public */
export type AmbiguityKind = 'field' | 'value' | 'date_range' | 'operator' | 'intent';

/** @public */
export interface AmbiguityOption {
  readonly id: string;
  readonly label: string;
  /** Mutations applied when this option is chosen. No further model call is needed. */
  readonly mutations: readonly Mutation[];
  /** Applied automatically under the `bestGuess` ambiguity policy. */
  readonly isDefault?: boolean;
}

/** @public */
export interface Ambiguity {
  readonly id: string;
  readonly kind: AmbiguityKind;
  readonly message: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, MessageParam>>;
  readonly options: readonly AmbiguityOption[];
}

/** Hint offered with an `unsupported` result, e.g. a field the user may have meant. @public */
export interface Suggestion {
  readonly kind: 'field' | 'value' | 'operator' | 'instruction';
  readonly label: string;
  /** Text the UI may insert, e.g. `@revenue`. */
  readonly insertText?: string;
  readonly field?: string;
}

/** One line of the deterministic, human-readable explanation of a query. @public */
export interface ExplanationItem {
  readonly kind: 'search' | 'filter' | 'sort' | 'pagination';
  /** Id of the root-level filter node this item describes (for chip removal). */
  readonly nodeId?: string;
  /** Field this item relates to (sort / single-condition filter). */
  readonly field?: string;
  readonly text: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, MessageParam>>;
}

/** @public */
export type ParserKind = 'deterministic' | 'llm' | 'cache' | 'local';

/** @public */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Operational metadata attached to every result. Contains no user data. @public */
export interface ResultMeta {
  readonly requestId: string;
  readonly parser: ParserKind;
  readonly model?: string;
  readonly provider?: string;
  readonly latencyMs: number;
  readonly usage?: TokenUsage;
  readonly retries?: number;
  readonly schemaHash: string;
  readonly engineVersion: string;
  readonly protocolVersion: ProtocolVersion;
}

/** @public */
export interface OkResult {
  readonly status: 'ok';
  readonly query: TableQuery;
  /** The mutations that were applied to the input state, after validation. */
  readonly mutations: readonly Mutation[];
  readonly explanation: readonly ExplanationItem[];
  readonly warnings: readonly PragmaWarning[];
  readonly meta: ResultMeta;
}

/** @public */
export interface ClarificationResult {
  readonly status: 'needs_clarification';
  readonly ambiguities: readonly Ambiguity[];
  /** Unambiguous mutations understood so far; applied together with the chosen options. */
  readonly partial: readonly Mutation[];
  readonly warnings: readonly PragmaWarning[];
  readonly meta: ResultMeta;
}

/** @public */
export interface UnsupportedResult {
  readonly status: 'unsupported';
  readonly errors: readonly PragmaIssue[];
  readonly suggestions: readonly Suggestion[];
  readonly meta: ResultMeta;
}

/** @public */
export interface ErrorResult {
  readonly status: 'error';
  readonly errors: readonly PragmaIssue[];
  readonly meta: ResultMeta;
}

/**
 * Outcome of interpreting an instruction. `interpret()` always resolves to one of
 * these; it never rejects for runtime problems.
 *
 * @public
 */
export type InterpretResult = OkResult | ClarificationResult | UnsupportedResult | ErrorResult;

/** @public */
export type InterpretStatus = InterpretResult['status'];
