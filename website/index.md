---
layout: home

hero:
  name: Pragma
  text: Natural-language queries for data tables
  tagline: Your users type “active enterprise customers in India, newest first”. Pragma turns it into a validated search, filter, sort and pagination payload that any table, API or database can run.
  image:
    src: /logo.svg
    alt: Pragma
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /guide/playground
    - theme: alt
      text: GitHub
      link: https://github.com/Avinash-Baraiya/Pragma

features:
  - icon: 🧭
    title: One protocol, any table
    details: The TableQuery payload knows nothing about React, TanStack, SQL or model vendors. Adapters translate it; a TanStack Table adapter is included.
  - icon: ⚡
    title: Fast and local first
    details: A deterministic parser answers explicit instructions in the browser in about a millisecond. A model is only called for phrasing it cannot fully understand.
  - icon: 🛡️
    title: The model proposes, the engine decides
    details: Every field, operator and value is validated against your schema. Hidden fields cannot be reached, and row data is never sent to a model.
  - icon: 🔌
    title: Bring your own model
    details: OpenAI, Anthropic, Gemini, the Vercel AI SDK, Ollama or your own gateway. Keys stay on your server, with retries, fallbacks and a circuit breaker built in.
  - icon: 💬
    title: Asks instead of guessing
    details: “Recent customers” shows a clarification with ready-made options. Conflicts and impossible ranges come back as warnings, never silent fixes.
  - icon: ♿
    title: Accessible React UI
    details: An ask bar with local @ column autocomplete, removable query chips, plain-language explanations and feedback. Headless-first and themeable.
---

<div class="home-section">

## See it in action

<img class="home-shot" src="/screenshots/results.png" alt="The Pragma demo: an instruction typed into the ask bar, the resulting filter chips, and the filtered customer table." />

[Take the feature tour →](/guide/screenshots)

</div>

<div class="home-section">

## What goes in, what comes out

**In:** a typed schema of your table and the user's words.

```text
active enterprise customers, country is India, newest first, 50 per page
```

**Out:** a standard, validated `TableQuery` (answered locally, with no model call), plus a plain-language explanation and removable chips.

```json
{
  "version": "1.0",
  "resource": "customers",
  "search": null,
  "filter": {
    "type": "group",
    "id": "g_mxgdc8vx1r",
    "logic": "and",
    "children": [
      {
        "type": "condition",
        "id": "f_s442t341db",
        "field": "status",
        "operator": "eq",
        "value": "active"
      },
      {
        "type": "condition",
        "id": "f_5nfvvor6el",
        "field": "plan",
        "operator": "eq",
        "value": "enterprise"
      },
      {
        "type": "condition",
        "id": "f_jcfb6pfxxw",
        "field": "country",
        "operator": "eq",
        "value": "India"
      }
    ]
  },
  "sort": [{ "field": "createdAt", "direction": "desc" }],
  "pagination": { "type": "page", "page": 1, "pageSize": 50 },
  "context": { "timezone": "Asia/Kolkata", "weekStartsOn": 1 }
}
```

Feed it to TanStack Table in the browser, or send it to your API and run it in your database.

</div>

<div class="home-section">

## How it works

```text
schema + instruction (+ current state)
        │
        ▼
 deterministic parser ──(not fully understood)──▶ your model (server-side)
        │                                                  │
        └──────────────────────┬───────────────────────────┘
                               ▼
        validate · apply · normalize · analyze · explain
                               ▼
                    TableQuery  ─▶  TanStack · your API · SQL builder · …
```

1. **Understand.** The deterministic parser handles explicit instructions locally. Anything it cannot fully understand goes to your server, which asks the model you configured.
2. **Validate.** Every proposal, from the parser or a model, is checked against the schema: fields, operators, value types, limits and capabilities.
3. **Apply.** Changes are applied to the current query, so “now sort by revenue” keeps your filters and “remove the country filter” removes just that.
4. **Explain.** Chips, an explanation, warnings and clarification questions are generated from the validated query, so they always describe what will actually run.

[Read the guide →](/guide/introduction)

</div>
