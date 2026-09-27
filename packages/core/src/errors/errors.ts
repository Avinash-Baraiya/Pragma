import { type ErrorCode, RETRYABLE_CODES, type WarningCode } from './codes.js';

/** Primitive parameter values used to render localized messages. @public */
export type MessageParam = string | number | boolean | readonly string[];

/**
 * Serializable description of a problem. This is what travels inside results and
 * over the wire. It never contains stack traces or secrets.
 *
 * `messageKey` + `params` allow consumers to render their own localized text;
 * `message` is an English fallback.
 *
 * @public
 */
export interface PragmaIssue {
  readonly code: ErrorCode;
  readonly message: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, MessageParam>>;
  /** JSON path of the offending element inside the payload, when applicable. */
  readonly path?: readonly (string | number)[];
  /** Field id the issue relates to, when applicable. */
  readonly field?: string;
  /** Whether retrying the identical request may succeed. */
  readonly retryable: boolean;
  /** Extra machine-readable context (e.g. suggestions). Must be JSON-serializable. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Non-blocking notice attached to a successful result. @public */
export interface PragmaWarning {
  readonly code: WarningCode;
  readonly message: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, MessageParam>>;
  readonly path?: readonly (string | number)[];
  readonly field?: string;
}

/** Options accepted by {@link createIssue}. @public */
export interface IssueInit {
  readonly message: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, MessageParam>>;
  readonly path?: readonly (string | number)[];
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
}

/** Build a {@link PragmaIssue}; `retryable` defaults from the code. @public */
export function createIssue(code: ErrorCode, init: IssueInit): PragmaIssue {
  const issue: {
    -readonly [K in keyof PragmaIssue]: PragmaIssue[K];
  } = {
    code,
    message: init.message,
    messageKey: init.messageKey,
    retryable: init.retryable ?? RETRYABLE_CODES.has(code),
  };
  if (init.params !== undefined) issue.params = init.params;
  if (init.path !== undefined) issue.path = init.path;
  if (init.field !== undefined) issue.field = init.field;
  if (init.details !== undefined) issue.details = init.details;
  return issue;
}

/** Options accepted by {@link createWarning}. @public */
export type WarningInit = Omit<IssueInit, 'details' | 'retryable'>;

/** Build a {@link PragmaWarning}. @public */
export function createWarning(code: WarningCode, init: WarningInit): PragmaWarning {
  const warning: { -readonly [K in keyof PragmaWarning]: PragmaWarning[K] } = {
    code,
    message: init.message,
    messageKey: init.messageKey,
  };
  if (init.params !== undefined) warning.params = init.params;
  if (init.path !== undefined) warning.path = init.path;
  if (init.field !== undefined) warning.field = init.field;
  return warning;
}

const PRAGMA_ERROR_BRAND = Symbol.for('@pragma/error');

/**
 * Base class for every error thrown by Pragma packages.
 *
 * Runtime problems (bad user input, model failures, validation) are *returned* as
 * {@link PragmaIssue}s inside results. Errors are *thrown* only for programmer or
 * configuration mistakes, and internally by providers (then converted to issues).
 *
 * @public
 */
export class PragmaError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly PragmaIssue[];
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { issues?: readonly PragmaIssue[]; cause?: unknown; retryable?: boolean },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PragmaError';
    this.code = code;
    this.issues = options?.issues ?? [];
    this.retryable = options?.retryable ?? RETRYABLE_CODES.has(code);
    Object.defineProperty(this, PRAGMA_ERROR_BRAND, { value: true });
  }

  /** Convert to a serializable issue. Never includes the stack or cause. */
  toIssue(): PragmaIssue {
    const first = this.issues[0];
    if (this.issues.length === 1 && first?.code === this.code) return first;
    return createIssue(this.code, {
      message: this.message,
      messageKey: `error.${this.code}`,
      retryable: this.retryable,
      ...(this.issues.length > 0 ? { details: { issues: this.issues } } : {}),
    });
  }

  toJSON(): {
    name: string;
    code: ErrorCode;
    message: string;
    retryable: boolean;
    issues: readonly PragmaIssue[];
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      issues: this.issues,
    };
  }
}

/** Invalid schema or configuration. Thrown synchronously at construction time. @public */
export class PragmaConfigError extends PragmaError {
  constructor(
    code: 'SCHEMA_ERROR' | 'CONFIG_ERROR',
    message: string,
    options?: { issues?: readonly PragmaIssue[]; cause?: unknown },
  ) {
    super(code, message, { ...options, retryable: false });
    this.name = 'PragmaConfigError';
  }
}

/** A payload failed validation. @public */
export class PragmaValidationError extends PragmaError {
  constructor(message: string, issues: readonly PragmaIssue[], options?: { cause?: unknown }) {
    const code = issues[0]?.code ?? 'VALIDATION_ERROR';
    super(code, message, { ...options, issues, retryable: false });
    this.name = 'PragmaValidationError';
  }
}

/** Failure talking to, or understanding, a language model. @public */
export class PragmaModelError extends PragmaError {
  /** HTTP status returned by the upstream provider, when known. */
  readonly status: number | undefined;
  /** Delay suggested by the upstream (`Retry-After`), in milliseconds. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: 'MODEL_ERROR' | 'MODEL_OUTPUT_INVALID' | 'RATE_LIMITED' | 'UNAUTHORIZED',
    message: string,
    options?: {
      cause?: unknown;
      status?: number;
      retryAfterMs?: number;
      retryable?: boolean;
      issues?: readonly PragmaIssue[];
    },
  ) {
    super(code, message, options);
    this.name = 'PragmaModelError';
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** Failure between the client SDK and the Pragma server handler. @public */
export class PragmaTransportError extends PragmaError {
  readonly status: number | undefined;
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      status?: number;
      retryable?: boolean;
      issues?: readonly PragmaIssue[];
      code?: ErrorCode;
    },
  ) {
    super(options?.code ?? 'TRANSPORT_ERROR', message, options);
    this.name = 'PragmaTransportError';
    this.status = options?.status;
  }
}

/** Deadline exceeded or caller cancelled. @public */
export class PragmaTimeoutError extends PragmaError {
  constructor(message: string, options?: { cause?: unknown; aborted?: boolean }) {
    super(options?.aborted === true ? 'ABORTED' : 'TIMEOUT', message, {
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
      retryable: options?.aborted !== true,
    });
    this.name = 'PragmaTimeoutError';
  }
}

/**
 * Type guard that works across package copies / realms (uses a global symbol brand
 * rather than `instanceof`).
 *
 * @public
 */
export function isPragmaError(value: unknown): value is PragmaError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[PRAGMA_ERROR_BRAND] === true
  );
}

/**
 * Convert any thrown value into a safe {@link PragmaIssue}. Unknown errors become
 * `INTERNAL_ERROR` with a generic message; the original message is *not* leaked.
 *
 * @public
 */
export function toIssue(error: unknown): PragmaIssue {
  if (isPragmaError(error)) return error.toIssue();
  if (isAbortError(error)) {
    return createIssue('ABORTED', {
      message: 'The operation was cancelled.',
      messageKey: 'error.ABORTED',
    });
  }
  return createIssue('INTERNAL_ERROR', {
    message: 'An unexpected internal error occurred.',
    messageKey: 'error.INTERNAL_ERROR',
  });
}

/** True for DOMException AbortError / TimeoutError produced by AbortSignal. @public */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
