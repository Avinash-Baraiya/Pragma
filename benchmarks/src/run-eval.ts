/**
 * Evaluate an interpreter configuration on the labelled dataset.
 *
 *   pnpm eval                                   # deterministic parser only (no model)
 *   pnpm eval --provider=openai-compatible      # OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY
 *   pnpm eval --provider=anthropic              # ANTHROPIC_MODEL, ANTHROPIC_API_KEY
 *   pnpm eval --only=model,dates --out=reports/run.md
 *
 * Model runs spend real tokens; the report lists token usage.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createEngine,
  createModelInterpreter,
  type LanguageModelProvider,
} from '@avinash-baraiya/pragma-interpreter';
import { evaluate, loadCases, renderReport, summarize, type CaseOutcome } from './harness.js';
import { customersSchema } from './schema.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function providerFor(name: string): Promise<LanguageModelProvider | undefined> {
  const env = process.env;
  switch (name) {
    case 'deterministic':
      return undefined;
    case 'openai-compatible': {
      const { openAICompatible } =
        await import('@avinash-baraiya/pragma-providers/openai-compatible');
      if (!env['OPENAI_BASE_URL'] || !env['OPENAI_MODEL'])
        throw new Error('Set OPENAI_BASE_URL and OPENAI_MODEL.');
      return openAICompatible({
        baseURL: env['OPENAI_BASE_URL'],
        model: env['OPENAI_MODEL'],
        ...(env['OPENAI_API_KEY'] ? { apiKey: env['OPENAI_API_KEY'] } : {}),
      });
    }
    case 'anthropic': {
      const { anthropic } = await import('@avinash-baraiya/pragma-providers/anthropic');
      return anthropic({
        model: env['ANTHROPIC_MODEL'] ?? 'claude-opus-5',
        ...(env['ANTHROPIC_API_KEY'] ? { apiKey: env['ANTHROPIC_API_KEY'] } : {}),
      });
    }
    default:
      throw new Error(
        `Unknown provider "${name}". Use deterministic, openai-compatible or anthropic.`,
      );
  }
}

async function main(): Promise<void> {
  const providerName = arg('provider') ?? 'deterministic';
  const only = arg('only')?.split(',');
  const out = arg('out');
  const concurrency = Math.max(1, Number(arg('concurrency') ?? 4));

  const provider = await providerFor(providerName);
  const cases = loadCases(new URL('../dataset/customers.jsonl', import.meta.url)).filter(
    (c) => !only || only.includes(c.category),
  );
  const NOW = Date.UTC(2024, 5, 15, 12);
  const engine = createEngine({
    schema: customersSchema,
    timezone: 'UTC',
    now: () => NOW,
    cache: false,
    ...(provider
      ? { interpreter: createModelInterpreter({ provider }), timeoutMs: 60_000 }
      : { mode: 'deterministic-only' as const }),
  });

  const outcomes: CaseOutcome[] = new Array(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      while (next < cases.length) {
        const index = next++;
        outcomes[index] = await evaluate(engine, cases[index]!);
        process.stderr.write(outcomes[index].exactMatch ? '.' : 'x');
      }
    }),
  );
  process.stderr.write('\n');

  const title = `Pragma evaluation · ${providerName}${provider ? ` (${provider.id})` : ''} · ${new Date().toISOString().slice(0, 10)}`;
  const report = renderReport(title, summarize(outcomes), outcomes);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, report);
    process.stderr.write(`Report written to ${out}\n`);
  }
  process.stdout.write(report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
