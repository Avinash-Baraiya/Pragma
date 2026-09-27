# Integration

## 1. Define the schema (shared)

Put the schema in a module both browser and server import. See [schema](schema.md).

## 2. Mount the server handler

```ts
// Next.js: app/api/pragma/route.ts
import { createPragmaHandler } from '@pragma/server';
import { anthropic } from '@pragma/providers/anthropic';

export const POST = createPragmaHandler({
  schemas: { customers: customersSchema },
  provider: anthropic({ model: 'claude-opus-5' }), // or openAICompatible(...), aiSdk(...), customProvider(...)
  authorize: async ({ request }) => (await getSession(request)) !== null,
  rateLimit: ({ request }) => limiter.check(clientIp(request)),
  onError: (error, { requestId }) => logger.error({ err: error, requestId }),
});
```

- **Hono / Bun / Deno / Workers:** `app.post('/api/pragma', (c) => handler(c.req.raw))`.
- **Express / Node:** `app.post('/api/pragma', toNodeHandler(handler))`. Bodies already parsed by `express.json()` are reused.

The handler needs no model at all if you only want deterministic parsing on the server.

## 3. Create the browser engine

```ts
import { createEngine } from '@pragma/interpreter';
import { remoteInterpreter } from '@pragma/providers/remote';

export const engine = createEngine({
  schema: customersSchema,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ambiguity: 'ask',
  interpreter: remoteInterpreter({
    url: '/api/pragma',
    headers: () => ({ authorization: `Bearer ${token()}` }),
  }),
});
```

Instructions the deterministic parser fully understands never leave the browser. Everything else is sent to your server, and the answer is re-validated locally before it is applied.

## 4a. Client mode (data in the browser)

For datasets that fit in memory (thousands of rows):

```tsx
import { usePragmaTable } from '@pragma/tanstack/react';

const { table } = usePragmaTable({
  schema,
  query,
  onQueryChange: setQuery,
  data: allRows,
  columns,
});
```

Rows are filtered, sorted and paginated by the reference executor, and TanStack renders the page (controlled mode). Without TanStack, call `executeQuery(rows, query, { schema })` from `@pragma/core`.

If you prefer TanStack's own row models, use `withPragmaColumns(columns, schema)`, `pragmaGlobalFilterFn(schema)` and `toTanStackState(query)`. Results match the reference executor exactly (see [testing](testing.md)), except that per-query `nulls: 'first'` needs controlled mode.

## 4b. Server mode (large datasets)

Send the query to your API and execute it in your data layer:

```ts
const { query } = usePragma();
const page = useQuery({
  queryKey: ['customers', hashQuery(query)],
  queryFn: () => api.search(query),
});
const { table } = usePragmaTable({
  schema,
  query,
  onQueryChange: setQuery,
  mode: 'server',
  data: page.rows,
  rowCount: page.total,
  columns,
});
```

On the server:

1. `parseTableQuery(body)` and `validateQuery(query, schema)`, because payloads are untrusted.
2. `resolveDates(query, schema, { now: Date.now(), timezone: query.context?.timezone ?? 'UTC' })` for absolute date ranges.
3. Translate `filter`, `search`, `sort` and `pagination` into your query builder (ORM, SQL, Elasticsearch, …).
4. Implement the [operator semantics](operators.md), and prove it by running the conformance cases (`@pragma/conformance`) through your adapter.

For cursor pagination, return `{ nextCursor, prevCursor }` and pass it as `pageInfo` so "next page" works.

## 5. UI components

```tsx
<PragmaProvider engine={engine} onResult={track}>
  <AskBar /> {/* input + local @ autocomplete (ARIA combobox) */}
  <ClarificationPrompt /> {/* radio groups for ambiguous instructions */}
  <Feedback /> {/* why something couldn't be applied + suggestions */}
  <QueryChips /> {/* removable chips; removal is local */}
  <Explanation /> {/* "Interpreted as" + warnings, aria-live */}
</PragmaProvider>
```

Components are headless-first (semantic HTML with `data-pragma-*` hooks). Import `@pragma/react/styles.css` for themeable defaults; custom properties such as `--pragma-accent` control the look, and dark mode is supported. For fully custom UIs, use `usePragma()` and `useMentionAutocomplete()`.

## Controlled query

To persist the query (URL, storage, server state), control it:

```tsx
<PragmaProvider engine={engine} query={query} onQueryChange={setQuery}>
```
