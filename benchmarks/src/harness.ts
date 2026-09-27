import { readFileSync } from 'node:fs';
import type { InterpretResult, TableQuery } from '@avinash-baraiya/pragma-core';
import type { Engine } from '@avinash-baraiya/pragma-interpreter';

/**
 * How an instruction is expected to be handled:
 * - `deterministic`: the deterministic parser must produce exactly the expected result;
 * - `model`: needs semantic interpretation; the deterministic parser must NOT claim it;
 * - `refuse`: must never produce a query (unsupported / adversarial), whatever the model says.
 */
export type Route = 'deterministic' | 'model' | 'refuse';

export interface Expectation {
  readonly status: InterpretResult['status'];
  /** Expected explanation lines (filters, search and sort; pagination only when listed). */
  readonly explanation?: readonly string[];
  readonly ambiguityKind?: string;
  readonly errorCode?: string;
  readonly warnings?: readonly string[];
}

export interface EvalCase {
  readonly id: string;
  readonly category: string;
  readonly route: Route;
  readonly state?: 'initial' | 'filtered';
  readonly instruction: string;
  readonly expect: Expectation;
}

export interface CaseOutcome {
  readonly case: EvalCase;
  readonly result: InterpretResult;
  readonly statusMatch: boolean;
  readonly exactMatch: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

export function loadCases(url: URL): EvalCase[] {
  return readFileSync(url, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvalCase;
      } catch (error) {
        throw new Error(`Invalid JSON on dataset line ${index + 1}: ${(error as Error).message}`, {
          cause: error,
        });
      }
    });
}

/** A realistic mid-session state: filtered, sorted and on page 3. */
export function filteredState(engine: Engine): TableQuery {
  const initial = engine.initialQuery();
  return {
    ...initial,
    filter: {
      type: 'group',
      id: 'g_state',
      logic: 'and',
      children: [
        { type: 'condition', id: 'f_country', field: 'country', operator: 'eq', value: 'India' },
        { type: 'condition', id: 'f_status', field: 'status', operator: 'eq', value: 'active' },
      ],
    },
    sort: [{ field: 'revenue', direction: 'desc' }],
    pagination: { type: 'page', page: 3, pageSize: 20 },
  };
}

function explanationLines(result: InterpretResult, includePagination: boolean): string[] {
  if (result.status !== 'ok') return [];
  return result.explanation
    .filter((e) => includePagination || e.kind !== 'pagination')
    .map((e) => e.text);
}

export async function evaluate(engine: Engine, testCase: EvalCase): Promise<CaseOutcome> {
  const started = performance.now();
  const currentState = testCase.state === 'filtered' ? filteredState(engine) : undefined;
  const result = await engine.interpret(testCase.instruction, currentState ? { currentState } : {});
  const latencyMs = performance.now() - started;
  const e = testCase.expect;
  const statusMatch = result.status === e.status;
  const problems: string[] = [];
  if (!statusMatch) problems.push(`status ${result.status} ≠ ${e.status}`);

  if (statusMatch && e.explanation) {
    const includePagination = e.explanation.some((line) => /per page|^Rows /.test(line));
    const actual = explanationLines(result, includePagination);
    if (JSON.stringify(actual) !== JSON.stringify(e.explanation))
      problems.push(`explanation ${JSON.stringify(actual)}`);
  }
  if (statusMatch && e.ambiguityKind && result.status === 'needs_clarification') {
    const kinds = result.ambiguities.map((a) => a.kind);
    if (!kinds.includes(e.ambiguityKind as never))
      problems.push(`ambiguity kinds ${JSON.stringify(kinds)}`);
  }
  if (
    statusMatch &&
    e.errorCode &&
    (result.status === 'unsupported' || result.status === 'error')
  ) {
    const codes = result.errors.map((x) => x.code);
    if (!codes.includes(e.errorCode as never))
      problems.push(`error codes ${JSON.stringify(codes)}`);
  }
  if (statusMatch && e.warnings && result.status === 'ok') {
    const codes = result.warnings.map((w) => w.code);
    for (const w of e.warnings)
      if (!codes.includes(w as never)) problems.push(`missing warning ${w}`);
  }
  return {
    case: testCase,
    result,
    statusMatch,
    exactMatch: problems.length === 0,
    latencyMs,
    detail: problems.join('; '),
  };
}

