# Testing

```bash
pnpm test            # everything
pnpm test:coverage   # with enforced thresholds (core and interpreter ≥ 95% lines)
pnpm eval            # evaluation report
```

## Layers

| Layer               | What it proves                                                                                                                                                                                                                    | Where                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Unit                | Every module in isolation: schema rules, validator coercion, mutations, normalizer, date math (DST included), executor, mentions, parser grammar (140+ phrases), providers against recorded HTTP responses, server status mapping | `packages/*/src/**/*.test.ts`                                      |
| Property-based      | For **any** input (grammar-shaped, arbitrary Unicode, multi-step sessions, arbitrary or plausible-but-wrong model JSON), `interpret()` never throws, `ok` queries are valid, and nothing references a hidden or unknown field     | `packages/interpreter/src/robustness.test.ts`, core property tests |
| Adversarial         | Prompt injection against a model that obeys it; nothing escapes the schema                                                                                                                                                        | robustness suite, benchmark `adversarial` cases                    |
| Adapter conformance | Adapters reproduce the reference executor's rows **and order** exactly                                                                                                                                                            | `@pragma/conformance`, `packages/tanstack/src/conformance.test.ts` |
| Integration         | Real SDKs over stubbed transports (Anthropic SDK, AI SDK `generateText`), a real `node:http` server, React components with user-event and axe accessibility checks                                                                | providers, server, react tests                                     |
| Evaluation gate     | Labelled dataset: deterministic cases must match exactly; semantic, unsupported and adversarial cases must be declined without a model                                                                                            | `benchmarks/`                                                      |

## Adapter conformance

`@pragma/conformance` provides a seeded 120-row dataset (nulls, mixed case, Unicode, ties, dates near timezone boundaries) and 49 named queries covering every operator, nested AND/OR/NOT groups, search, multi-key sorting with nulls, and page/offset pagination. To certify a new adapter (SQL builder, Elasticsearch, AG Grid, …):

```ts
import { conformanceCases, conformanceDataset, referenceIds } from '@pragma/conformance';

for (const testCase of conformanceCases) {
  it(testCase.name, async () => {
    expect(await myAdapter(conformanceDataset, testCase.query)).toEqual(referenceIds(testCase));
  });
}
```

## Evaluation

`benchmarks/dataset/customers.jsonl` holds labelled instructions with their expected status, explanation, ambiguity kind or error code, and a route:

- `deterministic` — the parser must match exactly;
- `model` — needs semantic understanding; the parser must decline;
- `refuse` — unsupported or adversarial; nothing may produce a query.

Add a case for every bug you fix and every phrasing users report.
