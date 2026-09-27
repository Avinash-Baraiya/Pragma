import { createIssue, PragmaConfigError, type PragmaIssue } from '../errors/errors.js';
import { stableStringify, sha256 } from '../hash/sha256.js';
import { OPERATORS_BY_TYPE, type Operator } from '../operators/catalog.js';
import { parseTableSchema } from '../protocol/parse.js';
import { normalizeTerm } from '../util/text.js';
import {
  type FieldDef,
  type FieldFormat,
  type FieldType,
  type ResolvedField,
  type ResolvedSchema,
  type TableSchema,
} from './types.js';

const RESOURCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const FORMAT_BASE_TYPE: Readonly<Record<FieldFormat, FieldType>> = {
  currency: 'number',
  percent: 'number',
  duration: 'number',
  rating: 'number',
  email: 'string',
  url: 'string',
  phone: 'string',
};

export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_MAX_PAGE_SIZE = 500;
export const DEFAULT_MAX_SORTS = 5;

/**
 * Validate a developer-supplied schema, apply defaults and build lookup indexes.
 *
 * Throws {@link PragmaConfigError} (`SCHEMA_ERROR`) listing *every* problem found,
 * so misconfiguration is caught at startup rather than at query time.
 *
 * @public
 */
export function defineSchema(input: TableSchema): ResolvedSchema {
  const parsed = parseTableSchema(input);
  if (!parsed.success) throw schemaError(parsed.issues);
  const schema = parsed.data;
  const issues: PragmaIssue[] = [];
  const push = (
    message: string,
    path: (string | number)[],
    messageKey = 'schema.invalid',
  ): void => {
    issues.push(createIssue('SCHEMA_ERROR', { message, messageKey, path }));
  };

  if (!RESOURCE_PATTERN.test(schema.resource)) {
    push(`Resource "${schema.resource}" must match ${RESOURCE_PATTERN.source}.`, ['resource']);
  }

  const seenIds = new Set<string>();
  // term → field id that owns it, used to detect ambiguous names across fields.
  const termOwner = new Map<string, string>();
  const claimTerm = (term: string, fieldId: string, path: (string | number)[]): void => {
    const normalized = normalizeTerm(term);
    if (normalized === '') return;
    const owner = termOwner.get(normalized);
    if (owner !== undefined && owner !== fieldId) {
      push(
        `Name "${term}" is used by both "${owner}" and "${fieldId}"; names and aliases must be unique across fields.`,
        path,
        'schema.nameCollision',
      );
      return;
    }
    termOwner.set(normalized, fieldId);
  };

  const resolvedFields: ResolvedField[] = [];

  schema.fields.forEach((field, index) => {
    const path = ['fields', index];
    if (!FIELD_ID_PATTERN.test(field.id)) {
      push(`Field id "${field.id}" must match ${FIELD_ID_PATTERN.source}.`, [...path, 'id']);
    }
    if (seenIds.has(field.id))
      push(`Duplicate field id "${field.id}".`, [...path, 'id'], 'schema.duplicateField');
    seenIds.add(field.id);

    claimTerm(field.id, field.id, [...path, 'id']);
    claimTerm(field.label, field.id, [...path, 'label']);
    field.aliases?.forEach((alias, i) => {
      claimTerm(alias, field.id, [...path, 'aliases', i]);
    });

    validateFieldSemantics(field, path, push);
    resolvedFields.push(resolveField(field));
  });

  if (termOwner.has(normalizeTerm(schema.resource))) {
    push(
      `Resource name "${schema.resource}" collides with a field name or alias.`,
      ['resource'],
      'schema.nameCollision',
    );
  }

  const visibleById = new Map(resolvedFields.filter((f) => !f.hidden).map((f) => [f.id, f]));

  const capabilities = {
    search: schema.capabilities?.search ?? true,
    pagination: schema.capabilities?.pagination ?? ['page' as const],
    maxPageSize: schema.capabilities?.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE,
    maxSorts: schema.capabilities?.maxSorts ?? DEFAULT_MAX_SORTS,
  };
  if (new Set(capabilities.pagination).size !== capabilities.pagination.length) {
    push('capabilities.pagination contains duplicates.', ['capabilities', 'pagination']);
  }

  const pageSize =
    schema.defaults?.pageSize ?? Math.min(DEFAULT_PAGE_SIZE, capabilities.maxPageSize);
  if (pageSize > capabilities.maxPageSize) {
    push(
      `defaults.pageSize (${pageSize}) exceeds capabilities.maxPageSize (${capabilities.maxPageSize}).`,
      ['defaults', 'pageSize'],
    );
  }

  const defaultSort = schema.defaults?.sort ?? [];
  if (defaultSort.length > capabilities.maxSorts) {
    push(`defaults.sort has more entries than capabilities.maxSorts (${capabilities.maxSorts}).`, [
      'defaults',
      'sort',
    ]);
  }
  defaultSort.forEach((spec, i) => {
    const field = visibleById.get(spec.field);
    if (!field)
      push(`defaults.sort references unknown or hidden field "${spec.field}".`, [
        'defaults',
        'sort',
        i,
        'field',
      ]);
    else if (!field.sortable)
      push(`defaults.sort references non-sortable field "${spec.field}".`, [
        'defaults',
        'sort',
        i,
        'field',
      ]);
  });

  const recencyField = schema.defaults?.recencyField;
  if (recencyField !== undefined) {
    const field = visibleById.get(recencyField);
    if (!field) {
      push(`defaults.recencyField references unknown or hidden field "${recencyField}".`, [
        'defaults',
        'recencyField',
      ]);
    } else if (field.type !== 'date' && field.type !== 'datetime') {
      push(`defaults.recencyField "${recencyField}" must be a date or datetime field.`, [
        'defaults',
        'recencyField',
      ]);
    } else if (!field.sortable) {
      push(`defaults.recencyField "${recencyField}" must be sortable.`, [
        'defaults',
        'recencyField',
      ]);
    }
  }

  if (visibleById.size === 0)
    push('Schema must declare at least one visible (non-hidden) field.', ['fields']);

  if (issues.length > 0) throw schemaError(issues);

  const resolved: ResolvedSchema = {
    schemaVersion: '1',
    resource: schema.resource,
    label: schema.label ?? schema.resource,
    aliases: schema.aliases ?? [],
    description: schema.description,
    fields: resolvedFields,
    defaults: { pageSize, sort: defaultSort, recencyField },
    capabilities,
    hash: sha256(stableStringify(schema)),
    fieldsById: visibleById,
    source: schema,
  };
  return deepFreeze(resolved);
}

