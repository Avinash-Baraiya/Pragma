# @avinash-baraiya/pragma-core

Schema model, the `TableQuery` protocol, operators, validation, normalization, timezone-aware date semantics, deterministic explanations, `@`-mention autocomplete and the reference executor. No framework or model-vendor dependencies.

```ts
import {
  defineSchema,
  parseTableQuery,
  validateQuery,
  executeQuery,
  resolveDates,
} from '@avinash-baraiya/pragma-core';
```

- `defineSchema(schema)`: validate a schema once, at startup
- `parseTableQuery` / `validateQuery`: check untrusted payloads
- `applyMutations`, `normalizeQuery`, `analyzeConflicts`, `explainQuery`
- `executeQuery(rows, query, { schema })`: reference in-memory execution
- `resolveDates(query, schema, { now, timezone })`: absolute ranges for backends
- `suggestMentions`, `resolveMention`: local `@` autocomplete

Docs: [protocol](https://pragma-docs.vercel.app/reference/protocol) · [schema](https://pragma-docs.vercel.app/reference/schema) · [operators](https://pragma-docs.vercel.app/reference/operators) · [errors](https://pragma-docs.vercel.app/reference/errors)
