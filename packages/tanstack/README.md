# @avinash-baraiya/pragma-tanstack

TanStack Table adapter, verified row-for-row against the Pragma reference executor with the shared conformance suite.

- **Controlled mode (recommended):** `usePragmaTable` from `@avinash-baraiya/pragma-tanstack/react`, or `executeForTable`. Pragma produces the page and TanStack renders it with `manual*` flags.
- **Native mode:** `withPragmaColumns`, `pragmaGlobalFilterFn` and `toTanStackState`, for TanStack row models with Pragma semantics.
- `fromTanStackState` folds header sorting and pager changes back into the query. `schemaFromColumns` derives a schema from `meta.pragma`.

Docs: [integration](https://pragma-docs.vercel.app/reference/integration) · [operators](https://pragma-docs.vercel.app/reference/operators)