function validateFieldSemantics(
  field: FieldDef,
  path: (string | number)[],
  push: (message: string, path: (string | number)[], key?: string) => void,
): void {
  const typeOperators = OPERATORS_BY_TYPE[field.type];

  if (field.type === 'enum') {
    if (!field.values || field.values.length === 0) {
      push(`Enum field "${field.id}" must declare at least one value.`, [...path, 'values']);
    } else {
      const seen = new Map<string, string>();
      field.values.forEach((ev, i) => {
        for (const term of [ev.value, ev.label, ...(ev.aliases ?? [])]) {
          if (term === undefined) continue;
          const normalized = normalizeTerm(term);
          const owner = seen.get(normalized);
          if (owner !== undefined && owner !== ev.value) {
            push(
              `Enum field "${field.id}": "${term}" matches both "${owner}" and "${ev.value}".`,
              [...path, 'values', i],
              'schema.nameCollision',
            );
          }
          seen.set(normalized, ev.value);
        }
      });
    }
  } else if (field.values !== undefined) {
    push(`"values" is only allowed on enum fields (field "${field.id}" is ${field.type}).`, [
      ...path,
      'values',
    ]);
  }

  if (field.format !== undefined && FORMAT_BASE_TYPE[field.format] !== field.type) {
    push(
      `Format "${field.format}" requires type "${FORMAT_BASE_TYPE[field.format]}" (field "${field.id}" is ${field.type}).`,
      [...path, 'format'],
    );
  }
  if (field.currency !== undefined && field.format !== 'currency') {
    push(`"currency" requires format "currency" (field "${field.id}").`, [...path, 'currency']);
  }
  if (field.percentScale !== undefined && field.format !== 'percent') {
    push(`"percentScale" requires format "percent" (field "${field.id}").`, [
      ...path,
      'percentScale',
    ]);
  }
  if (field.searchable === true && field.type !== 'string' && field.type !== 'enum') {
    push(`Only string and enum fields can be searchable (field "${field.id}" is ${field.type}).`, [
      ...path,
      'searchable',
    ]);
  }
  if (field.operators !== undefined) {
    if (field.operators.length === 0 && field.filterable !== false) {
      push(`Field "${field.id}" declares an empty operator list; set filterable: false instead.`, [
        ...path,
        'operators',
      ]);
    }
    field.operators.forEach((op, i) => {
      if (!typeOperators.includes(op)) {
        push(`Operator "${op}" is not valid for ${field.type} field "${field.id}".`, [
          ...path,
          'operators',
          i,
        ]);
      }
    });
  }
}

function resolveField(field: FieldDef): ResolvedField {
  const operators: readonly Operator[] = field.operators ?? OPERATORS_BY_TYPE[field.type];
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    aliases: field.aliases ?? [],
    description: field.description,
    format: field.format,
    currency: field.currency,
    percentScale: field.percentScale ?? 'whole',
    values: field.values ?? [],
    operators,
    filterable: field.filterable ?? true,
    sortable: field.sortable ?? true,
    searchable: field.searchable ?? field.type === 'string',
    nullable: field.nullable ?? true,
    hidden: field.hidden ?? false,
  };
}

function schemaError(issues: readonly PragmaIssue[]): PragmaConfigError {
  const summary = issues
    .slice(0, 5)
    .map((i) => `  - ${i.message}`)
    .join('\n');
  const more = issues.length > 5 ? `\n  ...and ${issues.length - 5} more` : '';
  return new PragmaConfigError(
    'SCHEMA_ERROR',
    `Invalid table schema (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${summary}${more}`,
    {
      issues,
    },
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (value instanceof Map) {
    for (const v of value.values()) deepFreeze(v);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/** Visible fields only, in declaration order. @public */
export function visibleFields(schema: ResolvedSchema): readonly ResolvedField[] {
  return schema.fields.filter((f) => !f.hidden);
}

/** Look up a visible field by id; hidden and unknown fields both return `undefined`. @public */
export function getField(schema: ResolvedSchema, id: string): ResolvedField | undefined {
  return schema.fieldsById.get(id);
}
