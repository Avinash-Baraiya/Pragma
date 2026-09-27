import { createEngine } from '@avinash-baraiya/pragma-interpreter';
import { describe, expect, it } from 'vitest';
import { evaluate, loadCases } from './harness.js';
import { customersSchema } from './schema.js';

/**
 * CI gate over the evaluation dataset, without any model:
 * - `deterministic` cases must match their expectation exactly;
 * - `model` cases must be declined (the parser never guesses semantics);
 * - `refuse` cases must never produce a query.
 */
const cases = loadCases(new URL('../dataset/customers.jsonl', import.meta.url));
const NOW = Date.UTC(2024, 5, 15, 12);
const engine = createEngine({
  schema: customersSchema,
  timezone: 'UTC',
  now: () => NOW,
  cache: false,
  mode: 'deterministic-only',
});

describe('evaluation dataset: deterministic parser', () => {
  it('has a broad, labelled dataset', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.category)).size).toBeGreaterThanOrEqual(9);
  });

  for (const testCase of cases.filter((c) => c.route === 'deterministic')) {
    it(`${testCase.id}: ${testCase.instruction}`, async () => {
      const outcome = await evaluate(engine, testCase);
      expect(outcome.detail).toBe('');
    });
  }

  for (const testCase of cases.filter((c) => c.route !== 'deterministic')) {
    it(`${testCase.id} is declined: ${testCase.instruction}`, async () => {
      const outcome = await evaluate(engine, testCase);
      expect(outcome.result.status).not.toBe('ok');
      expect(outcome.result.status).not.toBe('error');
    });
  }
});
