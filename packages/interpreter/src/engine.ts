import {
  analyzeConflicts,
  applyMutations,
  canonicalizeQuery,
  createInitialQuery,
  createIssue,
  createWarning,
  defineSchema,
  explainQuery,
  findMentions,
  getActiveMention,
  isPragmaError,
  isValidTimeZone,
  iterateConditions,
  normalizeQuery,
  parseMutations,
  parseTableQuery,
  PragmaConfigError,
  PROTOCOL_VERSION,
  randomId,
  RELATIVE_DATE_OPERATORS,
  resolveMention,
  sha256,
  stableStringify,
  suggestFields,
  suggestMentions,
  toIssue,
  validateMutations,
  validateQuery,
  type Ambiguity,
  type ClarificationResult,
  type ErrorResult,
  type ExplanationItem,
  type IdGenerator,
  type InterpretResult,
  type MentionSuggestion,
  type Mutation,
  type PageInfo,
  type ParserKind,
  type PragmaIssue,
  type PragmaWarning,
  type ResolvedSchema,
  type ResultMeta,
  type Suggestion,
  type TableQuery,
  type TableSchema,
  type TokenUsage,
  type UnsupportedResult,
} from '@avinash-baraiya/pragma-core';
import { MemoryCache, type CacheStore } from './cache.js';
import { parseDeterministic } from './deterministic/parser.js';
import type { Proposal } from './types.js';
import { ENGINE_VERSION } from './version.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How ambiguity is handled:
 * - `ask` (default): return `needs_clarification` with options;
 * - `bestGuess`: apply each ambiguity's default option and add an `ASSUMPTION_APPLIED` warning.
 *
 * Values that do not exist in the schema (e.g. an unknown enum value) are never
 * guessed, whatever the policy.
 *
 * @public
 */
export type AmbiguityPolicy = 'ask' | 'bestGuess';

/**
 * - `auto` (default): deterministic parser first, language model for the rest;
 * - `deterministic-only`: never call a model;
 * - `llm-only`: always call the model (deterministic parser skipped).
 *
 * @public
 */
export type RouterMode = 'auto' | 'deterministic-only' | 'llm-only';

/** Everything a model-backed interpreter receives. Contains schema metadata, never row data. @public */
export interface ModelInterpretRequest {
  readonly instruction: string;
  readonly schema: ResolvedSchema;
  readonly state: TableQuery;
  readonly now: number;
  readonly timezone: string;
  readonly ambiguity: AmbiguityPolicy;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly ids: IdGenerator;
}

/** @public */
export interface ModelInterpretation {
  readonly proposal: Proposal;
  readonly model?: string;
  readonly provider?: string;
  readonly usage?: TokenUsage;
  readonly retries?: number;
}

/**
 * Model-backed interpreter plugged into the engine (see `createModelInterpreter`
 * and `remoteInterpreter`). Must reject with a `PragmaError` on failure.
 *
 * @public
 */
export interface ModelInterpreter {
  readonly id: string;
  interpret(request: ModelInterpretRequest): Promise<ModelInterpretation>;
}

/** @public */
export interface EngineLimits {
  /** Default 500 characters. */
  readonly maxInstructionLength: number;
  /** Default 20. */
  readonly maxConditions: number;
  /** Default 3. */
  readonly maxDepth: number;
}

/** @public */
export type EngineEvent =
  | {
      readonly type: 'interpret.start';
      readonly requestId: string;
      readonly instructionLength: number;
      readonly instruction?: string;
    }
  | {
      readonly type: 'interpret.complete';
      readonly requestId: string;
      readonly status: InterpretResult['status'];
      readonly meta: ResultMeta;
      readonly errorCodes: readonly string[];
      readonly warningCodes: readonly string[];
      readonly mutationCount: number;
    }
  | { readonly type: 'cache.error'; readonly requestId: string; readonly operation: 'get' | 'set' };

