import type { z } from 'zod';
import { createIssue, type PragmaIssue } from '../errors/errors.js';
import type { TableSchema } from '../schema/types.js';
import { PROTOCOL_VERSION, type Mutation, type TableQuery } from './types.js';
import { mutationListSchema, tableQuerySchema, tableSchemaSchema } from './zod.js';

/** Result of parsing an untrusted payload. @public */
export type ParseResult<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly issues: readonly PragmaIssue[] };

const MAX_REPORTED_ISSUES = 20;

/** Convert Zod issues into Pragma issues (capped, no raw input echoed). @internal */
export function zodIssuesToPragma(error: z.ZodError, pathPrefix: readonly (string | number)[] = []): PragmaIssue[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = [...pathPrefix, ...issue.path.filter((p): p is string | number => typeof p !== 'symbol')];
    const where = path.length > 0 ? path.join('.') : '(root)';
    return createIssue('VALIDATION_ERROR', {
      message: `Invalid value at ${where}: ${issue.message}`,
      messageKey: 'validation.shape',
      params: { path: where, reason: issue.message },
      path,
    });
  });
}

/**
 * Check the `version` field before full parsing, so that a payload from a newer
 * major version yields a precise `UNSUPPORTED_PROTOCOL_VERSION` instead of a
 * generic shape error.
 */
function checkVersion(input: unknown): PragmaIssue | undefined {
  if (typeof input !== 'object' || input === null || !('version' in input)) return undefined;
  const version = (input).version;
  if (typeof version !== 'string') return undefined;
  const [major] = version.split('.');
  const [supportedMajor] = PROTOCOL_VERSION.split('.');
  if (major !== supportedMajor) {
    return createIssue('UNSUPPORTED_PROTOCOL_VERSION', {
      message: `Protocol version ${version} is not supported; this library supports ${PROTOCOL_VERSION}.`,
      messageKey: 'protocol.unsupportedVersion',
      params: { version, supported: PROTOCOL_VERSION },
      path: ['version'],
    });
  }
  return undefined;
}

/**
 * Structurally validate an untrusted TableQuery. Minor versions of the same major
 * (e.g. a future `1.1`) are rejected by shape if they carry unknown properties.
 *
 * @public
 */
export function parseTableQuery(input: unknown): ParseResult<TableQuery> {
  const versionIssue = checkVersion(input);
  if (versionIssue) return { success: false, issues: [versionIssue] };
  const result = tableQuerySchema.safeParse(input);
  if (!result.success) return { success: false, issues: zodIssuesToPragma(result.error) };
  // Shape is identical to TableQuery; Zod widens optional props with `| undefined`.
  return { success: true, data: result.data as TableQuery };
}

/** Structurally validate an untrusted mutation list (e.g. model output). @public */
export function parseMutations(input: unknown): ParseResult<readonly Mutation[]> {
  const result = mutationListSchema.safeParse(input);
  if (!result.success) return { success: false, issues: zodIssuesToPragma(result.error) };
  return { success: true, data: result.data as readonly Mutation[] };
}

/** Structurally validate an untrusted table schema (semantic checks happen in `defineSchema`). @public */
export function parseTableSchema(input: unknown): ParseResult<TableSchema> {
  const result = tableSchemaSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      issues: zodIssuesToPragma(result.error).map((i) => ({ ...i, code: 'SCHEMA_ERROR' as const })),
    };
  }
  return { success: true, data: result.data as TableSchema };
}
