/**
 * @pragma/core — schema model, TableQuery protocol, operators, validation,
 * normalization, mutations, date semantics and the reference executor.
 *
 * Framework-agnostic: no knowledge of React, table libraries, SQL or model vendors.
 *
 * @packageDocumentation
 */

// errors
export { ErrorCode, WarningCode, RETRYABLE_CODES } from './errors/codes.js';
export {
  createIssue,
  createWarning,
  isAbortError,
  isPragmaError,
  PragmaConfigError,
  PragmaError,
  PragmaModelError,
  PragmaTimeoutError,
  PragmaTransportError,
  PragmaValidationError,
  toIssue,
} from './errors/errors.js';
export type { IssueInit, MessageParam, PragmaIssue, PragmaWarning, WarningInit } from './errors/errors.js';

// operators
export {
  DURATION_UNITS,
  isOperator,
  OPERATOR_ARITY,
  OPERATOR_LABELS,
  OPERATORS,
  OPERATORS_BY_TYPE,
  RELATIVE_DATE_OPERATORS,
  TEXT_OPERATORS,
} from './operators/catalog.js';
export type { DurationUnit, Operator, OperatorArity } from './operators/catalog.js';

// schema
export { FIELD_FORMATS, FIELD_TYPES, SCHEMA_VERSION } from './schema/types.js';
export type {
  EnumValue,
  FieldDef,
  FieldFormat,
  FieldType,
  ResolvedField,
  ResolvedSchema,
  SchemaCapabilities,
  SchemaDefaults,
  TableSchema,
} from './schema/types.js';
export { DEFAULT_MAX_PAGE_SIZE, DEFAULT_MAX_SORTS, DEFAULT_PAGE_SIZE, defineSchema, getField, visibleFields } from './schema/define-schema.js';
export { fieldTerms, findFieldByTerm, suggestFields } from './schema/lookup.js';
export type { FieldSuggestionOptions } from './schema/lookup.js';

// protocol
export { MUTATION_OPS, PAGINATION_TYPES, PROTOCOL_VERSION } from './protocol/types.js';
export type {
  Ambiguity,
  AmbiguityKind,
  AmbiguityOption,
  ClarificationResult,
  ConditionOptions,
  CursorPagination,
  ErrorResult,
  ExplanationItem,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterTarget,
  FilterValue,
  InterpretResult,
  InterpretStatus,
  Mutation,
  MutationOp,
  OffsetPagination,
  OkResult,
  PagePagination,
  Pagination,
  PaginationType,
  ParserKind,
  ProtocolVersion,
  QueryContext,
  RelativeDuration,
  ResultMeta,
  ScalarValue,
  SearchSpec,
  SortSpec,
  Suggestion,
  TableQuery,
  TokenUsage,
  UnsupportedResult,
} from './protocol/types.js';
export { parseMutations, parseTableQuery, parseTableSchema } from './protocol/parse.js';
export type { ParseResult } from './protocol/parse.js';
export {
  collectNodeIds,
  countConditions,
  createInitialQuery,
  firstPage,
  flattenFilter,
  groupDepth,
  iterateConditions,
  pageSizeOf,
} from './protocol/query.js';
export type { InitialQueryOptions } from './protocol/query.js';
export {
  filterNodeSchema,
  LIMITS,
  mutationListSchema,
  mutationSchema,
  tableQuerySchema,
  tableSchemaSchema,
} from './protocol/zod.js';

// validation
export { DEFAULT_QUERY_LIMITS, validateMutations, validateQuery } from './validator/validate.js';
export type { QueryLimits, ValidationOptions, ValidationResult } from './validator/validate.js';
export { coerceOperatorValue, coerceScalar, matchEnumValue } from './validator/values.js';

// mutations
export { applyMutations } from './mutations/apply.js';
export type { ApplyOptions, ApplyResult, PageInfo } from './mutations/apply.js';

// normalization
export { canonicalizeQuery, hashQuery, normalizeQuery, queriesEqual } from './normalizer/normalize.js';
export type { NormalizeResult } from './normalizer/normalize.js';
export { analyzeConflicts } from './normalizer/conflicts.js';
export type { ConflictOptions } from './normalizer/conflicts.js';

// dates
export { compileDateRange, inDateRange, operandInterval, resolveDates } from './dates/intervals.js';
export type { DateContext, DateRange } from './dates/intervals.js';
export { isValidTimeZone } from './dates/calendar.js';

// explanation
export { describeFilter, explainQuery, formatValue } from './explain/explain.js';

// execution
export { compileComparator, compilePredicate, defaultGetValue, executeQuery } from './executor/in-memory.js';
export type { ExecuteOptions, ExecuteResult, ValueGetter } from './executor/in-memory.js';

// mentions
export { findMentions, getActiveMention, resolveMention, suggestMentions } from './mentions/mentions.js';
export type { MentionResolution, MentionSuggestion, MentionToken, SuggestOptions } from './mentions/mentions.js';

// utilities
export { sha256, stableStringify } from './hash/sha256.js';
export { randomId, sequentialIds } from './util/ids.js';
export type { IdGenerator } from './util/ids.js';
export { normalizeTerm } from './util/text.js';
