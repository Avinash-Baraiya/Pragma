/**
 * Stable error codes. Part of the public API: codes are never renamed or removed
 * within a major version. New codes may be added in minor versions, so consumers
 * must handle unknown codes gracefully.
 *
 * @public
 */
export const ErrorCode = {
  /** Developer-supplied schema is invalid. Thrown at `defineSchema` time. */
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  /** Engine / handler / provider configuration is invalid. Thrown at construction time. */
  CONFIG_ERROR: 'CONFIG_ERROR',
  /** Instruction could not be parsed (e.g. empty after trimming). */
  PARSE_ERROR: 'PARSE_ERROR',
  /** Field does not exist or is not visible to the caller. Hidden fields yield the same code. */
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  /** `@resource` reference does not match the schema resource. */
  UNKNOWN_RESOURCE: 'UNKNOWN_RESOURCE',
  /** Operator unknown, or not legal for the field's type/configuration. */
  INVALID_OPERATOR: 'INVALID_OPERATOR',
  /** Value cannot be coerced to the field type or does not match the operator's value shape. */
  INVALID_VALUE: 'INVALID_VALUE',
  /** A value's type is incompatible with the field type. */
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  /** The instruction is ambiguous and the ambiguity policy forbids guessing. */
  AMBIGUOUS_QUERY: 'AMBIGUOUS_QUERY',
  /** The request asks for something the protocol or schema does not support. */
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  /** The schema's declared capabilities do not allow the operation (e.g. page N on cursor-only). */
  CAPABILITY_UNSUPPORTED: 'CAPABILITY_UNSUPPORTED',
  /** A mutation targets something that does not exist (e.g. removing a filter that is not applied). */
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  /** A configured limit (length, depth, count, page size) was exceeded. */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  /** Structural validation of a payload failed. */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Payload declares a protocol version this library cannot handle. */
  UNSUPPORTED_PROTOCOL_VERSION: 'UNSUPPORTED_PROTOCOL_VERSION',
  /** The language model provider failed (network, upstream 5xx, auth, ...). */
  MODEL_ERROR: 'MODEL_ERROR',
  /** The language model answered, but its output could not be parsed or repaired. */
  MODEL_OUTPUT_INVALID: 'MODEL_OUTPUT_INVALID',
  /** No provider is configured and the deterministic parser could not handle the instruction. */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** Upstream rate limit hit. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** The operation exceeded its deadline. */
  TIMEOUT: 'TIMEOUT',
  /** The operation was cancelled by the caller via AbortSignal. */
  ABORTED: 'ABORTED',
  /** Authorization hook denied the request. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Transport-level problem between the client SDK and the server handler. */
  TRANSPORT_ERROR: 'TRANSPORT_ERROR',
  /** Unexpected internal failure. Indicates a bug; always reported with a requestId. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** @public */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Stable warning codes. Warnings never block a result; they surface assumptions,
 * automatic corrections, or queries that are valid but suspicious.
 *
 * @public
 */
export const WarningCode = {
  /** AND-ed range conditions on one field cannot overlap (e.g. age > 30 AND age < 20). */
  EMPTY_RANGE: 'EMPTY_RANGE',
  /** AND-ed equality conditions on one field require two different values. */
  CONFLICTING_EQUALITY: 'CONFLICTING_EQUALITY',
  /** AND-ed `in`/`eq` conditions have no common value. */
  EMPTY_INTERSECTION: 'EMPTY_INTERSECTION',
  /** A field is required to be both null and non-null / have a value. */
  CONFLICTING_NULL: 'CONFLICTING_NULL',
  /** `between` bounds were given in reverse order and were swapped. */
  BOUNDS_REORDERED: 'BOUNDS_REORDERED',
  /** Identical conditions or sorts were de-duplicated. */
  DUPLICATE_REMOVED: 'DUPLICATE_REMOVED',
  /** A value was clamped to a configured limit (bestGuess policy only). */
  VALUE_CLAMPED: 'VALUE_CLAMPED',
  /** An ambiguity was resolved by applying its default option (bestGuess policy only). */
  ASSUMPTION_APPLIED: 'ASSUMPTION_APPLIED',
  /** No timezone was supplied; UTC was used for relative dates. */
  TIMEZONE_DEFAULTED: 'TIMEZONE_DEFAULTED',
  /** A mutation removed several matching targets (e.g. two filters on the same field). */
  MULTIPLE_TARGETS_AFFECTED: 'MULTIPLE_TARGETS_AFFECTED',
  /** Page navigation was clamped (e.g. previous page from page 1). */
  PAGE_CLAMPED: 'PAGE_CLAMPED',
  /** The language model was unavailable; only the deterministic interpretation was used. */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** Equality conditions OR-ed on one field were collapsed into a single `in`. */
  CONDITIONS_MERGED: 'CONDITIONS_MERGED',
} as const;

/** @public */
export type WarningCode = (typeof WarningCode)[keyof typeof WarningCode];

/** Codes considered transient: retrying the same request may succeed. @public */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ErrorCode.MODEL_ERROR,
  ErrorCode.RATE_LIMITED,
  ErrorCode.TIMEOUT,
  ErrorCode.TRANSPORT_ERROR,
]);
