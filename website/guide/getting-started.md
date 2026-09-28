# Getting started

This page sets up Pragma in a React app with TanStack Table, entirely in the browser and without a model. [Adding an AI model](./ai-models) is a separate, optional step.

## Requirements

- Node.js 22.12 or later for tooling and servers
- React 18 or 19 for the React components
- TanStack Table v9 for the table adapter (or bring your own table)
- TypeScript is optional but recommended; every package ships its own types

## 1. Install

::: code-group

```bash [npm]
npm install @avinash-baraiya/pragma @tanstack/react-table
```

```bash [pnpm]
pnpm add @avinash-baraiya/pragma @tanstack/react-table
```

```bash [yarn]
yarn add @avinash-baraiya/pragma @tanstack/react-table
```

:::

One package gives you everything, imported by subpath (`/react`, `/tanstack/react`, `/server`, `/providers/…`), so only what you import reaches your bundle. It is ESM and CommonJS, and tree-shakeable. Leave out `@tanstack/react-table` if you render your own table.

::: details Prefer individual packages?
The same code is also published as `@avinash-baraiya/pragma-core`, `-interpreter`, `-react`, `-tanstack`, `-server` and `-providers`. Replace `@avinash-baraiya/pragma/react` with `@avinash-baraiya/pragma-react`, and so on.
:::

## 2. Describe your table

The schema is the contract: only fields listed here can be queried, and only in the ways their type allows. Share this module between browser and server.

```ts
// schema.ts
import { defineSchema } from '@avinash-baraiya/pragma';

export const customersSchema = defineSchema({
  schemaVersion: '1',
  resource: 'customers',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'country', label: 'Country', type: 'string', aliases: ['nation'] },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'churned', label: 'Churned', aliases: ['cancelled', 'lost'] },
      ],
    },
    { id: 'revenue', label: 'Revenue', type: 'number', format: 'currency', currency: 'INR' },
    { id: 'createdAt', label: 'Signed Up', type: 'datetime', aliases: ['joined'] },
    { id: 'internalNotes', label: 'Internal Notes', type: 'string', hidden: true },
  ],
  defaults: { pageSize: 20, recencyField: 'createdAt' },
});
```

`defineSchema` checks the schema itself when your app starts (duplicate ids, alias collisions, enums without values…) and throws a clear error if something is wrong. See the [schema reference](/reference/schema).

## 3. Create the engine

```ts
// engine.ts
import { createEngine } from '@avinash-baraiya/pragma';
import { customersSchema } from './schema';

export const engine = createEngine({
  schema: customersSchema,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ambiguity: 'ask', // or 'bestGuess'
});
```

Without a model, the engine understands explicit instructions and answers anything else with a clear “not understood” result and suggestions.

## 4. Add the UI and the table

```tsx
// Customers.tsx
import {
  AskBar,
  ClarificationPrompt,
  Explanation,
  Feedback,
  PragmaProvider,
  QueryChips,
  usePragma,
} from '@avinash-baraiya/pragma/react';
import { usePragmaTable } from '@avinash-baraiya/pragma/tanstack/react';
import '@avinash-baraiya/pragma/styles.css'; // optional default styles
import { engine } from './engine';
import { customersSchema } from './schema';

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'country', header: 'Country' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'revenue', header: 'Revenue' },
  { accessorKey: 'createdAt', header: 'Signed Up' },
];

export function CustomersPage({ rows }: { rows: Customer[] }) {
  return (
    <PragmaProvider engine={engine}>
      <AskBar />
      <ClarificationPrompt />
      <Feedback />
      <QueryChips />
      <Explanation />
      <CustomersTable rows={rows} />
    </PragmaProvider>
  );
}

function CustomersTable({ rows }: { rows: Customer[] }) {
  const { query, setQuery } = usePragma();
  const { table } = usePragmaTable<Customer>({
    schema: customersSchema,
    query,
    onQueryChange: setQuery, // header clicks and paging flow back into the query
    data: rows,
    columns,
  });
  return <YourTableMarkup table={table} />;
}
```

Keep `engine`, `columns` and `rows` stable (module-level or memoized): both Pragma and TanStack rely on stable references.

Try it: type `status is active, sort by revenue desc`, or type `@` to pick a column.

## 5. Or send the query to your backend

For large datasets, don't filter in the browser. Send `query` to your API and execute it there:

```ts
const { query } = usePragma();
const rows = await fetch('/api/customers/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(query),
}).then((r) => r.json());
```

On the server, validate the payload again with `parseTableQuery` and `validateQuery` from `@avinash-baraiya/pragma`, and use `resolveDates` to turn relative dates (“last 30 days”) into absolute ranges for your database. See [integration](/reference/integration).

## Next steps

- [Add an AI model](./ai-models) so users can type anything, not only explicit instructions.
- Try the [playground](./playground).
- Learn the exact [operator semantics](/reference/operators) and [error codes](/reference/errors).
