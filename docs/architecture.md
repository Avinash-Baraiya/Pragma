# Architecture

## Pipeline

```text
instruction ─▶ preprocess (trim, length limit, @-mention resolution)
            ─▶ cache lookup (interpretations, keyed by instruction + schema + state + date)
            ─▶ router ─┬─▶ deterministic parser ── covered? ──▶ proposal
                       └─▶ model interpreter (local or remote) ──▶ proposal
            ─▶ finalize:
                 structural check (protocol shape and bounds)
                 semantic validation (fields, operators, values, capabilities, limits)
                 ambiguity policy (ask | bestGuess)
                 apply mutations to current state
                 re-validate result · normalize · analyze conflicts · explain
            ─▶ InterpretResult (ok | needs_clarification | unsupported | error)
```

`interpret()` never rejects for runtime problems. Configuration mistakes throw at construction (`createEngine`, `defineSchema`, `createPragmaHandler`).

## Key ideas

**Proposals, not queries.** Interpreters (the deterministic parser, a language model, a remote server) produce _mutations_ such as `addFilter`, `setSort`, `removeFilter` and `reset`. The engine applies them to the current state. This gives merge, replace, remove and reset semantics uniformly, and makes every interpreter untrusted by default. See [ADR 0001](adr/0001-mutations-not-final-state.md).

**The validator is the authority.** Every proposal passes the strict protocol parser, then the schema-aware validator. Hidden fields produce exactly the same error as non-existent ones. See [ADR 0005](adr/0005-validator-is-the-authority.md).

**Deterministic first, conservatively.** The dictionary-driven parser handles explicit phrasing ("age > 25", "status is active", "sort by country then age desc", "20 per page", "remove the country filter", "joined in the last 7 days") without any model. It claims an instruction only if every meaningful token is understood; otherwise it declines, and a partial understanding never becomes a query.

**Explanations are generated, not narrated.** The "Interpreted as" text and the chips come from the validated query, never from model prose, so they always describe what will run.

**Relative dates stay relative.** `last 7 days` is stored as `{ operator: 'last', value: { amount: 7, unit: 'day' } }` with the query's timezone. That keeps it semantic and cacheable. `resolveDates()` turns it into absolute ranges for backends. See [ADR 0003](adr/0003-relative-dates-in-protocol.md).

## Packages and dependencies

```text
@pragma/core            (zod, @date-fns/tz)
   ▲        ▲
   │        └── @pragma/tanstack  (+ optional react, @tanstack/react-table for /react)
   │
@pragma/interpreter     (core, zod)
   ▲        ▲         ▲
   │        │         └── @pragma/react     (peer: react)
   │        └── @pragma/server              (Web Request/Response; Node adapter)
   └── @pragma/providers                    (optional peers: @anthropic-ai/sdk, ai)
```

- **core** knows nothing about React, TanStack, SQL or any model vendor.
- **providers** exposes each integration on its own subpath, so unused SDKs are never bundled.
- **react** and **tanstack/react** depend on React only as a peer.

## Where code runs

| Step                                           | Browser                                | Server                       |
| ---------------------------------------------- | -------------------------------------- | ---------------------------- |
| `@` autocomplete, chips, clarification choices | ✓ (no network)                         |                              |
| Deterministic parsing, validation, explanation | ✓                                      | ✓                            |
| Model calls (API keys)                         |                                        | ✓ via `@pragma/server`       |
| Final validation of the model's proposal       | ✓ (again)                              | ✓                            |
| Query execution                                | client mode: `executeQuery` / TanStack | server mode: your data layer |

## Observability

The engine emits `interpret.start`, `interpret.complete` and `cache.error` events through `onEvent`. Each result carries `meta`: request id, parser (`deterministic` / `llm` / `cache` / `local`), model, provider, token usage, retries, latency, schema hash, engine and protocol versions. By default no user text or filter values are included; `logInstructions` opts in.
