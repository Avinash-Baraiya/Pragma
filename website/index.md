---
layout: home
title: Pragma
titleTemplate: Natural-language queries for data tables
---

<HomeHero />

<HomeSections />

<section class="hs">
<header class="hs__head">
<p class="hs__kicker">Quick start</p>
<h2>From install to first query in minutes.</h2>
<p>Describe your table once. Drop in the ask bar. Feed the query to your table or your API.</p>
</header>

<div class="vp-doc home-code">

::: code-group

```tsx [App.tsx]
import { createEngine, defineSchema } from '@avinash-baraiya/pragma';
import { AskBar, PragmaProvider, QueryChips } from '@avinash-baraiya/pragma/react';
import '@avinash-baraiya/pragma/styles.css';

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'customers',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'country', label: 'Country', type: 'string' },
    { id: 'revenue', label: 'Revenue', type: 'number' },
    { id: 'createdAt', label: 'Signed up', type: 'datetime' },
  ],
});

const engine = createEngine({ schema });

export function App() {
  return (
    <PragmaProvider engine={engine}>
      <AskBar />
      <QueryChips />
      <CustomersTable /> {/* reads usePragma().query */}
    </PragmaProvider>
  );
}
```

```ts [Server (optional model)]
// app/api/pragma/route.ts: only needed for free phrasing. Keys stay here.
import { createPragmaHandler } from '@avinash-baraiya/pragma/server';
import { gemini } from '@avinash-baraiya/pragma/providers/gemini';

export const POST = createPragmaHandler({
  schemas: { customers: schema },
  provider: gemini({ model: 'gemini-3.5-flash-lite', apiKey: process.env.GEMINI_API_KEY! }),
});
```

```json [Output: TableQuery]
{
  "version": "1.0",
  "resource": "customers",
  "search": null,
  "filter": {
    "type": "group",
    "logic": "and",
    "children": [
      { "type": "condition", "field": "country", "operator": "eq", "value": "India" },
      {
        "type": "condition",
        "field": "createdAt",
        "operator": "last",
        "value": { "amount": 30, "unit": "day" }
      }
    ]
  },
  "sort": [{ "field": "revenue", "direction": "desc" }],
  "pagination": { "type": "page", "page": 1, "pageSize": 20 }
}
```

:::

</div>
</section>

<section class="hs hs--cta">
<h2>Try it before you install it.</h2>
<p>The playground runs the real engine on 500 sample customers, right in your browser.</p>
<div class="hh__actions">
<a class="hh__btn hh__btn--brand" href="./guide/playground">Open the playground</a>
<a class="hh__btn" href="./guide/getting-started">Read the guide</a>
</div>
</section>
