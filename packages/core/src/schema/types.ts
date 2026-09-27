import type { Operator } from '../operators/catalog.js';
import type { PaginationType, SortSpec } from '../protocol/types.js';

/** Current schema contract version. @public */
export const SCHEMA_VERSION = '1';

/** Logical field types understood by protocol 1.0. @public */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum';

/** @public */
export const FIELD_TYPES: readonly FieldType[] = ['string', 'number', 'boolean', 'date', 'datetime', 'enum'];

/**
 * Presentation / semantic hint layered on top of a base type. Formats help the
 * interpreter (e.g. "5 lakh" on a currency field) but never change comparison rules.
 *
 * @public
 */
export type FieldFormat = 'currency' | 'percent' | 'email' | 'url' | 'phone' | 'duration' | 'rating';

/** @public */
export const FIELD_FORMATS: readonly FieldFormat[] = ['currency', 'percent', 'email', 'url', 'phone', 'duration', 'rating'];

/**
 * One allowed value of an `enum` field. Synonyms users might type (e.g. "completed"
 * for "approved") belong in `aliases`; the engine never invents mappings.
 *
 * @public
 */
export interface EnumValue {
  readonly value: string;
  readonly label?: string;
  readonly aliases?: readonly string[];
}

/** @public */
export interface FieldDef {
  /** Stable key used in queries. Letters, digits and `_`, dot-separated segments allowed (`address.city`). */
  readonly id: string;
  /** Human-readable name shown in UI and used for matching. */
  readonly label: string;
  readonly type: FieldType;
  /** Alternative names users may use ("signup date", "joined"). */
  readonly aliases?: readonly string[];
  /** Semantic description sent to the language model. Never contains data. */
  readonly description?: string;
  readonly format?: FieldFormat;
  /** ISO 4217 code for `format: 'currency'`. */
  readonly currency?: string;
  /** How percentages are stored: `fraction` (0.2) or `whole` (20). Default `whole`. */
  readonly percentScale?: 'fraction' | 'whole';
  /** Allowed values. Required for, and only allowed on, `enum` fields. */
  readonly values?: readonly EnumValue[];
  /** Narrow the operators allowed on this field (must be a subset of the type's operators). */
  readonly operators?: readonly Operator[];
  /** Default `true`. */
  readonly filterable?: boolean;
  /** Default `true`. */
  readonly sortable?: boolean;
  /** Included in global search. Default `true` for `string` fields, `false` otherwise. */
  readonly searchable?: boolean;
  /** Informational: whether the field can hold null. Default `true`. */
  readonly nullable?: boolean;
  /**
   * Hidden fields are never sent to a model, never suggested, and rejected by the
   * validator with the same error as a non-existent field (existence is not leaked).
   */
  readonly hidden?: boolean;
}

/** @public */
export interface SchemaDefaults {
  /** Default 20. */
  readonly pageSize?: number;
  /** Sort applied on reset. Default `[]`. */
  readonly sort?: readonly SortSpec[];
  /** Date/datetime field used for "newest"/"oldest"/"recent" when several date fields exist. */
  readonly recencyField?: string;
}

/** @public */
export interface SchemaCapabilities {
  /** Whether global search is supported. Default `true`. */
  readonly search?: boolean;
  /** Supported pagination styles; the first is the default. Default `['page']`. */
  readonly pagination?: readonly PaginationType[];
  /** Default 500. */
  readonly maxPageSize?: number;
  /** Default 5. */
  readonly maxSorts?: number;
}

/**
 * Developer-supplied description of one logical table.
 *
 * @public
 */
export interface TableSchema {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** Resource identifier, e.g. `users`. Used for `@users` mentions and server routing. */
  readonly resource: string;
  readonly label?: string;
  readonly aliases?: readonly string[];
  readonly description?: string;
  readonly fields: readonly FieldDef[];
  readonly defaults?: SchemaDefaults;
  readonly capabilities?: SchemaCapabilities;
}

/**
 * A field with every default applied. Produced by `defineSchema`.
 *
 * @public
 */
export interface ResolvedField {
  readonly id: string;
  readonly label: string;
  readonly type: FieldType;
  readonly aliases: readonly string[];
  readonly description: string | undefined;
  readonly format: FieldFormat | undefined;
  readonly currency: string | undefined;
  readonly percentScale: 'fraction' | 'whole';
  readonly values: readonly EnumValue[];
  readonly operators: readonly Operator[];
  readonly filterable: boolean;
  readonly sortable: boolean;
  readonly searchable: boolean;
  readonly nullable: boolean;
  readonly hidden: boolean;
}

/**
 * A validated, frozen schema with all defaults applied and lookup indexes built.
 * Create with `defineSchema`. Treat as immutable.
 *
 * @public
 */
export interface ResolvedSchema {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly resource: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description: string | undefined;
  /** All fields, including hidden ones, in declaration order. */
  readonly fields: readonly ResolvedField[];
  readonly defaults: {
    readonly pageSize: number;
    readonly sort: readonly SortSpec[];
    readonly recencyField: string | undefined;
  };
  readonly capabilities: {
    readonly search: boolean;
    readonly pagination: readonly PaginationType[];
    readonly maxPageSize: number;
    readonly maxSorts: number;
  };
  /** Stable SHA-256 of the canonical schema (hex). Changes whenever the schema changes. */
  readonly hash: string;
  /** Visible (non-hidden) field lookup by id. */
  readonly fieldsById: ReadonlyMap<string, ResolvedField>;
  /** The original input, kept for serialization (e.g. sending to a server). */
  readonly source: TableSchema;
}
