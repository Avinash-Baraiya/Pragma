# @pragma/tanstack

TanStack Table adapter, verified row-for-row against the Pragma reference executor with the shared conformance suite.

- **Controlled mode (recommended):** `usePragmaTable` from `@pragma/tanstack/react`, or `executeForTable`. Pragma produces the page and TanStack renders it with `manual*` flags.
- **Native mode:** `withPragmaColumns`, `pragmaGlobalFilterFn` and `toTanStackState`, for TanStack row models with Pragma semantics.
- `fromTanStackState` folds header sorting and pager changes back into the query. `schemaFromColumns` derives a schema from `meta.pragma`.

Docs: [integration](../../docs/integration.md) · [operators](../../docs/operators.md)
