# Example: TanStack Table + React

A customers table (500 seeded rows) you can query in plain language.

```bash
pnpm install
pnpm --filter tanstack-react-example dev
```

Open the printed URL and try the example chips, or type your own instruction.
Type `@` to reference a column.

## What it shows

| Piece                                                       | Where                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Shared schema (browser + server)                            | `src/schema.ts`                                                  |
| Engine with deterministic parser + remote model interpreter | `src/App.tsx`                                                    |
| Ask bar, chips, clarification, feedback, explanation        | `@avinash-baraiya/pragma-react` components in `src/App.tsx`      |
| TanStack Table v9 in controlled mode                        | `usePragmaTable` in `src/App.tsx`                                |
| Server handler holding model credentials                    | `server/pragma.ts`, mounted at `/api/pragma` by `vite.config.ts` |

Instructions the deterministic parser fully understands never leave the
browser. Everything else is sent to `/api/pragma`; the server interprets it with
the configured model and the browser re-validates the result before applying it.

## Using a real model

Copy `.env.example` to `.env` and set `PRAGMA_PROVIDER`:

- `mock` (default): offline, understands a few demo phrases.
- `openai-compatible`: any Chat Completions server — OpenAI, OpenRouter, Groq,
  Ollama (`OPENAI_BASE_URL=http://localhost:11434/v1`), vLLM, LM Studio.
- `anthropic`: Claude via the official SDK (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`).

API keys are read by the server only and never sent to the browser.

## Production

The Vite middleware is for local development. In production, mount
`createPragmaHandler` from `@avinash-baraiya/pragma-server` in your own backend (Next.js route
handler, Hono, Express via `toNodeHandler`, ...) behind your authentication.
