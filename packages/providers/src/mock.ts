import type { GenerateRequest, GenerateResponse, LanguageModelProvider } from '@pragma/interpreter';

/** Model-output JSON (the flat format documented by MODEL_OUTPUT_JSON_SCHEMA). @public */
export interface MockOutput {
  readonly actions: readonly Record<string, unknown>[];
  readonly ambiguities: readonly Record<string, unknown>[];
  readonly unsupported: {
    readonly reason: string;
    readonly suggestedFields: readonly string[];
  } | null;
}

/** @public */
export interface MockRule {
  /** Matched against the instruction text (case-insensitive for strings). */
  readonly match: RegExp | string | ((instruction: string) => boolean);
  readonly output: MockOutput | ((instruction: string) => MockOutput);
}

/** @public */
export interface MockProviderOptions {
  readonly rules?: readonly MockRule[];
  /** Output when no rule matches. Default: an `unsupported` answer. */
  readonly fallback?: MockOutput | ((instruction: string) => MockOutput);
  /** Simulated latency in ms. Default 0. */
  readonly latencyMs?: number;
  readonly id?: string;
}

const NULL_ACTION = {
  filter: null,
  logic: null,
  field: null,
  filterId: null,
  sort: null,
  search: null,
  page: null,
  pageSize: null,
};

/** Helpers for building mock outputs without writing the full JSON shape. @public */
export const mock = {
  output(actions: readonly Record<string, unknown>[], extra: Partial<MockOutput> = {}): MockOutput {
    return { actions, ambiguities: [], unsupported: null, ...extra };
  },
  filter(
    field: string,
    operator: string,
    value: unknown = null,
    logic: 'and' | 'or' | null = null,
  ): Record<string, unknown> {
    return {
      ...NULL_ACTION,
      op: 'addFilter',
      logic,
      filter: {
        field,
        operator,
        value,
        caseSensitive: null,
        logic: null,
        not: null,
        conditions: null,
      },
    };
  },
  anyOf(conditions: readonly [string, string, unknown][]): Record<string, unknown> {
    return {
      ...NULL_ACTION,
      op: 'addFilter',
      filter: {
        field: null,
        operator: null,
        value: null,
        caseSensitive: null,
        logic: 'or',
        not: null,
        conditions: conditions.map(([field, operator, value]) => ({
          field,
          operator,
          value,
          caseSensitive: null,
        })),
      },
    };
  },
  sort(field: string, direction: 'asc' | 'desc'): Record<string, unknown> {
    return { ...NULL_ACTION, op: 'setSort', sort: [{ field, direction }] };
  },
  search(query: string): Record<string, unknown> {
    return { ...NULL_ACTION, op: 'setSearch', search: { query, fields: null } };
  },
  pageSize(size: number): Record<string, unknown> {
    return { ...NULL_ACTION, op: 'setPageSize', pageSize: size };
  },
  unsupported(reason: string, suggestedFields: readonly string[] = []): MockOutput {
    return { actions: [], ambiguities: [], unsupported: { reason, suggestedFields } };
  },
} as const;

/** Extract the instruction from the fenced user message built by the interpreter. @internal */
export function instructionOf(request: GenerateRequest): string {
  const first = request.messages[0]?.content ?? '';
  const m = /<instruction>\n?([\s\S]*?)\n?<\/instruction>/.exec(first);
  return (m?.[1] ?? first).trim();
}

/**
 * Deterministic, offline provider for tests, demos and CI. Rules are tried in
 * order; the first match answers.
 *
 * @public
 */
export function mockProvider(
  options: MockProviderOptions = {},
): LanguageModelProvider & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    id: options.id ?? 'mock',
    calls,
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const instruction = instructionOf(request);
      calls.push(instruction);
      if (options.latencyMs !== undefined && options.latencyMs > 0)
        await delay(options.latencyMs, request.signal);
      const rule = options.rules?.find((r) => matches(r.match, instruction));
      const chosen =
        rule?.output ??
        options.fallback ??
        mock.unsupported('The mock model has no answer for this instruction.');
      const output = typeof chosen === 'function' ? chosen(instruction) : chosen;
      return {
        json: output,
        model: 'mock',
        usage: {
          inputTokens: Math.ceil(request.system.length / 4),
          outputTokens: Math.ceil(JSON.stringify(output).length / 4),
        },
      };
    },
  };
}

function matches(match: MockRule['match'], instruction: string): boolean {
  if (typeof match === 'function') return match(instruction);
  if (typeof match === 'string') return instruction.toLowerCase().includes(match.toLowerCase());
  return match.test(instruction);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
