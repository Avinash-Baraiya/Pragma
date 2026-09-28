# What is Pragma?

<p class="lead">Pragma is a natural-language query layer for data tables. Describe your table once; your users type what they want to see; Pragma returns a validated, library-agnostic <code>TableQuery</code> (search, filters, sort and pagination) that any table, API or database can run.</p>

![Pragma answering an instruction: filter chips, an explanation and the filtered table](/screenshots/results.png)

## The problem

Every table library has its own state model for search, filtering, sorting and paging. Turning “enterprise customers in India who joined this year, biggest first” into that state means hand-written translation code, and asking a language model to do it directly gives you output you cannot trust: invented fields, wrong operators, values in the wrong format, or fields users were never meant to see.

## The approach

**Natural language is an input, not the source of truth.** The source of truth is a typed query checked against your schema.

<div class="cards">
  <div><strong>The model proposes; the engine decides</strong><span>Parsers and models only propose changes. Every field, operator and value is validated before anything is applied.</span></div>
  <div><strong>Local first</strong><span>Explicit instructions are answered in the browser in about a millisecond. A model is called only for what the parser can't fully understand.</span></div>
  <div><strong>Safe by construction</strong><span>Hidden fields behave like fields that don't exist. Model output can never widen the schema. Row data never reaches a model.</span></div>
  <div><strong>Stateful</strong><span>“Now sort by revenue” keeps your filters. “Remove the country filter” removes only that one.</span></div>
  <div><strong>Asks, never guesses</strong><span>Ambiguous requests return a question with ready-made options. Impossible combinations return warnings.</span></div>
  <div><strong>Always explained</strong><span>Chips and explanations are generated from the validated query, so they always match what runs.</span></div>
</div>

## Packages

Most apps install one package and import by subpath:

```bash
npm install @avinash-baraiya/pragma
```

| Import path                      | What you get                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@avinash-baraiya/pragma`        | `defineSchema`, `createEngine`, the `TableQuery` protocol, validation, dates                              |
| `…/react`                        | Accessible `AskBar` with `@` autocomplete, `QueryChips`, `Explanation`, `ClarificationPrompt`, `Feedback` |
| `…/tanstack`, `…/tanstack/react` | TanStack Table v9 adapter and the `usePragmaTable` hook                                                   |
| `…/server`                       | Web-standard HTTP handler plus a Node/Express adapter; keeps model keys on the server                     |
| `…/providers/<name>`             | `openai-compatible`, `anthropic`, `gemini`, `ai-sdk`, `mock`, `remote`                                    |
| `…/styles.css`                   | Optional default styles                                                                                   |

::: details Prefer minimal installs?
The same code is published as individual packages: `@avinash-baraiya/pragma-core`, `-interpreter`, `-providers`, `-server`, `-react` and `-tanstack`. Core has no framework or vendor dependencies.
:::

## Where things run

| Step                                                                         | Where                                      | Network                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `@` autocomplete, chip removal, clarification choices, table sort and paging | Browser                                    | None                                           |
| Explicit instructions (deterministic parser)                                 | Browser                                    | None                                           |
| Everything else                                                              | Your server, then the model you configured | One request to your endpoint, one to the model |
| Filtering, sorting and paging the rows                                       | Browser (TanStack) or your backend         | Your choice                                    |

<div class="cards">
  <a href="./getting-started"><strong>Get started →</strong><span>Add an ask bar to a React table in about ten minutes.</span></a>
  <a href="./playground"><strong>Try the playground →</strong><span>The real engine on 500 sample customers.</span></a>
</div>
