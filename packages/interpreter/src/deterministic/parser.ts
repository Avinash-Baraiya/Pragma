import {
  normalizeTerm,
  OPERATOR_ARITY,
  resolveMention,
  type Ambiguity,
  type AmbiguityOption,
  type FieldType,
  type FilterCondition,
  type FilterNode,
  type IdGenerator,
  type Mutation,
  type Operator,
  type ResolvedField,
  type ResolvedSchema,
  type ScalarValue,
  type SortSpec,
  type TableQuery,
} from '@pragma/core';
import type { Proposal } from '../types.js';
import { tokenize, type Token } from './lexer.js';
import { parseBoolean, parseDate, parseDuration, parseNumber, type Parsed } from './values.js';

/** Inputs to the deterministic parser. @public */
export interface ParseContext {
  readonly schema: ResolvedSchema;
  readonly state: TableQuery;
  /** Current instant (epoch ms), used to complete dates without a year. */
  readonly now: number;
  readonly timezone: string;
  readonly ids: IdGenerator;
}

/** @public */
export interface DeterministicResult {
  /** True only when every meaningful token was understood and something was produced. */
  readonly covered: boolean;
  readonly proposal: Proposal;
  /** Tokens the parser could not account for (diagnostics only). */
  readonly unconsumed: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

const FILLER = new Set(
  (
    'show me list display get give fetch find all the a an of please pls plz kindly only just records record rows row entries entry ' +
    'items item results result data those these that which who whose where with having have has are is was were be been filter filtered ' +
    "filtering by for to can could you i we want need see let lets let’s let's and also then but now ok okay table view in on them ones " +
    'one everyone anyone any some each every thanks thank hey hi showing shown return select pick whom'
  ).split(' '),
);

/**
 * Words an unquoted text value never starts with: "email is from gmail" or
 * "city is near Pune" carry meaning the grammar does not model, so such
 * instructions go to the model instead of becoming `email = "from gmail"`.
 */
const VALUE_START_BLOCKLIST = new Set(
  'from of in at on with by near around about like than to for into within without under over above below between after before since until'.split(
    ' ',
  ),
);

/** Words that end an unquoted text value. */
const BOUNDARY = new Set(
  'and or but sort sorted order ordered then page per show with where who whose that having search limit rows results'.split(
    ' ',
  ),
);

interface OpPhrase {
  readonly words: readonly string[];
  readonly op: Operator;
  readonly types?: readonly FieldType[];
}

const DATE_TYPES: readonly FieldType[] = ['date', 'datetime'];
const NUM_OR_DATE: readonly FieldType[] = ['number', 'date', 'datetime'];

const phrase = (p: string, op: Operator, types?: readonly FieldType[]): OpPhrase => ({
  words: p.split(' '),
  op,
  ...(types ? { types } : {}),
});

const OP_PHRASES: readonly OpPhrase[] = [
  // null / empty (no value)
  ...[
    'is not null',
    'is not missing',
    'has a value',
    'is set',
    'exists',
    'is present',
    'is not blank',
  ].map((p) =>
    p === 'is not blank' ? phrase(p, 'isNotEmpty', ['string']) : phrase(p, 'isNotNull'),
  ),
  phrase('is not empty', 'isNotEmpty', ['string']),
  ...['is null', 'is missing', 'is unset', 'is not set', 'has no value', 'is unknown'].map((p) =>
    phrase(p, 'isNull'),
  ),
  ...['is empty', 'is blank'].map((p) => phrase(p, 'isEmpty', ['string'])),
  // ranges
  ...['is not between', 'not between'].map((p) => phrase(p, 'notBetween', NUM_OR_DATE)),
  ...['is between', 'between', 'from'].map((p) => phrase(p, 'between', NUM_OR_DATE)),
  // lists
  ...['is not one of', 'is not any of', 'is not in', 'not in', 'none of', 'not one of'].map((p) =>
    phrase(p, 'notIn'),
  ),
  ...['is one of', 'is any of', 'one of', 'any of', 'is in', 'in'].map((p) => phrase(p, 'in')),
  // text
  ...[
    'does not contain',
    "doesn't contain",
    'doesnt contain',
    'not containing',
    'not contains',
    'excludes',
    'does not include',
    "doesn't include",
  ].map((p) => phrase(p, 'notContains', ['string'])),
  ...['contains', 'containing', 'includes', 'including', 'like', 'has'].map((p) =>
    phrase(p, 'contains', ['string']),
  ),
  ...[
    'starts with',
    'starting with',
    'begins with',
    'beginning with',
    'start with',
    'begin with',
  ].map((p) => phrase(p, 'startsWith', ['string'])),
  ...['ends with', 'ending with', 'end with'].map((p) => phrase(p, 'endsWith', ['string'])),
  // comparisons
  ...[
    '>=',
    '≥',
    'is at least',
    'at least',
    'greater than or equal to',
    'is greater than or equal to',
    'no less than',
    'not less than',
    'minimum',
    'min',
  ].map((p) => phrase(p, 'gte', NUM_OR_DATE)),
  ...[
    '<=',
    '≤',
    'is at most',
    'at most',
    'less than or equal to',
    'is less than or equal to',
    'no more than',
    'not more than',
    'up to',
    'maximum',
    'max',
  ].map((p) => phrase(p, 'lte', NUM_OR_DATE)),
  ...[
    '>',
    'greater than',
    'is greater than',
    'more than',
    'is more than',
    'over',
    'above',
    'is above',
    'is over',
    'exceeds',
    'exceeding',
    'higher than',
    'is higher than',
  ].map((p) => phrase(p, 'gt', ['number'])),
  ...[
    '<',
    'less than',
    'is less than',
    'fewer than',
    'under',
    'below',
    'is below',
    'is under',
    'lower than',
    'is lower than',
  ].map((p) => phrase(p, 'lt', ['number'])),
  // dates
  ...['>', 'is before', 'before', 'earlier than', 'prior to'].map((p) =>
    p === '>' ? phrase(p, 'after', DATE_TYPES) : phrase(p, 'before', DATE_TYPES),
  ),
  ...['<', 'is after', 'after', 'later than'].map((p) =>
    p === '<' ? phrase(p, 'before', DATE_TYPES) : phrase(p, 'after', DATE_TYPES),
  ),
  ...['on or before', 'until', 'till', 'through'].map((p) => phrase(p, 'onOrBefore', DATE_TYPES)),
  ...['on or after', 'since'].map((p) => phrase(p, 'onOrAfter', DATE_TYPES)),
  ...['is on', 'on'].map((p) => phrase(p, 'eq', DATE_TYPES)),
  // relative dates
  ...['is today', 'today'].map((p) => phrase(p, 'today', DATE_TYPES)),
  ...['is yesterday', 'yesterday'].map((p) => phrase(p, 'yesterday', DATE_TYPES)),
  ...['this week', 'is this week'].map((p) => phrase(p, 'thisWeek', DATE_TYPES)),
  ...['last week', 'is last week', 'previous week'].map((p) => phrase(p, 'lastWeek', DATE_TYPES)),
  ...['this month', 'is this month'].map((p) => phrase(p, 'thisMonth', DATE_TYPES)),
  ...['last month', 'is last month', 'previous month'].map((p) =>
    phrase(p, 'lastMonth', DATE_TYPES),
  ),
  ...['this year', 'is this year'].map((p) => phrase(p, 'thisYear', DATE_TYPES)),
  ...[
    'in the last',
    'in the past',
    'within the last',
    'within the past',
    'over the last',
    'over the past',
    'during the last',
    'during the past',
    'in last',
    'in past',
    'last',
    'past',
  ].map((p) => phrase(p, 'last', DATE_TYPES)),
  ...['in the next', 'within the next', 'over the next', 'during the next', 'in next', 'next'].map(
    (p) => phrase(p, 'next', DATE_TYPES),
  ),
  // equality
  ...[
    '!=',
    '≠',
    'is not',
    "isn't",
    'isnt',
    'not equal to',
    'is not equal to',
    'does not equal',
    "doesn't equal",
    'not',
  ].map((p) => phrase(p, 'neq')),
  ...['=', '==', ':', 'is', 'equals', 'equal to', 'is equal to', 'eq'].map((p) => phrase(p, 'eq')),
].sort((a, b) => b.words.length - a.words.length);

type Direction = 'asc' | 'desc';

const DIRECTION_PHRASES: readonly { words: readonly string[]; dir: Direction }[] = [
  ...[
    'in ascending order',
    'ascending',
    'asc',
    'a to z',
    'a-z',
    'low to high',
    'lowest first',
    'smallest first',
    'increasing',
    'oldest first',
    'earliest first',
  ].map((p) => ({
    words: p.split(' '),
    dir: 'asc' as const,
  })),
  ...[
    'in descending order',
    'descending',
    'desc',
    'z to a',
    'z-a',
    'high to low',
    'highest first',
    'largest first',
    'biggest first',
    'decreasing',
    'newest first',
    'latest first',
    'most recent first',
  ].map((p) => ({ words: p.split(' '), dir: 'desc' as const })),
].sort((a, b) => b.words.length - a.words.length);

const SORT_PREFIXES = [
  'sort by',
  'sorted by',
  'order by',
  'ordered by',
  'arrange by',
  'arranged by',
  'rank by',
  'ranked by',
  'sort',
  'order',
].map((p) => p.split(' '));

const RECENCY_PHRASES: readonly { words: readonly string[]; dir: Direction }[] = [
  ...[
    'most recent first',
    'most recent',
    'newest first',
    'newest',
    'latest first',
    'latest',
    'recent first',
  ].map((p) => ({ words: p.split(' '), dir: 'desc' as const })),
  ...['oldest first', 'oldest', 'earliest first', 'earliest', 'least recent'].map((p) => ({
    words: p.split(' '),
    dir: 'asc' as const,
  })),
].sort((a, b) => b.words.length - a.words.length);

const PAGE_SIZE_NOUNS = new Set(['rows', 'results', 'records', 'items', 'entries']);
const NEGATION_PREFIXES = ['non-', 'non', 'un'];

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

interface Term {
  readonly words: readonly string[];
  readonly field: ResolvedField;
}

interface EnumTerm extends Term {
  readonly value: string;
}

interface ParsedCondition {
  readonly node: FilterNode;
  readonly length: number;
}

/**
 * Deterministic, dictionary-driven interpretation of common instructions.
 *
 * It handles explicit phrasing ("age > 25", "status is active", "sort by
 * country then age desc", "20 per page", "remove the country filter",
 * "joined in the last 7 days") without any model call. It is intentionally
 * conservative: it reports `covered: false` unless every meaningful token was
 * understood, so partially-understood instructions go to the language model
 * instead of producing a silently wrong query.
 *
 * @public
 */
export function parseDeterministic(instruction: string, ctx: ParseContext): DeterministicResult {
  return new Parser(instruction, ctx).run();
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly mutations: Mutation[] = [];
  private readonly ambiguities: Ambiguity[] = [];
  private readonly sorts: SortSpec[] = [];
  private readonly unconsumed: string[] = [];
  private readonly fieldTerms: Term[];
  private readonly enumTerms: EnumTerm[];
  private readonly resourceTerms: Set<string>;
  private readonly currentYear: number;

  constructor(
    private readonly input: string,
    private readonly ctx: ParseContext,
  ) {
    this.tokens = tokenize(input);
    const fields = [...ctx.schema.fieldsById.values()];
    this.fieldTerms = fields
      .flatMap((field) =>
        [field.id, field.label, ...field.aliases].map((t) => ({
          words: normalizeTerm(t).split(' '),
          field,
        })),
      )
      .sort((a, b) => b.words.length - a.words.length);
    this.enumTerms = fields
      .filter((f) => f.type === 'enum' && f.filterable)
      .flatMap((field) =>
        field.values.flatMap((ev) =>
          [ev.value, ...(ev.label === undefined ? [] : [ev.label]), ...(ev.aliases ?? [])].map(
            (t) => ({ words: normalizeTerm(t).split(' '), field, value: ev.value }),
          ),
        ),
      )
      .sort((a, b) => b.words.length - a.words.length);
    const resourceTerms = [ctx.schema.resource, ctx.schema.label, ...ctx.schema.aliases].map(
      normalizeTerm,
    );
    this.resourceTerms = new Set(resourceTerms.flatMap((t) => [t, singular(t)]));
    this.currentYear = yearIn(ctx.now, ctx.timezone);
  }

  run(): DeterministicResult {
    while (this.pos < this.tokens.length) {
      if (
        this.tryCommand() ||
        this.trySort() ||
        this.tryPagination() ||
        this.trySearch() ||
        this.tryRecency() ||
        this.tryFilter()
      )
        continue;
      const token = this.tokens[this.pos]!;
      if (!this.isFiller(token)) this.unconsumed.push(token.text);
      this.pos++;
    }
    if (this.sorts.length > 0) this.mutations.push({ op: 'setSort', sort: this.sorts });
    const mutations = this.applyEqualityRefinement(this.mutations);
    const produced = mutations.length > 0 || this.ambiguities.length > 0;
    return {
      covered: this.unconsumed.length === 0 && produced,
      proposal: { mutations, ambiguities: this.ambiguities },
      unconsumed: this.unconsumed,
    };
  }

  /* ------------------------------ token helpers ----------------------------- */

  private tok(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  /** Length of `words` matched at `at`, or 0. */
  private matchWords(at: number, words: readonly string[]): number {
    for (let i = 0; i < words.length; i++) {
      const t = this.tokens[at + i];
      if (
        !t ||
        (t.kind !== 'word' && t.kind !== 'symbol' && t.kind !== 'sep') ||
        t.norm !== words[i]
      )
        return 0;
    }
    return words.length;
  }

  private matchAnyPhrase(at: number, phrases: readonly (readonly string[])[]): number {
    for (const p of phrases) {
      const n = this.matchWords(at, p);
      if (n > 0) return n;
    }
    return 0;
  }

  private isWord(at: number, ...words: string[]): boolean {
    const t = this.tokens[at];
    return t?.kind === 'word' && words.includes(t.norm);
  }

  private isFiller(token: Token): boolean {
    if (token.kind === 'sep') return true;
    if (token.kind === 'mention')
      return resolveMention(this.ctx.schema, token.text).kind === 'resource';
    if (token.kind !== 'word') return false;
    return (
      FILLER.has(token.norm) ||
      this.resourceTerms.has(token.norm) ||
      this.resourceTerms.has(singular(token.norm))
    );
  }

  private skipArticles(at: number): number {
    let i = at;
    while (this.isWord(i, 'the', 'a', 'an', 'all', 'every')) i++;
    return i;
  }

  /* ------------------------------ field matching ---------------------------- */

  private matchField(at: number): { field: ResolvedField; length: number } | undefined {
    const t = this.tokens[at];
    if (t?.kind === 'mention') {
      const r = resolveMention(this.ctx.schema, t.text);
      return r.kind === 'field' ? { field: r.field, length: 1 } : undefined;
    }
    // The table's own name ("customers") refers to the resource, never to a
    // one-word field alias such as "customer" (plural tolerance would match it).
    const isResourceWord =
      t?.kind === 'word' &&
      (this.resourceTerms.has(t.norm) || this.resourceTerms.has(singular(t.norm)));
    for (const term of this.fieldTerms) {
      if (isResourceWord && term.words.length === 1) continue;
      if (this.matchTerm(at, term.words)) return { field: term.field, length: term.words.length };
    }
    return undefined;
  }

  /** Match term words, tolerating a plural or possessive on the last word. */
  private matchTerm(at: number, words: readonly string[]): boolean {
    for (let i = 0; i < words.length; i++) {
      const t = this.tokens[at + i];
      if (t?.kind !== 'word' && t?.kind !== 'number') return false;
      const expected = words[i]!;
      if (t.norm === expected) continue;
      if (
        i === words.length - 1 &&
        (t.norm === `${expected}s` ||
          t.norm === `${expected}'s` ||
          t.norm === `${expected}’s` ||
          t.norm === `${expected}es`)
      )
        continue;
      return false;
    }
    return true;
  }

  private matchEnum(
    at: number,
    field?: ResolvedField,
  ): { candidates: EnumTerm[]; length: number } | undefined {
    const t = this.tokens[at];
    if (t?.kind === 'string') {
      const needle = normalizeTerm(t.text);
      const candidates = this.enumTerms.filter(
        (e) => (field ? e.field.id === field.id : true) && e.words.join(' ') === needle,
      );
      return candidates.length > 0 ? { candidates: dedupeEnum(candidates), length: 1 } : undefined;
    }
    for (const term of this.enumTerms) {
      if (field && term.field.id !== field.id) continue;
      if (!this.matchTerm(at, term.words)) continue;
      const length = term.words.length;
      const candidates = this.enumTerms.filter(
        (e) =>
          (field ? e.field.id === field.id : true) &&
          e.words.length === length &&
          this.matchTerm(at, e.words),
      );
      return { candidates: dedupeEnum(candidates), length };
    }
    return undefined;
  }

  /* -------------------------------- commands -------------------------------- */

  private tryCommand(): boolean {
    const start = this.pos;
    const verb = this.matchAnyPhrase(start, [
      ['clear'],
      ['remove'],
      ['reset'],
      ['delete'],
      ['drop'],
      ['undo'],
      ['stop'],
      ['cancel'],
    ]);
    if (verb > 0) {
      let i = this.skipArticles(start + verb);
      if (
        this.isWord(i, 'filters', 'filter', 'conditions', 'criteria') &&
        !this.isWord(i + 1, 'on', 'for', 'by')
      ) {
        this.emit({ op: 'clearFilters' }, i + 1);
        return true;
      }
      if (this.isWord(i, 'filter', 'condition') && this.isWord(i + 1, 'on', 'for', 'by')) {
        const f = this.matchField(i + 2);
        if (f) {
          this.emit({ op: 'removeFilter', target: { field: f.field.id } }, i + 2 + f.length);
          return true;
        }
      }
      if (this.isWord(i, 'search', 'query', 'keyword')) {
        this.emit({ op: 'clearSearch' }, i + 1);
        return true;
      }
      if (this.isWord(i, 'sort', 'sorting', 'order', 'ordering')) {
        if (this.isWord(i + 1, 'by', 'on')) {
          const f = this.matchField(i + 2);
          if (f) {
            this.emit({ op: 'removeSort', field: f.field.id }, i + 2 + f.length);
            return true;
          }
        }
        this.emit({ op: 'clearSort' }, i + 1);
        return true;
      }
      const f = this.matchField(i);
      if (f) {
        const after = i + f.length;
        if (this.isWord(after, 'filter', 'filters', 'condition', 'conditions', 'criteria')) {
          this.emit({ op: 'removeFilter', target: { field: f.field.id } }, after + 1);
          return true;
        }
        if (this.isWord(after, 'sort', 'sorting')) {
          this.emit({ op: 'removeSort', field: f.field.id }, after + 1);
          return true;
        }
        if (hasConditionOn(this.ctx.state, f.field.id)) {
          this.emit({ op: 'removeFilter', target: { field: f.field.id } }, after);
          return true;
        }
      }
      if (this.isWord(start, 'reset', 'clear', 'undo')) {
        i = this.skipArticles(start + verb);
        const scope = this.matchAnyPhrase(i, [['everything'], ['table'], ['view'], ['all']]);
        if (scope > 0 || this.atClauseEnd(i)) {
          this.emit({ op: 'reset' }, i + scope);
          return true;
        }
      }
      return false;
    }
    const startOver = this.matchAnyPhrase(start, [
      ['start', 'over'],
      ['start', 'again'],
      ['show', 'everything'],
    ]);
    if (startOver > 0) {
      this.emit({ op: 'reset' }, start + startOver);
      return true;
    }
    if (this.isWord(start, 'unsort')) {
      this.emit({ op: 'clearSort' }, start + 1);
      return true;
    }
    return false;
  }

  private atClauseEnd(at: number): boolean {
    const t = this.tokens[at];
    return (
      t === undefined ||
      t.kind === 'sep' ||
      (t.kind === 'word' && (t.norm === 'and' || t.norm === 'then'))
    );
  }

  /* ---------------------------------- sort ---------------------------------- */

  private trySort(): boolean {
    const prefix = this.matchAnyPhrase(this.pos, SORT_PREFIXES);
    if (prefix === 0) return false;
    let i = this.skipArticles(this.pos + prefix);
    const keys: SortSpec[] = [];
    for (;;) {
      const key = this.parseSortKey(i);
      if (!key) break;
      keys.push(key.spec);
      i = key.end;
      const sep = this.matchAnyPhrase(i, [
        [',', 'and', 'then', 'by'],
        [',', 'then', 'by'],
        ['and', 'then', 'by'],
        [',', 'and', 'then'],
        [',', 'then'],
        ['and', 'then'],
        ['then', 'by'],
        [',', 'and'],
        ['and', 'by'],
        ['then'],
        [','],
        ['and'],
      ]);
      if (sep === 0) break;
      const next = this.parseSortKey(this.skipArticles(i + sep));
      if (!next) break;
      i = this.skipArticles(i + sep);
    }
    if (keys.length === 0) return false;
    this.sorts.push(...keys);
    this.pos = i;
    return true;
  }

  private parseSortKey(at: number): { spec: SortSpec; end: number } | undefined {
    // "sort by newest" / "sort by oldest first"
    const recency = this.matchRecency(at);
    if (recency) {
      const field = this.recencyFieldAt(at + recency.length);
      if (field)
        return {
          spec: { field: field.field.id, direction: recency.dir },
          end: at + recency.length + field.length,
        };
    }
    const f = this.matchField(at);
    if (!f) return undefined;
    let end = at + f.length;
    let direction: Direction = 'asc';
    const dir = this.matchDirection(end);
    if (dir) {
      direction = dir.dir;
      end += dir.length;
    }
    return { spec: { field: f.field.id, direction }, end };
  }

  private matchDirection(at: number): { dir: Direction; length: number } | undefined {
    for (const d of DIRECTION_PHRASES) {
      const n = this.matchWords(at, d.words);
      if (n > 0) return { dir: d.dir, length: n };
    }
    return undefined;
  }

  private matchRecency(at: number): { dir: Direction; length: number } | undefined {
    for (const r of RECENCY_PHRASES) {
      const n = this.matchWords(at, r.words);
      if (n > 0) return { dir: r.dir, length: n };
    }
    return undefined;
  }

  /**
   * Field for "newest"/"oldest": an explicit date field right after, the schema's
   * `recencyField`, or the only sortable date field. Returns `length: 0` when
   * inferred. `undefined` means ambiguous.
   */
  private recencyFieldAt(at: number): { field: ResolvedField; length: number } | undefined {
    const explicit = this.matchField(at);
    if (
      explicit &&
      (explicit.field.type === 'date' || explicit.field.type === 'datetime') &&
      explicit.field.sortable
    )
      return explicit;
    const recency = this.ctx.schema.defaults.recencyField;
    if (recency !== undefined) {
      const f = this.ctx.schema.fieldsById.get(recency);
      if (f) return { field: f, length: 0 };
    }
    const dates = this.dateFields().filter((f) => f.sortable);
    return dates.length === 1 ? { field: dates[0]!, length: 0 } : undefined;
  }

  private dateFields(): ResolvedField[] {
    return [...this.ctx.schema.fieldsById.values()].filter(
      (f) => f.type === 'date' || f.type === 'datetime',
    );
  }

  private tryRecency(): boolean {
    const recency = this.matchRecency(this.pos);
    if (recency) {
      const after = this.pos + recency.length;
      const field = this.recencyFieldAt(after);
      if (field) {
        this.sorts.push({ field: field.field.id, direction: recency.dir });
        this.pos = after + field.length;
        return true;
      }
      const dates = this.dateFields().filter((f) => f.sortable);
      if (dates.length > 1) {
        this.ambiguity({
          kind: 'field',
          message: `Which date should "${recency.dir === 'desc' ? 'newest' : 'oldest'}" use?`,
          messageKey: 'ambiguity.recencyField',
          options: dates.map((f) => ({
            label: f.label,
            mutations: [{ op: 'setSort', sort: [{ field: f.id, direction: recency.dir }] }],
          })),
        });
        this.pos = after;
        return true;
      }
      return false;
    }

    // "recent" / "recently" as a filter: the window is a material choice → ask.
    if (this.isWord(this.pos, 'recent', 'recently')) {
      const field = this.recencyFieldAt(this.pos + 1);
      const fields = field ? [field.field] : this.dateFields().filter((f) => f.filterable);
      if (fields.length === 0) return false;
      const options: Omit<AmbiguityOption, 'id'>[] = [];
      for (const f of fields) {
        const suffix = fields.length > 1 ? ` (${f.label})` : '';
        options.push(
          {
            label: `Last 7 days${suffix}`,
            mutations: [this.addCondition(f.id, 'last', { amount: 7, unit: 'day' })],
          },
          {
            label: `Last 30 days${suffix}`,
            mutations: [this.addCondition(f.id, 'last', { amount: 30, unit: 'day' })],
            isDefault: f === fields[0],
          },
          { label: `This month${suffix}`, mutations: [this.addCondition(f.id, 'thisMonth')] },
        );
      }
      this.ambiguity({
        kind: 'date_range',
        message: 'What does "recent" mean?',
        messageKey: 'ambiguity.recent',
        options,
      });
      this.pos += 1 + (field?.length ?? 0);
      return true;
    }
    return false;
  }

  /* ------------------------------- pagination ------------------------------- */

  private tryPagination(): boolean {
    const at = this.pos;
    const next = this.matchAnyPhrase(at, [
      ['go', 'to', 'the', 'next', 'page'],
      ['go', 'to', 'next', 'page'],
      ['next', 'page'],
    ]);
    if (next > 0) {
      this.emit({ op: 'nextPage' }, at + next);
      return true;
    }
    const prev = this.matchAnyPhrase(at, [
      ['go', 'to', 'the', 'previous', 'page'],
      ['go', 'to', 'previous', 'page'],
      ['previous', 'page'],
      ['prev', 'page'],
      ['go', 'back'],
      ['back', 'a', 'page'],
    ]);
    if (prev > 0) {
      this.emit({ op: 'prevPage' }, at + prev);
      return true;
    }
    const first = this.matchAnyPhrase(at, [
      ['go', 'to', 'the', 'first', 'page'],
      ['go', 'to', 'first', 'page'],
      ['first', 'page'],
    ]);
    if (first > 0) {
      this.emit({ op: 'setPage', page: 1 }, at + first);
      return true;
    }
    const pageWord = this.matchAnyPhrase(at, [
      ['go', 'to', 'page'],
      ['jump', 'to', 'page'],
      ['show', 'page'],
      ['open', 'page'],
      ['page', 'number'],
      ['page'],
    ]);
    if (pageWord > 0) {
      const n = parseNumber(this.tokens, at + pageWord);
      if (n && Number.isInteger(n.value) && n.value >= 1) {
        this.emit({ op: 'setPage', page: n.value }, at + pageWord + n.length);
        return true;
      }
    }
    const sizeWord = this.matchAnyPhrase(at, [
      ['page', 'size', 'of'],
      ['page', 'size', 'to'],
      ['page', 'size'],
      ['limit', 'to'],
      ['limit'],
    ]);
    if (sizeWord > 0) {
      let i = at + sizeWord;
      const symbol = this.tokens[i];
      if (symbol?.kind === 'symbol' && (symbol.text === '=' || symbol.text === ':')) i++;
      const n = parseNumber(this.tokens, i);
      if (n && Number.isInteger(n.value) && n.value >= 1) {
        this.emit({ op: 'setPageSize', size: n.value }, i + n.length);
        return true;
      }
    }
    // "20 per page", "show 50 rows", "50 results per page", "100 a page"
    let i = at;
    if (this.isWord(i, 'show', 'display')) i++;
    const n = parseNumber(this.tokens, i);
    if (n && Number.isInteger(n.value) && n.value >= 1) {
      const after = i + n.length;
      const tail = this.matchAnyPhrase(after, [
        ['rows', 'per', 'page'],
        ['results', 'per', 'page'],
        ['records', 'per', 'page'],
        ['items', 'per', 'page'],
        ['entries', 'per', 'page'],
        ['per', 'page'],
        ['a', 'page'],
        ['on', 'a', 'page'],
        ['at', 'a', 'time'],
      ]);
      if (tail > 0) {
        this.emit({ op: 'setPageSize', size: n.value }, after + tail);
        return true;
      }
      const noun = this.tokens[after];
      const isNoun =
        noun?.kind === 'word' &&
        (PAGE_SIZE_NOUNS.has(noun.norm) ||
          this.resourceTerms.has(noun.norm) ||
          this.resourceTerms.has(singular(noun.norm)));
      if (i > at && isNoun && this.atClauseEnd(after + 1)) {
        this.emit({ op: 'setPageSize', size: n.value }, after + 1);
        return true;
      }
    }
    return false;
  }

  /* --------------------------------- search --------------------------------- */

  private trySearch(): boolean {
    const at = this.pos;
    const verb = this.matchAnyPhrase(at, [
      ['search', 'for'],
      ['search'],
      ['look', 'for'],
      ['look', 'up'],
      ['lookup'],
    ]);
    if (verb === 0) {
      // A lone quoted string is a global search.
      const t = this.tok();
      if (t?.kind === 'string' && this.meaningfulTokenCount() === 1) {
        if (!this.ctx.schema.capabilities.search) return false;
        this.emit({ op: 'setSearch', search: { query: t.text } }, at + 1);
        return true;
      }
      return false;
    }
    let i = at + verb;
    let text: string | undefined;
    const first = this.tokens[i];
    if (first?.kind === 'string') {
      text = first.text;
      i++;
    } else {
      const startTok = i;
      while (i < this.tokens.length) {
        const t = this.tokens[i]!;
        if (
          t.kind === 'sep' ||
          (t.kind === 'word' &&
            ['sort', 'sorted', 'order', 'ordered', 'then', 'page', 'per', 'in', 'within'].includes(
              t.norm,
            ))
        )
          break;
        if (t.kind === 'word' && t.norm === 'and' && i > startTok) break;
        i++;
      }
      if (i === startTok) return false;
      text = this.input.slice(this.tokens[startTok]!.start, this.tokens[i - 1]!.end);
    }
    const fields: string[] = [];
    if (this.isWord(i, 'in', 'within', 'across')) {
      let j = this.skipArticles(i + 1);
      for (;;) {
        const f = this.matchField(j);
        if (!f?.field.searchable) break;
        fields.push(f.field.id);
        j += f.length;
        const sep = this.matchAnyPhrase(j, [[','], ['and'], ['or']]);
        if (sep === 0 || !this.matchField(j + sep)) break;
        j += sep;
      }
      if (fields.length > 0) {
        i = j;
        if (this.isWord(i, 'field', 'fields', 'column', 'columns')) i++;
      }
    }
    this.emit(
      { op: 'setSearch', search: fields.length > 0 ? { query: text, fields } : { query: text } },
      i,
    );
    return true;
  }

  private meaningfulTokenCount(): number {
    return this.tokens.filter((t) => !this.isFiller(t)).length;
  }

  /* --------------------------------- filters -------------------------------- */

  private tryFilter(): boolean {
    const first = this.parseCondition(this.pos);
    if (!first) return this.tryBareEnum();
    const nodes: FilterNode[] = [first.node];
    let end = this.pos + first.length;
    // "A or B", "country is India or US"
    while (
      this.isWord(end, 'or') ||
      (this.tokens[end]?.kind === 'sep' && this.isWord(end + 1, 'or'))
    ) {
      const orAt = this.isWord(end, 'or') ? end + 1 : end + 2;
      const full = this.parseCondition(orAt);
      if (full) {
        nodes.push(full.node);
        end = orAt + full.length;
        continue;
      }
      const same = this.extendSameField(first.node, orAt);
      if (!same) break;
      nodes.push(same.node);
      end = orAt + same.length;
    }
    const node: FilterNode =
      nodes.length === 1
        ? nodes[0]!
        : { type: 'group', id: this.ctx.ids('g'), logic: 'or', children: nodes };
    this.emit({ op: 'addFilter', node }, end);
    return true;
  }

  /** "... or US" after "country is India": same field and operator, new value. */
  private extendSameField(node: FilterNode, at: number): ParsedCondition | undefined {
    if (node.type !== 'condition' || OPERATOR_ARITY[node.operator] !== 'single') return undefined;
    const field = this.ctx.schema.fieldsById.get(node.field);
    if (!field) return undefined;
    const value = this.parseScalar(field, at);
    if (!value) return undefined;
    return { node: this.condition(field.id, node.operator, value.value), length: value.length };
  }

  private parseCondition(at: number): ParsedCondition | undefined {
    // "no phone", "without email", "missing phone"
    if (this.isWord(at, 'no', 'without', 'missing', 'lacking')) {
      const f = this.matchField(this.skipArticles(at + 1));
      if (f?.field.filterable && f.field.operators.includes('isNull')) {
        const end = this.skipArticles(at + 1) + f.length;
        return { node: this.condition(f.field.id, 'isNull'), length: end - at };
      }
    }
    // "not verified", "not active"
    if (this.isWord(at, 'not')) {
      const f = this.matchField(at + 1);
      if (f?.field.type === 'boolean' && this.isStandaloneField(at + 1 + f.length)) {
        return { node: this.condition(f.field.id, 'eq', false), length: 1 + f.length };
      }
      const e = this.matchEnum(at + 1);
      if (e?.candidates.length === 1 && e.candidates[0]!.field.operators.includes('neq')) {
        const c = e.candidates[0]!;
        return { node: this.condition(c.field.id, 'neq', c.value), length: 1 + e.length };
      }
    }
    // "unverified", "non-verified"
    const t = this.tokens[at];
    if (t?.kind === 'word') {
      for (const prefix of NEGATION_PREFIXES) {
        if (!t.norm.startsWith(prefix) || t.norm.length <= prefix.length + 2) continue;
        const rest = t.norm.slice(prefix.length);
        const field = [...this.ctx.schema.fieldsById.values()].find(
          (f) =>
            f.type === 'boolean' &&
            f.filterable &&
            [f.id, f.label, ...f.aliases].some((term) => normalizeTerm(term) === rest),
        );
        if (field) return { node: this.condition(field.id, 'eq', false), length: 1 };
      }
    }

    const f = this.matchField(at);
    if (f) return this.parseFieldCondition(f.field, at, f.length);

    // Standalone relative date ("joined" omitted): "this week", "in the last 7 days"
    return this.parseStandaloneDate(at);
  }

  private isStandaloneField(at: number): boolean {
    return this.atClauseEnd(at) || this.isFiller(this.tokens[at]!) || this.isWord(at, 'or');
  }

  private parseFieldCondition(
    field: ResolvedField,
    at: number,
    fieldLength: number,
  ): ParsedCondition | undefined {
    if (!field.filterable) return undefined;
    const opAt = at + fieldLength;
    for (const p of OP_PHRASES) {
      if (p.types && !p.types.includes(field.type)) continue;
      const n = this.matchWords(opAt, p.words);
      if (n === 0) continue;
      const operator = p.op;
      if (!field.operators.includes(operator)) continue;
      const value = this.parseOperatorValue(field, operator, opAt + n);
      if (value)
        return {
          node: this.condition(field.id, operator, value.value),
          length: fieldLength + n + value.length,
        };
    }
    // Implicit equality: "status active", "country India", "age 25"
    if (field.type !== 'boolean' && field.operators.includes('eq')) {
      const value = this.parseScalar(field, opAt, { requireQuotedText: field.type !== 'string' });
      if (value)
        return {
          node: this.condition(field.id, 'eq', value.value),
          length: fieldLength + value.length,
        };
    }
    // Bare boolean field: "verified users"
    if (
      field.type === 'boolean' &&
      field.operators.includes('eq') &&
      this.isStandaloneField(opAt)
    ) {
      return { node: this.condition(field.id, 'eq', true), length: fieldLength };
    }
    return undefined;
  }

  private parseStandaloneDate(at: number): ParsedCondition | undefined {
    const field = this.recencyFieldAt(at);
    if (!field || field.length !== 0 || !field.field.filterable) return undefined;
    for (const p of OP_PHRASES) {
      if (p.types !== DATE_TYPES) continue;
      if (
        ![
          'last',
          'next',
          'today',
          'yesterday',
          'thisWeek',
          'lastWeek',
          'thisMonth',
          'lastMonth',
          'thisYear',
        ].includes(p.op)
      )
        continue;
      const n = this.matchWords(at, p.words);
      if (n === 0) continue;
      const value = this.parseOperatorValue(field.field, p.op, at + n);
      if (value)
        return {
          node: this.condition(field.field.id, p.op, value.value),
          length: n + value.length,
        };
    }
    return undefined;
  }

  /** Parse the value shape an operator requires. */
  private parseOperatorValue(
    field: ResolvedField,
    operator: Operator,
    at: number,
  ): Parsed<FilterCondition['value']> | undefined {
    switch (OPERATOR_ARITY[operator]) {
      case 'none':
        return { value: undefined, length: 0 };
      case 'single':
        return this.parseScalar(field, at);
      case 'range': {
        const a = this.parseScalar(field, at);
        if (!a) return undefined;
        const sep = this.matchAnyPhrase(at + a.length, [
          ['and'],
          ['to'],
          ['-'],
          ['through'],
          ['till'],
          ['until'],
        ]);
        if (sep === 0) return undefined;
        const b = this.parseScalar(field, at + a.length + sep);
        if (!b) return undefined;
        return { value: [a.value, b.value], length: a.length + sep + b.length };
      }
      case 'list': {
        const values: ScalarValue[] = [];
        let i = at;
        for (;;) {
          const v = this.parseScalar(field, i);
          if (!v) break;
          values.push(v.value);
          i += v.length;
          const sep = this.matchAnyPhrase(i, [[',', 'or'], [',', 'and'], [','], ['or'], ['and']]);
          if (sep === 0 || !this.parseScalar(field, i + sep)) break;
          i += sep;
        }
        return values.length > 0 ? { value: values, length: i - at } : undefined;
      }
      case 'duration': {
        const d = parseDuration(this.tokens, at);
        if (d) return d;
        // "last day", "past week" (amount 1)
        const unit = this.tokens[at];
        if (unit?.kind === 'word' && ['day', 'hour', 'minute'].includes(unit.norm)) {
          return { value: { amount: 1, unit: unit.norm as 'day' | 'hour' | 'minute' }, length: 1 };
        }
        return undefined;
      }
    }
  }

  private parseScalar(
    field: ResolvedField,
    at: number,
    options: { requireQuotedText?: boolean } = {},
  ): Parsed<ScalarValue> | undefined {
    const t = this.tokens[at];
    if (!t) return undefined;
    switch (field.type) {
      case 'number': {
        if (t.kind === 'string') {
          const n = Number(t.text.replace(/[,_\s]/g, ''));
          return Number.isFinite(n) && t.text.trim() !== '' ? { value: n, length: 1 } : undefined;
        }
        return parseNumber(this.tokens, at, {
          percentAsFraction: field.format === 'percent' && field.percentScale === 'fraction',
        });
      }
      case 'boolean':
        return parseBoolean(this.tokens, at);
      case 'enum': {
        const e = this.matchEnum(at, field);
        return e?.candidates[0] ? { value: e.candidates[0].value, length: e.length } : undefined;
      }
      case 'date':
      case 'datetime': {
        if (t.kind === 'string') {
          const inner = tokenize(t.text);
          const d = parseDate(inner, 0, this.currentYear);
          return d && d.length === inner.length ? { value: d.value, length: 1 } : undefined;
        }
        return parseDate(this.tokens, at, this.currentYear);
      }
      case 'string': {
        if (t.kind === 'string') return { value: t.text, length: 1 };
        if (options.requireQuotedText === true) return undefined;
        if (t.kind !== 'word' && t.kind !== 'number' && t.kind !== 'date') return undefined;
        // A value never starts at a separator, keyword, field name, the table name or a recency phrase.
        if (this.isBoundaryAfterValue(at)) return undefined;
        if (t.kind === 'word' && VALUE_START_BLOCKLIST.has(t.norm)) return undefined;
        let end = at + 1;
        while (end < this.tokens.length && !this.isBoundaryAfterValue(end)) end++;
        return { value: this.input.slice(t.start, this.tokens[end - 1]!.end), length: end - at };
      }
    }
  }

  private isBoundaryAfterValue(at: number): boolean {
    const t = this.tokens[at];
    if (
      !t ||
      t.kind === 'sep' ||
      t.kind === 'symbol' ||
      t.kind === 'mention' ||
      t.kind === 'string'
    )
      return true;
    if (
      t.kind === 'word' &&
      (BOUNDARY.has(t.norm) || FILLER.has(t.norm) || this.resourceTerms.has(t.norm))
    )
      return true;
    return this.matchField(at) !== undefined || this.matchRecency(at) !== undefined;
  }

  /** "active users", "pending" – an enum value without its field. */
  private tryBareEnum(): boolean {
    const e = this.matchEnum(this.pos);
    if (!e) return false;
    const byField = new Map(e.candidates.map((c) => [c.field.id, c]));
    if (byField.size === 1) {
      const c = e.candidates[0]!;
      if (!c.field.operators.includes('eq')) return false;
      this.emit(
        { op: 'addFilter', node: this.condition(c.field.id, 'eq', c.value) },
        this.pos + e.length,
      );
      return true;
    }
    this.ambiguity({
      kind: 'field',
      message: `"${this.input.slice(this.tokens[this.pos]!.start, this.tokens[this.pos + e.length - 1]!.end)}" matches several fields. Which one did you mean?`,
      messageKey: 'ambiguity.valueField',
      options: [...byField.values()].map((c) => ({
        label: `${c.field.label}: ${c.value}`,
        mutations: [{ op: 'addFilter', node: this.condition(c.field.id, 'eq', c.value) }],
      })),
    });
    this.pos += e.length;
    return true;
  }

  /* ------------------------------ construction ------------------------------ */

  private condition(
    field: string,
    operator: Operator,
    value?: FilterCondition['value'],
  ): FilterCondition {
    return {
      type: 'condition',
      id: this.ctx.ids('f'),
      field,
      operator,
      ...(value === undefined ? {} : { value }),
    };
  }

  private addCondition(
    field: string,
    operator: Operator,
    value?: FilterCondition['value'],
  ): Mutation {
    return { op: 'addFilter', node: this.condition(field, operator, value) };
  }

  private emit(mutation: Mutation, end: number): void {
    this.mutations.push(mutation);
    this.pos = end;
  }

  private ambiguity(spec: {
    kind: Ambiguity['kind'];
    message: string;
    messageKey: string;
    options: readonly Omit<AmbiguityOption, 'id'>[];
  }): void {
    this.ambiguities.push({
      id: this.ctx.ids('amb'),
      kind: spec.kind,
      message: spec.message,
      messageKey: spec.messageKey,
      options: spec.options.map((o) => ({ ...o, id: this.ctx.ids('opt') })),
    });
  }

  /**
   * Refining an equality filter replaces it: saying "status inactive" while the
   * table is filtered to "status active" means "switch", not "both". Range
   * conditions (age > 25, then age < 40) keep narrowing.
   */
  private applyEqualityRefinement(mutations: readonly Mutation[]): Mutation[] {
    const out: Mutation[] = [];
    const replaced = new Set<string>();
    const explicitlyRemoved = new Set(
      mutations.flatMap((m) =>
        m.op === 'removeFilter' && 'field' in m.target ? [m.target.field] : [],
      ),
    );
    const cleared = mutations.some(
      (m) => m.op === 'clearFilters' || m.op === 'reset' || m.op === 'replaceFilter',
    );
    for (const m of mutations) {
      if (
        !cleared &&
        m.op === 'addFilter' &&
        m.node.type === 'condition' &&
        EQUALITY_OPS.has(m.node.operator)
      ) {
        const fieldId = m.node.field;
        if (
          !replaced.has(fieldId) &&
          !explicitlyRemoved.has(fieldId) &&
          onlyEqualityConditionsOn(this.ctx.state, fieldId)
        ) {
          out.push({ op: 'removeFilter', target: { field: fieldId } });
          replaced.add(fieldId);
        }
      }
      out.push(m);
    }
    return out;
  }
}

const EQUALITY_OPS: ReadonlySet<Operator> = new Set<Operator>(['eq', 'neq', 'in', 'notIn']);

function rootConditions(state: TableQuery, fieldId: string): FilterCondition[] {
  if (state.filter === null || state.filter.logic !== 'and' || state.filter.not === true) return [];
  return state.filter.children.filter(
    (c): c is FilterCondition => c.type === 'condition' && c.field === fieldId,
  );
}

function hasConditionOn(state: TableQuery, fieldId: string): boolean {
  const walk = (node: FilterNode): boolean =>
    node.type === 'condition' ? node.field === fieldId : node.children.some(walk);
  return state.filter !== null && walk(state.filter);
}

function onlyEqualityConditionsOn(state: TableQuery, fieldId: string): boolean {
  const conditions = rootConditions(state, fieldId);
  return conditions.length > 0 && conditions.every((c) => EQUALITY_OPS.has(c.operator));
}

function dedupeEnum(candidates: EnumTerm[]): EnumTerm[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.field.id}|${c.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function yearIn(now: number, timezone: string): number {
  try {
    const year = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(
      new Date(now),
    );
    return Number(year);
  } catch {
    return new Date(now).getUTCFullYear();
  }
}