/* --------------------------------- metrics -------------------------------- */

export interface Metrics {
  readonly cases: number;
  readonly exactMatchRate: number;
  readonly statusAccuracy: number;
  /** Share of ambiguous cases for which the engine asked. */
  readonly ambiguityRecall: number;
  /** Share of refuse-route cases that did not produce a query. */
  readonly refusalRate: number;
  /** Share of all cases answered without a model call. */
  readonly deterministicCoverage: number;
  readonly latency: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly tokens: { readonly input: number; readonly output: number };
  readonly byCategory: Readonly<Record<string, { cases: number; exact: number }>>;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

export function summarize(outcomes: readonly CaseOutcome[]): Metrics {
  const n = outcomes.length || 1;
  const ambiguous = outcomes.filter((o) => o.case.expect.status === 'needs_clarification');
  const refuse = outcomes.filter((o) => o.case.route === 'refuse');
  const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
  const byCategory: Record<string, { cases: number; exact: number }> = {};
  let input = 0;
  let output = 0;
  for (const o of outcomes) {
    const bucket = (byCategory[o.case.category] ??= { cases: 0, exact: 0 });
    bucket.cases++;
    if (o.exactMatch) bucket.exact++;
    input += o.result.meta.usage?.inputTokens ?? 0;
    output += o.result.meta.usage?.outputTokens ?? 0;
  }
  return {
    cases: outcomes.length,
    exactMatchRate: outcomes.filter((o) => o.exactMatch).length / n,
    statusAccuracy: outcomes.filter((o) => o.statusMatch).length / n,
    ambiguityRecall:
      ambiguous.length === 0
        ? 1
        : ambiguous.filter((o) => o.result.status === 'needs_clarification').length /
          ambiguous.length,
    refusalRate:
      refuse.length === 0
        ? 1
        : refuse.filter((o) => o.result.status !== 'ok').length / refuse.length,
    deterministicCoverage: outcomes.filter((o) => o.result.meta.parser !== 'llm').length / n,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    tokens: { input, output },
    byCategory,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const ms = (x: number): string => `${x.toFixed(x < 10 ? 2 : 0)} ms`;

export function renderReport(
  title: string,
  metrics: Metrics,
  outcomes: readonly CaseOutcome[],
): string {
  const lines = [
    `# ${title}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Cases | ${metrics.cases} |`,
    `| Exact match | ${pct(metrics.exactMatchRate)} |`,
    `| Status accuracy | ${pct(metrics.statusAccuracy)} |`,
    `| Ambiguity recall | ${pct(metrics.ambiguityRecall)} |`,
    `| Refusal rate (unsupported/adversarial) | ${pct(metrics.refusalRate)} |`,
    `| Answered without a model | ${pct(metrics.deterministicCoverage)} |`,
    `| Latency p50 / p95 / p99 | ${ms(metrics.latency.p50)} / ${ms(metrics.latency.p95)} / ${ms(metrics.latency.p99)} |`,
    `| Tokens in / out | ${metrics.tokens.input} / ${metrics.tokens.output} |`,
    '',
    '| Category | Exact / Cases |',
    '| --- | --- |',
    ...Object.entries(metrics.byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, b]) => `| ${category} | ${b.exact} / ${b.cases} |`),
  ];
  const misses = outcomes.filter((o) => !o.exactMatch);
  if (misses.length > 0) {
    lines.push('', '## Mismatches', '', '| Case | Instruction | Detail |', '| --- | --- | --- |');
    for (const o of misses)
      lines.push(
        `| ${o.case.id} | ${o.case.instruction.replace(/\|/g, '\\|')} | ${o.detail.replace(/\|/g, '\\|')} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}
