import { boundedLevenshtein, normalizeTerm } from '../util/text.js';
import type { ResolvedField, ResolvedSchema } from './types.js';

/**
 * Resolve a human term (id, label or alias, any casing/separator style) to a
 * visible field. Hidden fields are never returned.
 *
 * @public
 */
export function findFieldByTerm(schema: ResolvedSchema, term: string): ResolvedField | undefined {
  const direct = schema.fieldsById.get(term);
  if (direct) return direct;
  const needle = normalizeTerm(term);
  if (needle === '') return undefined;
  for (const field of schema.fieldsById.values()) {
    if (fieldTerms(field).includes(needle)) return field;
  }
  return undefined;
}

/** Normalized id, label and aliases of a field. @public */
export function fieldTerms(field: ResolvedField): readonly string[] {
  return [field.id, field.label, ...field.aliases].map(normalizeTerm);
}

/** @public */
export interface FieldSuggestionOptions {
  readonly predicate?: (field: ResolvedField) => boolean;
  readonly limit?: number;
}

/**
 * Suggest visible fields for a term the user typed that did not match exactly:
 * substring matches first, then small edit distances. Falls back to the first
 * matching fields when nothing is close, so an error always offers something.
 *
 * @public
 */
export function suggestFields(
  schema: ResolvedSchema,
  term: string,
  options: FieldSuggestionOptions = {},
): readonly ResolvedField[] {
  const limit = options.limit ?? 3;
  const candidates = [...schema.fieldsById.values()].filter((f) => options.predicate?.(f) ?? true);
  const needle = normalizeTerm(term);
  const scored: { field: ResolvedField; score: number }[] = [];
  for (const field of candidates) {
    let best = Number.POSITIVE_INFINITY;
    for (const t of fieldTerms(field)) {
      if (needle !== '' && (t.includes(needle) || needle.includes(t))) best = Math.min(best, 0);
      else best = Math.min(best, boundedLevenshtein(needle, t, 3));
    }
    if (best <= 3) scored.push({ field, score: best });
  }
  scored.sort((a, b) => a.score - b.score);
  const result = scored.slice(0, limit).map((s) => s.field);
  return result.length > 0 ? result : candidates.slice(0, limit);
}
