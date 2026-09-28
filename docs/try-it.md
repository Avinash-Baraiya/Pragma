# Try Pragma in your own app (before publishing)

Test the real packages, exactly as users will install them, from a local npm registry.

## 1. Publish to the local registry

```bash
pnpm install
pnpm registry:start      # terminal 1: Verdaccio on http://127.0.0.1:4873
pnpm registry:publish    # terminal 2: builds and publishes 0.1.0-local.<timestamp>, dist-tag "local"
```

Repository versions are not changed. Re-run `registry:publish` after every change; each run gets a new version.

## 2. Create or open an app

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
echo "@avinash-baraiya:registry=http://127.0.0.1:4873/" > .npmrc
npm install @avinash-baraiya/pragma@local @tanstack/react-table
```

## 3. Minimal usage (browser only, no key)

```tsx
import { createEngine, defineSchema } from '@avinash-baraiya/pragma';
import { AskBar, QueryChips, PragmaProvider, usePragma } from '@avinash-baraiya/pragma/react';
import { usePragmaTable } from '@avinash-baraiya/pragma/tanstack/react';
import '@avinash-baraiya/pragma/styles.css';

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'employees',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
  ],
});
const engine = createEngine({ schema, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
```

Wrap your UI in `<PragmaProvider engine={engine}>`, render `<AskBar />` and `<QueryChips />`, and feed `usePragma().query` to `usePragmaTable` (or to your API). A complete version lives in the sibling `pragma-sample-app`.

## 4. Add a model for semantic phrasing (optional)

Explicit instructions work offline. For phrasing like "Indian customers" or "older than 40", run the server handler with a model and point the engine at it:

```ts
// server (keeps the key)
import { createPragmaHandler, toNodeHandler } from '@avinash-baraiya/pragma/server';
import { openAICompatible } from '@avinash-baraiya/pragma/providers/openai-compatible';
app.post(
  '/api/pragma',
  toNodeHandler(
    createPragmaHandler({
      schemas: { employees: schema },
      provider: openAICompatible({
        baseURL: process.env.OPENAI_BASE_URL!,
        model: process.env.OPENAI_MODEL!,
        apiKey: process.env.OPENAI_API_KEY,
      }),
    }),
  ),
);

// browser
import { remoteInterpreter } from '@avinash-baraiya/pragma/providers/remote';
const engine = createEngine({ schema, interpreter: remoteInterpreter({ url: '/api/pragma' }) });
```

For low latency, pick a small, fast model and measure it with `pnpm eval` (see [models](llm.md#cost-and-latency)).

## 5. Publishing to npm

See [releasing](releasing.md).
