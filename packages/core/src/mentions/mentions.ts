import { findFieldByTerm, fieldTerms } from '../schema/lookup.js';
import type { FieldType, ResolvedField, ResolvedSchema } from '../schema/types.js';
import { normalizeTerm } from '../util/text.js';

/** An `@reference` found in an instruction. @public */
export interface MentionToken {
  /** Index of the `@`. */
  readonly start: number;
  /** Index just past the mention. */
  readonly end: number;
  /** Exact source text including `@` (and quotes). */
  readonly raw: string;
  /** Reference text without `@` and quotes. */
  readonly text: string;
}

const MENTION = /@(?:"([^"\n]{1,100})"|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*))/g;

/**
 * Find `@field`, `@resource.field` and `@"Quoted Label"` references.
 * An `@` preceded by a word character (as in an email address) is ignored.
 *
 * @public
 */
export function findMentions(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  for (const match of text.matchAll(MENTION)) {
    const start = match.index;
    if (start > 0 && /[\w.]/.test(text[start - 1] ?? '')) continue;
    out.push({ start, end: start + match[0].length, raw: match[0], text: match[1] ?? match[2] ?? '' });
  }
  return out;
}

/** @public */
export type MentionResolution =
  | { readonly kind: 'field'; readonly field: ResolvedField }
  | { readonly kind: 'resource' }
  | { readonly kind: 'unknownResource'; readonly resource: string }
  | { readonly kind: 'unknown' };

/**
 * Resolve a mention against the schema.
 *
 * Order: the resource itself → `resource.field` (prefix stripped only on an exact
 * resource match) → full id/label/alias (so dotted ids like `address.city` work)
 * → an unmatched `x.y` is reported as an unknown resource.
 *
 * @public
 */
export function resolveMention(schema: ResolvedSchema, text: string): MentionResolution {
  if (isResourceTerm(schema, text)) return { kind: 'resource' };
  const dot = text.indexOf('.');
  if (dot > 0) {
    const prefix = text.slice(0, dot);
    const rest = text.slice(dot + 1);
    const direct = findFieldByTerm(schema, text);
    if (direct) return { kind: 'field', field: direct };
    if (isResourceTerm(schema, prefix)) {
      const field = findFieldByTerm(schema, rest);
      return field ? { kind: 'field', field } : { kind: 'unknown' };
    }
    return { kind: 'unknownResource', resource: prefix };
  }
  const field = findFieldByTerm(schema, text);
  return field ? { kind: 'field', field } : { kind: 'unknown' };
}

function isResourceTerm(schema: ResolvedSchema, text: string): boolean {
  const needle = normalizeTerm(text);
  return needle === normalizeTerm(schema.resource) || needle === normalizeTerm(schema.label) || schema.aliases.some((a) => normalizeTerm(a) === needle);
}

/**
 * If the caret is inside an `@mention` being typed, return where it starts and
 * the partial text. Used to drive autocomplete.
 *
 * @public
 */
export function getActiveMention(text: string, caret: number): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && /[\w.]/.test(before[at - 1] ?? '')) return null;
  const partial = before.slice(at + 1);
  if (partial.startsWith('"')) return partial.slice(1).includes('"') ? null : { start: at, query: partial.slice(1) };
  if (!/^[A-Za-z0-9_.]*$/.test(partial)) return null;
  return { start: at, query: partial };
}

/** @public */
export interface MentionSuggestion {
  readonly kind: 'field' | 'resource';
  readonly id: string;
  readonly label: string;
  readonly type?: FieldType;
  readonly description?: string;
  /** Text to insert, including `@`. */
  readonly insertText: string;
  /** Alias that produced the match, when the match was not on id/label. */
  readonly matchedAlias?: string;
}

/** @public */
export interface SuggestOptions {
  /** Default 8. */
  readonly limit?: number;
  /** Only suggest fields satisfying this predicate. */
  readonly predicate?: (field: ResolvedField) => boolean;
}

/**
 * Rank visible fields (and the resource) for a partial mention. Pure and
 * synchronous: no network, designed to run on every keystroke.
 *
 * Ranking: exact > prefix of id/label > prefix of alias or of a word in the
 * label > substring > subsequence; ties keep schema order.
 *
 * @public
 */
export function suggestMentions(schema: ResolvedSchema, query: string, options: SuggestOptions = {}): MentionSuggestion[] {
  const limit = options.limit ?? 8;
  let q = query;
  const resourcePrefix = `${schema.resource}.`;
  if (q.toLowerCase().startsWith(resourcePrefix.toLowerCase())) q = q.slice(resourcePrefix.length);
  const needle = normalizeTerm(q);
  const compact = needle.replace(/ /g, '');

  const ranked: { suggestion: MentionSuggestion; rank: number; order: number }[] = [];
  const fields = [...schema.fieldsById.values()].filter((f) => options.predicate?.(f) ?? true);

  if (needle === '' || normalizeTerm(schema.resource).startsWith(needle)) {
    if (!q.includes('.') && query === q) {
      ranked.push({
        suggestion: { kind: 'resource', id: schema.resource, label: schema.label, insertText: `@${schema.resource}` },
        rank: needle === '' ? 0 : 1,
        order: -1,
      });
    }
  }

  fields.forEach((field, order) => {
    const base = { kind: 'field' as const, id: field.id, label: field.label, type: field.type, insertText: `@${field.id}`, ...(field.description ? { description: field.description } : {}) };
    if (needle === '') {
      ranked.push({ suggestion: base, rank: 1, order });
      return;
    }
    const [idTerm = '', labelTerm = '', ...aliasTerms] = fieldTerms(field);
    let rank = Number.POSITIVE_INFINITY;
    let alias: string | undefined;
    const consider = (r: number, a?: string): void => {
      if (r < rank) {
        rank = r;
        alias = a;
      }
    };
    if (idTerm === needle || labelTerm === needle) consider(0);
    if (idTerm.startsWith(needle) || labelTerm.startsWith(needle) || idTerm.replace(/ /g, '').startsWith(compact)) consider(1);
    aliasTerms.forEach((t, i) => {
      const alias = field.aliases[i];
      if (t === needle) consider(1, alias);
      else if (t.startsWith(needle) || t.split(' ').some((w) => w.startsWith(needle))) consider(2, alias);
      else if (t.includes(needle)) consider(3, alias);
    });
    if (labelTerm.split(' ').some((w) => w.startsWith(needle))) consider(2);
    if (idTerm.includes(needle) || labelTerm.includes(needle)) consider(3);
    if (isSubsequence(compact, idTerm.replace(/ /g, ''))) consider(4);
    if (rank !== Number.POSITIVE_INFINITY) {
      ranked.push({ suggestion: alias === undefined ? base : { ...base, matchedAlias: alias }, rank, order });
    }
  });

  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.suggestion);
}

function isSubsequence(needle: string, hay: string): boolean {
  if (needle === '') return true;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}
