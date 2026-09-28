# What is Pragma?

Pragma is a natural-language query layer for data tables. You describe your table once as a typed schema. Your users type what they want to see. Pragma returns a **validated, library-agnostic `TableQuery`**: search, filters, sort and pagination that any table library, API or database adapter can execute.

![Pragma answering an instruction: filter chips, an explanation and the filtered table](/screenshots/results.png)

## The problem

Every table library has its own state model for search, filtering, sorting and paging. Turning “enterprise customers in India who joined this year, biggest first” into that state means hand-written translation code, and asking a language model to do it directly gives you output you cannot trust: invented fields, wrong operators, values in the wrong format, or fields users were never meant to see.

## The approach

**Natural language is an input, not the source of truth.** The source of truth is a typed query that has been checked against your schema.

- **The model proposes; the engine decides.** Interpreters (a deterministic parser, or a language model) only propose changes. The engine validates every field, operator and value against the schema before applying anything.
- **Local first.** A deterministic parser handles explicit instructions (“status is trial or churned”, “@revenue over 10 lakh”, “sort by name then age desc”) in the browser in about a millisecond. It claims an instruction only when it understands every word. Anything else goes to a model through your server.
- **Safe by construction.** Hidden fields are indistinguishable from fields that do not exist. Model output can never widen the schema. Row data is never sent to a model, only schema metadata.
- **Stateful.** “Now sort by revenue” keeps your filters. “Remove the country filter” removes only that. Every change is a mutation applied to the current query.
- **Honest.** Ambiguous requests (“recent customers”) come back as a clarification question with ready-made options. Impossible combinations come back as warnings. Explanations are generated from the validated query, so they always describe what will actually run.

## Packages

| Package                               | What it does                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@avinash-baraiya/pragma-core`        | Schema model, `TableQuery` protocol, operators, validator, normalizer, date semantics, explanations, reference executor, `@` mentions. No framework or vendor dependencies. |
| `@avinash-baraiya/pragma-interpreter` | `createEngine`: deterministic parser, model routing, clarifications, cache, and the model-agnostic LLM layer.                                                               |
| `@avinash-baraiya/pragma-providers`   | Model integrations: OpenAI-compatible, Anthropic, Gemini, Vercel AI SDK, mock, and the browser `remoteInterpreter`.                                                         |
| `@avinash-baraiya/pragma-server`      | Web-standard HTTP handler (Next.js, Hono, Bun, Deno, Workers) and a Node/Express adapter. Keeps model keys on the server.                                                   |
| `@avinash-baraiya/pragma-react`       | Accessible `AskBar` with local `@` autocomplete, `QueryChips`, `Explanation`, `ClarificationPrompt`, `Feedback`.                                                            |
| `@avinash-baraiya/pragma-tanstack`    | TanStack Table (v9) adapter and the `usePragmaTable` hook.                                                                                                                  |

You only install what you use. A browser-only setup with no model needs `core`, `interpreter`, and optionally `react` and `tanstack`.

## Where things run

| Step                                                                         | Where                                      | Network                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `@` autocomplete, chip removal, clarification choices, table sort and paging | Browser                                    | None                                           |
| Explicit instructions (deterministic parser)                                 | Browser                                    | None                                           |
| Everything else                                                              | Your server, then the model you configured | One request to your endpoint, one to the model |
| Filtering, sorting and paging the rows                                       | Browser (TanStack) or your backend         | Your choice                                    |

Next: [Getting started](./getting-started).
