# Performance

## Bundle size

Measured with `size-limit` (minified and brotli-compressed, dependencies included) and enforced in CI:

| Bundle                                                                | Size    | Budget |
| --------------------------------------------------------------------- | ------- | ------ |
| `@avinash-baraiya/pragma-core`                                        | 39.7 kB | 44 kB  |
| `@avinash-baraiya/pragma-interpreter` (engine + deterministic parser) | 47.8 kB | 53 kB  |
| `@avinash-baraiya/pragma-providers/remote`                            | 25.5 kB | 28 kB  |
| `@avinash-baraiya/pragma-react` (excluding React)                     | 3.1 kB  | 4 kB   |
| `@avinash-baraiya/pragma-tanstack`                                    | 31.5 kB | 35 kB  |
| Full browser app (engine + remote + react + tanstack)                 | 60.8 kB | 67 kB  |

Most of core is Zod. Migrating the runtime schemas to `zod/mini` is tracked as a size optimization.

Model SDKs are never in the browser bundle: providers are imported from subpaths, and model calls go through the server.

## Latency

- `@` autocomplete, chip removal, clarification choices and table sorting and paging are synchronous and local (no network).
- The full local pipeline (deterministic parsing, validation, normalization, conflict analysis and explanation) measured about 0.9 ms at the median, 3.8 ms at p95 and 6.4 ms at p99 on the 106-case evaluation dataset (`pnpm eval`, Apple Silicon, Node 25). The evaluation reports the same percentiles for each model.
- Model calls dominate when they happen. Pragma avoids them where it can (deterministic parser, interpretation cache) and makes them cheaper where it can't: a cache-friendly prompt (about 97% of input tokens reusable from the provider's prompt cache for a 15-field schema) and a compact output budget. Timeouts, retries within the deadline and a circuit breaker bound the worst case. See [models](llm.md#cost-and-latency) for choosing a fast model.

## Execution

The reference executor (client mode) filters, sorts and paginates in memory, compiling predicates once per query. On 50,000 rows, a query with search, a nested OR filter with a relative date and a two-key sort took 8.2 ms median (23 ms worst of 12 runs; Apple Silicon, Node 25). It suits datasets up to tens of thousands of rows; beyond that, use server mode and execute in your database.