/** @public */
export interface EngineOptions {
  /** Table schema (raw or already resolved with `defineSchema`). */
  readonly schema: TableSchema | ResolvedSchema;
  /** Model-backed interpreter for instructions the deterministic parser cannot fully handle. */
  readonly interpreter?: ModelInterpreter;
  readonly mode?: RouterMode;
  readonly ambiguity?: AmbiguityPolicy;
  /** IANA timezone for relative dates. Default `UTC` (with a warning when relative dates are used). */
  readonly timezone?: string;
  /** Default 1 (Monday). */
  readonly weekStartsOn?: 0 | 1;
  /** Clock. Default `Date.now`. */
  readonly now?: () => number;
  readonly idGenerator?: IdGenerator;
  /** Interpretation cache. Default: in-memory LRU (500 entries). `false` disables caching. */
  readonly cache?: CacheStore<Proposal> | false;
  readonly limits?: Partial<EngineLimits>;
  /** Deadline for model calls in ms. Default 15 000. */
  readonly timeoutMs?: number;
  /** Observability hook. Must not throw (errors are swallowed). */
  readonly onEvent?: (event: EngineEvent) => void;
  /** Include instruction text in `interpret.start` events. Default `false` (privacy). */
  readonly logInstructions?: boolean;
}

/** @public */
export interface InterpretOptions {
  /** Current table state; mutations are applied to it. Default: the initial query. Untrusted: validated. */
  readonly currentState?: unknown;
  /** Cursor information for `next page` / `previous page` with cursor pagination. */
  readonly pageInfo?: PageInfo;
  readonly signal?: AbortSignal;
  /** Correlation id (e.g. from `x-request-id`). Generated when absent. */
  readonly requestId?: string;
}

/** @public */
export interface LocalOptions {
  readonly currentState?: unknown;
  readonly pageInfo?: PageInfo;
}

/** @public */
export interface MentionSuggestions {
  /** Where the active `@mention` starts, or `null` when the caret is not in one. */
  readonly start: number | null;
  readonly query: string;
  readonly suggestions: readonly MentionSuggestion[];
}

