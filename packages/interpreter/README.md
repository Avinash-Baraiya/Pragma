# @avinash-baraiya/pragma-interpreter

`createEngine` turns natural-language instructions into validated `TableQuery` results: a conservative deterministic parser first, a pluggable model interpreter for the rest, then validation, ambiguity handling, normalization and explanation.

```ts
import { createEngine, createModelInterpreter } from '@avinash-baraiya/pragma-interpreter';

const engine = createEngine({
  schema,
  timezone: 'Asia/Kolkata',
  interpreter: createModelInterpreter({ provider }),
});
const result = await engine.interpret('active customers older than 25, newest first', {
  currentState,
});
```

`interpret()` never rejects for runtime problems. It resolves to `ok`, `needs_clarification`, `unsupported` or `error`.

Docs: [architecture](https://pragma-docs.vercel.app/reference/architecture) · [models](https://pragma-docs.vercel.app/reference/llm) · [ambiguity](https://pragma-docs.vercel.app/reference/ambiguity)
