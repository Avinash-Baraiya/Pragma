import type { LanguageModelProvider } from '@pragma/interpreter';
import { mock, mockProvider } from '@pragma/providers/mock';
import { openAICompatible } from '@pragma/providers/openai-compatible';
import { createPragmaHandler, type PragmaHandler } from '@pragma/server';
import { customersSchema } from '../src/schema.js';

/**
 * Server side of the demo. Model credentials live only here (read from the
 * environment) and never reach the browser.
 *
 * PRAGMA_PROVIDER = mock (default) | openai-compatible | anthropic
 */
export async function createDemoHandler(
  env: Record<string, string | undefined>,
): Promise<{ handler: PragmaHandler; provider: string }> {
  const provider = await selectProvider(env);
  const handler = createPragmaHandler({
    schemas: { customers: customersSchema },
    provider,
    engine: { ambiguity: 'ask', logInstructions: false },
    // Replace with your real session / API-gateway checks.
    authorize: () => true,
    onError: (error, { requestId }) => {
      console.error(`[pragma] ${requestId}`, error);
    },
  });
  return { handler, provider: provider.id };
}

async function selectProvider(
  env: Record<string, string | undefined>,
): Promise<LanguageModelProvider> {
  switch (env['PRAGMA_PROVIDER'] ?? 'mock') {
    case 'openai-compatible':
      return openAICompatible({
        baseURL: required(env, 'OPENAI_BASE_URL'),
        model: required(env, 'OPENAI_MODEL'),
        ...(env['OPENAI_API_KEY'] ? { apiKey: env['OPENAI_API_KEY'] } : {}),
      });
    case 'anthropic': {
      // Loaded lazily so the demo runs without the optional SDK installed.
      const { anthropic } = await import('@pragma/providers/anthropic');
      return anthropic({
        model: env['ANTHROPIC_MODEL'] ?? 'claude-opus-5',
        ...(env['ANTHROPIC_API_KEY'] ? { apiKey: env['ANTHROPIC_API_KEY'] } : {}),
      });
    }
    case 'mock':
      return demoMockProvider();
    default:
      throw new Error(`Unknown PRAGMA_PROVIDER "${env['PRAGMA_PROVIDER'] ?? ''}".`);
  }
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for this provider.`);
  return value;
}

/**
 * Offline stand-in for a language model: answers a few phrasings the
 * deterministic parser deliberately leaves to a model, so the full
 * browser → server → model → validation path can be tried without an API key.
 */
function demoMockProvider(): LanguageModelProvider {
  return mockProvider({
    latencyMs: 400,
    rules: [
      { match: /\bindian\b/i, output: mock.output([mock.filter('country', 'eq', 'India')]) },
      {
        match: /high[- ]value|big (customers|accounts)|whales/i,
        output: mock.output([
          mock.filter('revenue', 'gte', 1_000_000),
          mock.sort('revenue', 'desc'),
        ]),
      },
      {
        match: /inactive lately|gone quiet|dormant/i,
        output: mock.output([
          mock.filter(
            'lastActiveAt',
            'before',
            new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
          ),
        ]),
      },
      {
        match: /profit/i,
        output: mock.unsupported('There is no profit field; profit would need revenue and cost.', [
          'revenue',
        ]),
      },
    ],
    fallback: mock.unsupported(
      'The demo mock model only understands a few phrases. Set PRAGMA_PROVIDER to use a real model.',
    ),
  });
}