/** @public */
export interface Engine {
  readonly schema: ResolvedSchema;
  /** Interpret a natural-language instruction. Never rejects for runtime problems. */
  interpret(instruction: string, options?: InterpretOptions): Promise<InterpretResult>;
  /** Apply the chosen options of a `needs_clarification` result locally (no model call). */
  resolve(
    result: ClarificationResult,
    choices: Readonly<Record<string, string>>,
    options?: LocalOptions,
  ): InterpretResult;
  /** Validate and apply mutations locally, e.g. when a user removes a chip. */
  apply(mutations: unknown, options?: LocalOptions): InterpretResult;
  /** The starting query (schema defaults, engine timezone). */
  initialQuery(): TableQuery;
  /** Local, synchronous `@` autocomplete for the text up to `caret`. */
  suggest(text: string, caret: number, limit?: number): MentionSuggestions;
  /** Deterministic explanation of a query. */
  explain(query: TableQuery): ExplanationItem[];
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_LIMITS: EngineLimits = { maxInstructionLength: 500, maxConditions: 20, maxDepth: 3 };
const DEFAULT_TIMEOUT_MS = 15_000;

function isResolved(schema: TableSchema | ResolvedSchema): schema is ResolvedSchema {
  return 'fieldsById' in schema;
}

/**
 * Create an interpretation engine for one table schema.
 *
 * Configuration problems throw {@link PragmaConfigError} immediately; runtime
 * problems are always returned as typed results.
 *
 * @public
 */
export function createEngine(options: EngineOptions): Engine {
  const schema = isResolved(options.schema) ? options.schema : defineSchema(options.schema);
  const config = validateOptions(options);
  return new PragmaEngine(schema, options, config);
}

interface ResolvedConfig {
  readonly mode: RouterMode;
  readonly ambiguity: AmbiguityPolicy;
  readonly timezone: string;
  readonly timezoneExplicit: boolean;
  readonly weekStartsOn: 0 | 1;
  readonly limits: EngineLimits;
  readonly timeoutMs: number;
}

function validateOptions(options: EngineOptions): ResolvedConfig {
  const problems: string[] = [];
  // Widened to string: these checks protect untyped (JavaScript) callers.
  const mode: string = options.mode ?? 'auto';
  if (!isRouterMode(mode)) problems.push(`Unknown mode "${mode}".`);
  if (mode === 'llm-only' && !options.interpreter)
    problems.push('mode "llm-only" requires an interpreter.');
  const ambiguity: string = options.ambiguity ?? 'ask';
  if (!isAmbiguityPolicy(ambiguity)) problems.push(`Unknown ambiguity policy "${ambiguity}".`);
  const timezone = options.timezone ?? 'UTC';
  if (!isValidTimeZone(timezone)) problems.push(`Unknown timezone "${timezone}".`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    problems.push('timeoutMs must be a positive number.');
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0)
      problems.push(`limits.${key} must be a positive integer.`);
  }
  if (problems.length > 0) {
    throw new PragmaConfigError(
      'CONFIG_ERROR',
      `Invalid engine configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      {
        issues: problems.map((message) =>
          createIssue('CONFIG_ERROR', { message, messageKey: 'config.invalid' }),
        ),
      },
    );
  }
  return {
    mode: mode as RouterMode,
    ambiguity: ambiguity as AmbiguityPolicy,
    timezone,
    timezoneExplicit: options.timezone !== undefined,
    weekStartsOn: options.weekStartsOn ?? 1,
    limits,
    timeoutMs,
  };
}

function isRouterMode(value: string): value is RouterMode {
  return value === 'auto' || value === 'deterministic-only' || value === 'llm-only';
}

function isAmbiguityPolicy(value: string): value is AmbiguityPolicy {
  return value === 'ask' || value === 'bestGuess';
}

class PragmaEngine implements Engine {
  private readonly ids: IdGenerator;
  private readonly now: () => number;
  private readonly cache: CacheStore<Proposal> | undefined;

  constructor(
    readonly schema: ResolvedSchema,
    private readonly options: EngineOptions,
    private readonly config: ResolvedConfig,
  ) {
    this.ids = options.idGenerator ?? randomId;
    this.now = options.now ?? Date.now;
    this.cache =
      options.cache === false
        ? undefined
        : (options.cache ?? new MemoryCache<Proposal>({ maxEntries: 500 }));
  }

  initialQuery(): TableQuery {
    return createInitialQuery(this.schema, { context: this.context() });
  }

  explain(query: TableQuery): ExplanationItem[] {
    return explainQuery(query, this.schema);
  }

  suggest(text: string, caret: number, limit = 8): MentionSuggestions {
    const active = getActiveMention(text, Math.max(0, Math.min(caret, text.length)));
    if (!active) return { start: null, query: '', suggestions: [] };
    return {
      start: active.start,
      query: active.query,
      suggestions: suggestMentions(this.schema, active.query, { limit }),
    };
  }

  async interpret(instruction: string, options: InterpretOptions = {}): Promise<InterpretResult> {
    const started = this.now();
    const requestId = options.requestId ?? this.ids('req');
    const text = typeof instruction === 'string' ? instruction.replace(/\s+/g, ' ').trim() : '';
    this.emit({
      type: 'interpret.start',
      requestId,
      instructionLength: text.length,
      ...(this.options.logInstructions === true ? { instruction: text } : {}),
    });

    let result: InterpretResult;
    try {
      result = await this.run(text, options, requestId, started);
    } catch (error) {
      result = this.errorResult([toIssue(error)], this.meta(requestId, 'local', started));
    }
    this.emitComplete(result);
    return result;
  }

  private async run(
    text: string,
    options: InterpretOptions,
    requestId: string,
    started: number,
  ): Promise<InterpretResult> {
    const meta = (parser: ParserKind, extra: Partial<ResultMeta> = {}): ResultMeta =>
      this.meta(requestId, parser, started, extra);

    const state = this.resolveState(options.currentState);
    if ('issues' in state) return this.errorResult(state.issues, meta('local'));

    if (text === '') {
      return this.errorResult(
        [
          createIssue('PARSE_ERROR', {
            message: 'The instruction is empty.',
            messageKey: 'instruction.empty',
          }),
        ],
        meta('local'),
      );
    }
    if (text.length > this.config.limits.maxInstructionLength) {
      return this.errorResult(
        [
          createIssue('LIMIT_EXCEEDED', {
            message: `The instruction is too long (${text.length} characters); the maximum is ${this.config.limits.maxInstructionLength}.`,
            messageKey: 'limit.instructionLength',
            params: { length: text.length, max: this.config.limits.maxInstructionLength },
          }),
        ],
        meta('local'),
      );
    }

    const mentionProblem = this.checkMentions(text);
    if (mentionProblem) return { ...mentionProblem, meta: meta('local') };

    const key = this.cacheKey(text, state.query);
    const cached = await this.cacheGet(key, requestId);
    if (cached) return this.finalize(cached, state.query, meta('cache'), options.pageInfo);

    let proposal: Proposal | undefined;
    let parser: ParserKind = 'deterministic';
    let modelMeta: Partial<ResultMeta> = {};

    if (this.config.mode !== 'llm-only') {
      const det = parseDeterministic(text, {
        schema: this.schema,
        state: state.query,
        now: this.now(),
        timezone: this.timezoneOf(state.query),
        ids: this.ids,
      });
      if (det.covered) proposal = det.proposal;
    }

    if (!proposal) {
      const interpreter = this.options.interpreter;
      if (this.config.mode === 'deterministic-only' || !interpreter) {
        return this.unsupported(
          [
            createIssue(interpreter ? 'UNSUPPORTED_OPERATION' : 'MODEL_UNAVAILABLE', {
              message:
                'This instruction could not be understood. Try naming a column with @, for example "@status is active".',
              messageKey: 'instruction.notUnderstood',
            }),
          ],
          [],
          meta('deterministic'),
        );
      }
      const outcome = await this.callModel(
        interpreter,
        text,
        state.query,
        requestId,
        options.signal,
      );
      if ('issue' in outcome)
        return this.errorResult([outcome.issue], meta('llm', { provider: interpreter.id }));
      proposal = outcome.proposal;
      parser = 'llm';
      modelMeta = {
        provider: outcome.provider ?? interpreter.id,
        ...(outcome.model === undefined ? {} : { model: outcome.model }),
        ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        ...(outcome.retries === undefined ? {} : { retries: outcome.retries }),
      };
    }

    await this.cacheSet(key, proposal, requestId);
    return this.finalize(proposal, state.query, meta(parser, modelMeta), options.pageInfo);
  }

  resolve(
    result: ClarificationResult,
    choices: Readonly<Record<string, string>>,
    options: LocalOptions = {},
  ): InterpretResult {
    const started = this.now();
    const meta = this.meta(result.meta.requestId, 'local', started);
    const state = this.resolveState(options.currentState);
    if ('issues' in state) return this.errorResult(state.issues, meta);
    const chosen: Mutation[] = [];
    for (const ambiguity of result.ambiguities) {
      const optionId = choices[ambiguity.id];
      const option = ambiguity.options.find((o) => o.id === optionId);
      if (!option) {
        return this.errorResult(
          [
            createIssue('VALIDATION_ERROR', {
              message:
                optionId === undefined
                  ? `Choose an option for: ${ambiguity.message}`
                  : `Unknown option "${optionId}" for: ${ambiguity.message}`,
              messageKey:
                optionId === undefined
                  ? 'clarification.missingChoice'
                  : 'clarification.unknownOption',
              params: { ambiguity: ambiguity.id },
            }),
          ],
          meta,
        );
      }
      chosen.push(...option.mutations);
    }
    return this.finalize(
      { mutations: [...result.partial, ...chosen], ambiguities: [] },
      state.query,
      meta,
      options.pageInfo,
    );
  }

  apply(mutations: unknown, options: LocalOptions = {}): InterpretResult {
    const started = this.now();
    const meta = this.meta(this.ids('req'), 'local', started);
    const state = this.resolveState(options.currentState);
    if ('issues' in state) return this.errorResult(state.issues, meta);
    const parsed = parseMutations(mutations);
    if (!parsed.success) return this.errorResult(parsed.issues, meta);
    return this.finalize(
      { mutations: parsed.data, ambiguities: [] },
      state.query,
      meta,
      options.pageInfo,
    );
  }

  /* ------------------------------ finalization ------------------------------ */

  /**
   * Turn an untrusted proposal into a result: validate, resolve ambiguity per
   * policy, apply to state, re-validate, normalize, analyze and explain.
   */
  private finalize(
    proposal: Proposal,
    state: TableQuery,
    meta: ResultMeta,
    pageInfo: PageInfo | undefined,
  ): InterpretResult {
    if (proposal.unsupported) {
      const relayed = proposal.unsupported.errors;
      return this.unsupported(
        relayed && relayed.length > 0
          ? relayed
          : [
              createIssue('UNSUPPORTED_OPERATION', {
                message: proposal.unsupported.reason,
                messageKey: proposal.unsupported.messageKey,
              }),
            ],
        proposal.unsupported.suggestions,
        meta,
      );
    }

    const validationOptions = {
      limits: {
        maxConditions: this.config.limits.maxConditions,
        maxDepth: this.config.limits.maxDepth,
      },
      pageSizeOverflow:
        this.config.ambiguity === 'bestGuess' ? ('clamp' as const) : ('error' as const),
    };
    const warnings: PragmaWarning[] = [];

    // Structural check first: proposals may come from a model or a remote
    // server, so shapes and bounds (e.g. positive page numbers) are not assumed.
    const structural = parseMutations(proposal.mutations);
    if (!structural.success) return this.unsupported(structural.issues, [], meta);

    // Unknown enum values become a clarification listing the real values.
    const validated = validateMutations(structural.data, this.schema, validationOptions);
    const valueAmbiguities: Ambiguity[] = [];
    let mutations: Mutation[];
    if (validated.value) {
      mutations = validated.value;
    } else {
      const enumFix = this.enumValueAmbiguities(structural.data, validated.issues);
      if (!enumFix) return this.unsupported(validated.issues, [], meta);
      mutations = enumFix.kept;
      valueAmbiguities.push(...enumFix.ambiguities);
    }
    warnings.push(...validated.warnings);

    const proposed = proposal.ambiguities
      .map((a) => ({
        ...a,
        options: a.options.filter((o) => {
          const parsed = parseMutations(o.mutations);
          return (
            parsed.success &&
            validateMutations(parsed.data, this.schema, validationOptions).value !== undefined
          );
        }),
      }))
      .filter((a) => a.options.length > 0);

    if (valueAmbiguities.length > 0 || (proposed.length > 0 && this.config.ambiguity === 'ask')) {
      const result: ClarificationResult = {
        status: 'needs_clarification',
        ambiguities: [...proposed, ...valueAmbiguities],
        partial: mutations,
        warnings,
        meta,
      };
      return result;
    }
    for (const ambiguity of proposed) {
      const choice = ambiguity.options.find((o) => o.isDefault === true) ?? ambiguity.options[0]!;
      mutations = [...mutations, ...choice.mutations];
      warnings.push(
        createWarning('ASSUMPTION_APPLIED', {
          message: `${ambiguity.message} Assumed: ${choice.label}.`,
          messageKey: 'ambiguity.assumed',
          params: { question: ambiguity.message, choice: choice.label },
        }),
      );
    }

    const applied = applyMutations(state, mutations, {
      schema: this.schema,
      idGenerator: this.ids,
      ...(pageInfo ? { pageInfo } : {}),
    });
    if (applied.issues.length > 0) return this.unsupported(applied.issues, [], meta);
    warnings.push(...applied.warnings);

    const withContext: TableQuery = applied.query.context
      ? applied.query
      : { ...applied.query, context: this.context() };
    // Defence in depth: the result must also satisfy the structural protocol schema.
    const shape = parseTableQuery(withContext);
    if (!shape.success) return this.unsupported(shape.issues, [], meta);
    const checked = validateQuery(shape.data, this.schema, validationOptions);
    if (!checked.value) return this.unsupported(checked.issues, [], meta);
    warnings.push(...checked.warnings);

    const normalized = normalizeQuery(checked.value, this.schema);
    warnings.push(...normalized.warnings);
    warnings.push(...analyzeConflicts(normalized.query, this.schema, { now: this.now() }));
    // Relative dates resolved in the implicit default timezone: say so on every such result.
    if (
      !this.config.timezoneExplicit &&
      normalized.query.context?.timezone === this.config.timezone &&
      usesRelativeDates(normalized.query)
    ) {
      warnings.push(
        createWarning('TIMEZONE_DEFAULTED', {
          message: 'No timezone was configured; relative dates use UTC.',
          messageKey: 'context.timezoneDefaulted',
        }),
      );
    }

    return {
      status: 'ok',
      query: normalized.query,
      mutations,
      explanation: explainQuery(normalized.query, this.schema),
      warnings,
      meta,
    };
  }

  /**
   * If every validation failure is an unknown enum value, keep the valid
   * mutations and turn each bad value into a `value` ambiguity whose options
   * are the field's real values. Returns `undefined` otherwise.
   */
  private enumValueAmbiguities(
    mutations: readonly Mutation[],
    issues: readonly PragmaIssue[],
  ): { kept: Mutation[]; ambiguities: Ambiguity[] } | undefined {
    if (issues.length === 0 || !issues.every((i) => i.messageKey === 'value.notInEnum'))
      return undefined;
    const kept: Mutation[] = [];
    const ambiguities: Ambiguity[] = [];
    mutations.forEach((mutation, index) => {
      const issue = issues.find((i) => i.path?.[0] === 'mutations' && i.path[1] === index);
      if (!issue) {
        const ok = validateMutations([mutation], this.schema).value;
        if (ok) kept.push(...ok);
        return;
      }
      if (
        mutation.op !== 'addFilter' ||
        mutation.node.type !== 'condition' ||
        issue.field === undefined
      )
        return;
      const node = mutation.node;
      const field = this.schema.fieldsById.get(issue.field);
      if (!field) return;
      const received =
        typeof issue.details?.['received'] === 'string' ? issue.details['received'] : '';
      ambiguities.push({
        id: this.ids('amb'),
        kind: 'value',
        message: `"${received}" is not a valid ${field.label}. Which value did you mean?`,
        messageKey: 'ambiguity.enumValue',
        params: { field: field.label, value: received },
        options: field.values.map((ev) => ({
          id: this.ids('opt'),
          label: ev.label ?? ev.value,
          mutations: [
            {
              op: 'addFilter',
              node: { ...node, operator: node.operator === 'neq' ? 'neq' : 'eq', value: ev.value },
            },
          ],
        })),
      });
    });
    return ambiguities.length > 0 ? { kept, ambiguities } : undefined;
  }

  /* --------------------------------- helpers -------------------------------- */

  private context(): { timezone: string; weekStartsOn: 0 | 1 } {
    return { timezone: this.config.timezone, weekStartsOn: this.config.weekStartsOn };
  }

  private timezoneOf(state: TableQuery): string {
    return state.context?.timezone ?? this.config.timezone;
  }

  private resolveState(input: unknown): { query: TableQuery } | { issues: readonly PragmaIssue[] } {
    if (input === undefined || input === null) return { query: this.initialQuery() };
    const parsed = parseTableQuery(input);
    if (!parsed.success)
      return {
        issues: parsed.issues.map((i) => ({ ...i, path: ['currentState', ...(i.path ?? [])] })),
      };
    const validated = validateQuery(parsed.data, this.schema, {
      limits: {
        maxConditions: this.config.limits.maxConditions,
        maxDepth: this.config.limits.maxDepth,
      },
    });
    if (!validated.value)
      return {
        issues: validated.issues.map((i) => ({ ...i, path: ['currentState', ...(i.path ?? [])] })),
      };
    return { query: validated.value };
  }

  /** Unknown `@references` are rejected locally, before any model call. */
  private checkMentions(text: string): Omit<UnsupportedResult, 'meta'> | undefined {
    const errors: PragmaIssue[] = [];
    const suggestions: Suggestion[] = [];
    for (const mention of findMentions(text)) {
      const resolved = resolveMention(this.schema, mention.text);
      if (resolved.kind === 'unknown') {
        const close = suggestFields(this.schema, mention.text);
        errors.push(
          createIssue('UNKNOWN_FIELD', {
            message: `Unknown field "@${mention.text}".`,
            messageKey: 'field.unknown',
            params: { field: mention.text, suggestions: close.map((f) => f.label) },
            field: mention.text,
          }),
        );
        suggestions.push(...close.map((f) => fieldSuggestion(f.id, f.label)));
      } else if (resolved.kind === 'unknownResource') {
        errors.push(
          createIssue('UNKNOWN_RESOURCE', {
            message: `"@${resolved.resource}" is not available here; this table is "${this.schema.label}".`,
            messageKey: 'resource.unknown',
            params: { resource: resolved.resource, expected: this.schema.label },
          }),
        );
      }
    }
    return errors.length > 0
      ? { status: 'unsupported', errors, suggestions: dedupeSuggestions(suggestions) }
      : undefined;
  }

  private unsupported(
    errors: readonly PragmaIssue[],
    suggestions: readonly Suggestion[],
    meta: ResultMeta,
  ): UnsupportedResult {
    const derived: Suggestion[] = [...suggestions];
    for (const issue of errors) {
      const fromDetails = issue.details?.['suggestions'];
      if (Array.isArray(fromDetails)) {
        for (const s of fromDetails as { id?: unknown; label?: unknown }[]) {
          if (typeof s.id === 'string' && typeof s.label === 'string')
            derived.push(fieldSuggestion(s.id, s.label));
        }
      }
      const allowed = issue.details?.['allowed'];
      if (issue.code === 'INVALID_OPERATOR' && Array.isArray(allowed)) {
        for (const op of allowed as unknown[])
          if (typeof op === 'string') derived.push({ kind: 'operator', label: op });
      }
    }
    return {
      status: 'unsupported',
      errors,
      suggestions: dedupeSuggestions(derived).slice(0, 10),
      meta,
    };
  }

  private errorResult(errors: readonly PragmaIssue[], meta: ResultMeta): ErrorResult {
    return { status: 'error', errors, meta };
  }

  private meta(
    requestId: string,
    parser: ParserKind,
    started: number,
    extra: Partial<ResultMeta> = {},
  ): ResultMeta {
    return {
      requestId,
      parser,
      latencyMs: Math.max(0, this.now() - started),
      schemaHash: this.schema.hash,
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      ...extra,
    };
  }

  private cacheKey(text: string, state: TableQuery): string {
    const tz = this.timezoneOf(state);
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(this.now()));
    return sha256(
      stableStringify({
        v: ENGINE_VERSION,
        s: this.schema.hash,
        q: canonicalizeQuery(state),
        i: text,
        a: this.config.ambiguity,
        m: this.config.mode,
        d: day,
      }),
    );
  }

  private async cacheGet(key: string, requestId: string): Promise<Proposal | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get(key);
    } catch {
      this.emit({ type: 'cache.error', requestId, operation: 'get' });
      return undefined;
    }
  }

  private async cacheSet(key: string, proposal: Proposal, requestId: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, proposal);
    } catch {
      this.emit({ type: 'cache.error', requestId, operation: 'set' });
    }
  }

  private async callModel(
    interpreter: ModelInterpreter,
    instruction: string,
    state: TableQuery,
    requestId: string,
    callerSignal: AbortSignal | undefined,
  ): Promise<ModelInterpretation | { issue: PragmaIssue }> {
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new DOMException('Model call timed out', 'TimeoutError'));
    }, this.config.timeoutMs);
    const signal = callerSignal ? anySignal([callerSignal, timeout.signal]) : timeout.signal;
    try {
      if (callerSignal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
      return await interpreter.interpret({
        instruction,
        schema: this.schema,
        state,
        now: this.now(),
        timezone: this.timezoneOf(state),
        ambiguity: this.config.ambiguity,
        requestId,
        signal,
        ids: this.ids,
      });
    } catch (error) {
      if (callerSignal?.aborted === true) {
        return {
          issue: createIssue('ABORTED', {
            message: 'The request was cancelled.',
            messageKey: 'error.ABORTED',
          }),
        };
      }
      if (timeout.signal.aborted) {
        return {
          issue: createIssue('TIMEOUT', {
            message: `The language model did not respond within ${this.config.timeoutMs} ms.`,
            messageKey: 'error.TIMEOUT',
            params: { timeoutMs: this.config.timeoutMs },
          }),
        };
      }
      return { issue: isPragmaError(error) ? error.toIssue() : toIssue(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private emit(event: EngineEvent): void {
    if (!this.options.onEvent) return;
    try {
      this.options.onEvent(event);
    } catch {
      // Observability must never break interpretation.
    }
  }

  private emitComplete(result: InterpretResult): void {
    this.emit({
      type: 'interpret.complete',
      requestId: result.meta.requestId,
      status: result.status,
      meta: result.meta,
      errorCodes: 'errors' in result ? result.errors.map((e) => e.code) : [],
      warningCodes: 'warnings' in result ? result.warnings.map((w) => w.code) : [],
      mutationCount: result.status === 'ok' ? result.mutations.length : 0,
    });
  }
}

function fieldSuggestion(id: string, label: string): Suggestion {
  return { kind: 'field', label, insertText: `@${id}`, field: id };
}

function dedupeSuggestions(suggestions: readonly Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.kind}|${s.field ?? s.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function usesRelativeDates(query: TableQuery): boolean {
  for (const c of iterateConditions(query.filter))
    if (RELATIVE_DATE_OPERATORS.has(c.operator)) return true;
  return false;
}

/** `AbortSignal.any` with a fallback for older runtimes. */
function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') return native([...signals]);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener(
      'abort',
      () => {
        controller.abort(s.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}
