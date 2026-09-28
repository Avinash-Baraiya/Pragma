import { createEngine, createModelInterpreter } from '@avinash-baraiya/pragma-interpreter';
import { mock, mockProvider } from '@avinash-baraiya/pragma-providers/mock';
import { customersSchema } from '../../../../examples/tanstack-react/src/schema';

/**
 * The demos run entirely in the browser: GitHub Pages has no server and the
 * site must never hold an API key. Explicit instructions go through the real
 * deterministic parser; a small simulated model answers a few semantic
 * phrasings so the model path (and its validation) can be seen too.
 */
const simulatedModel = mockProvider({
  id: 'simulated-model',
  latencyMs: 350,
  rules: [
    { match: /\bindian\b/i, output: mock.output([mock.filter('country', 'eq', 'India')]) },
    {
      match: /high[- ]value|big (customers|accounts|spenders)|whales/i,
      output: mock.output([mock.filter('revenue', 'gte', 1_000_000), mock.sort('revenue', 'desc')]),
    },
    {
      match: /inactive lately|gone quiet|dormant/i,
      output: () =>
        mock.output([
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
    'The demo has no real model, so it only understands explicit instructions and a few sample phrases. Connect your own model to handle any phrasing.',
  ),
});

export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A fresh engine per demo keeps each demo's cache and state independent. */
export function createDemoEngine() {
  return createEngine({
    schema: customersSchema,
    timezone,
    ambiguity: 'ask',
    interpreter: createModelInterpreter({ provider: simulatedModel }),
  });
}

export const engine = createDemoEngine();

export { customersSchema };
