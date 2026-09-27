import { isDateTimeOperand, parsePlainDate } from '../dates/calendar.js';
import { createIssue, type PragmaIssue } from '../errors/errors.js';
import { DURATION_UNITS, OPERATOR_ARITY, type Operator } from '../operators/catalog.js';
import type { FilterValue, RelativeDuration, ScalarValue } from '../protocol/types.js';
import { LIMITS } from '../protocol/zod.js';
import type { ResolvedField } from '../schema/types.js';
import { normalizeTerm } from '../util/text.js';

/** Outcome of coercing a value against a field. @internal */
export type CoerceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: PragmaIssue };

const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function invalid(field: ResolvedField, path: readonly (string | number)[], reason: string, messageKey: string, details?: Record<string, unknown>): CoerceResult<never> {
  return {
    ok: false,
    issue: createIssue('INVALID_VALUE', {
      message: `Invalid value for "${field.label}": ${reason}`,
      messageKey,
      params: { field: field.label, reason },
      field: field.id,
      path,
      ...(details ? { details } : {}),
    }),
  };
}

/**
 * Coerce one scalar to the canonical representation for the field type.
 * - number: finite numbers; numeric strings (with `,`/`_` group separators) are accepted.
 * - boolean: `true/false`, `"true"/"false"/"yes"/"no"`, `1/0`.
 * - enum: canonical value, matched case-insensitively against value, label and aliases.
 * - date: `YYYY-MM-DD`; datetime: plain date, local datetime or ISO instant.
 *
 * @public
 */
export function coerceScalar(field: ResolvedField, raw: unknown, path: readonly (string | number)[] = []): CoerceResult<ScalarValue> {
  switch (field.type) {
    case 'string': {
      if (typeof raw === 'string') {
        if (raw.length === 0) return invalid(field, path, 'empty text is not a valid value (use isEmpty instead)', 'value.emptyString');
        return { ok: true, value: raw };
      }
      if (typeof raw === 'number' && Number.isFinite(raw)) return { ok: true, value: String(raw) };
      return invalid(field, path, 'expected text', 'value.expectedString');
    }
    case 'number': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { ok: true, value: raw } : invalid(field, path, 'expected a finite number', 'value.expectedNumber');
      }
      if (typeof raw === 'string') {
        const cleaned = raw.trim().replace(/[,_\s]/g, '');
        if (NUMERIC.test(cleaned)) {
          const n = Number(cleaned);
          if (Number.isFinite(n)) return { ok: true, value: n };
        }
      }
      return invalid(field, path, 'expected a number', 'value.expectedNumber');
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 1 || raw === 0) return { ok: true, value: raw === 1 };
      if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (v === 'true' || v === 'yes') return { ok: true, value: true };
        if (v === 'false' || v === 'no') return { ok: true, value: false };
      }
      return invalid(field, path, 'expected true or false', 'value.expectedBoolean');
    }
    case 'enum': {
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        return invalid(field, path, 'expected one of the allowed values', 'value.expectedEnum', { allowed: field.values.map((v) => v.value) });
      }
      const text = String(raw);
      const exact = field.values.find((v) => v.value === text);
      if (exact) return { ok: true, value: exact.value };
      const match = matchEnumValue(field, text);
      if (match !== undefined) return { ok: true, value: match };
      return invalid(field, path, `"${text}" is not an allowed value`, 'value.notInEnum', { allowed: field.values.map((v) => v.value), received: text });
    }
    case 'date': {
      if (typeof raw === 'string' && parsePlainDate(raw.trim())) return { ok: true, value: raw.trim() };
      return invalid(field, path, 'expected a date in YYYY-MM-DD format', 'value.expectedDate');
    }
    case 'datetime': {
      if (typeof raw === 'string' && isDateTimeOperand(raw.trim())) return { ok: true, value: raw.trim() };
      return invalid(field, path, 'expected an ISO-8601 date or date-time', 'value.expectedDateTime');
    }
  }
}

/** Case-insensitive lookup of an enum value by value, label or alias. @public */
export function matchEnumValue(field: ResolvedField, text: string): string | undefined {
  const needle = normalizeTerm(text);
  if (needle === '') return undefined;
  for (const ev of field.values) {
    const terms = [ev.value, ev.label, ...(ev.aliases ?? [])];
    if (terms.some((t) => t !== undefined && normalizeTerm(t) === needle)) return ev.value;
  }
  return undefined;
}

/**
 * Check the value shape required by the operator and coerce its contents.
 *
 * @public
 */
export function coerceOperatorValue(
  field: ResolvedField,
  operator: Operator,
  raw: FilterValue | undefined,
  path: readonly (string | number)[] = [],
): CoerceResult<FilterValue | undefined> {
  const arity = OPERATOR_ARITY[operator];
  const valuePath = [...path, 'value'];
  switch (arity) {
    case 'none':
      return raw === undefined ? { ok: true, value: undefined } : invalid(field, valuePath, `operator "${operator}" takes no value`, 'value.unexpected');
    case 'single': {
      if (raw === undefined) return invalid(field, valuePath, `operator "${operator}" requires a value`, 'value.missing');
      if (Array.isArray(raw) || typeof raw === 'object') {
        return invalid(field, valuePath, `operator "${operator}" requires a single value`, 'value.expectedSingle');
      }
      return coerceScalar(field, raw, valuePath);
    }
    case 'range': {
      if (!Array.isArray(raw) || raw.length !== 2) {
        return invalid(field, valuePath, `operator "${operator}" requires exactly two values [from, to]`, 'value.expectedRange');
      }
      const from = coerceScalar(field, raw[0], [...valuePath, 0]);
      if (!from.ok) return from;
      const to = coerceScalar(field, raw[1], [...valuePath, 1]);
      if (!to.ok) return to;
      return { ok: true, value: [from.value, to.value] as const };
    }
    case 'list': {
      if (!Array.isArray(raw) || raw.length === 0) {
        return invalid(field, valuePath, `operator "${operator}" requires a non-empty list`, 'value.expectedList');
      }
      if (raw.length > LIMITS.maxListLength) {
        return invalid(field, valuePath, `at most ${LIMITS.maxListLength} values are allowed`, 'value.listTooLong');
      }
      const out: ScalarValue[] = [];
      for (let i = 0; i < raw.length; i++) {
        const item = coerceScalar(field, (raw as readonly unknown[])[i], [...valuePath, i]);
        if (!item.ok) return item;
        out.push(item.value);
      }
      return { ok: true, value: out };
    }
    case 'duration': {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        return invalid(field, valuePath, `operator "${operator}" requires a duration like { amount: 7, unit: "day" }`, 'value.expectedDuration');
      }
      const { amount, unit } = raw as Partial<RelativeDuration>;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > LIMITS.maxDurationAmount) {
        return invalid(field, valuePath, 'duration amount must be a positive whole number', 'value.durationAmount');
      }
      if (unit === undefined || !DURATION_UNITS.includes(unit)) {
        return invalid(field, valuePath, `duration unit must be one of ${DURATION_UNITS.join(', ')}`, 'value.durationUnit');
      }
      if (field.type === 'date' && (unit === 'minute' || unit === 'hour')) {
        return invalid(field, valuePath, `"${unit}" is too fine-grained for a date field`, 'value.durationUnitForDate');
      }
      return { ok: true, value: { amount, unit } };
    }
  }
}
