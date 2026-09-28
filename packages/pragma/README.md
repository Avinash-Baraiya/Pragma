# @avinash-baraiya/pragma

Natural-language queries for data tables, as a validated, library-agnostic `TableQuery`. This package is the one-install entry point: it includes the engine, React components, TanStack Table adapter, server handler and model providers.

```bash
npm install @avinash-baraiya/pragma
```

| Import                                     | What you get                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `@avinash-baraiya/pragma`                  | `defineSchema`, `createEngine`, the `TableQuery` protocol, validation, dates   |
| `@avinash-baraiya/pragma/react`            | `PragmaProvider`, `AskBar`, `QueryChips`, `Explanation`, `ClarificationPrompt` |
| `@avinash-baraiya/pragma/styles.css`       | Optional default styles for the React components                               |
| `@avinash-baraiya/pragma/tanstack`         | TanStack Table adapter (state, filter functions, columns)                      |
| `@avinash-baraiya/pragma/tanstack/react`   | `usePragmaTable` hook                                                          |
| `@avinash-baraiya/pragma/server`           | `createPragmaHandler`, `toNodeHandler` (keeps model keys server-side)          |
| `@avinash-baraiya/pragma/providers/<name>` | `openai-compatible`, `anthropic`, `gemini`, `ai-sdk`, `mock`, `remote`         |

React, TanStack Table, `@anthropic-ai/sdk` and `ai` are optional peer dependencies: install only the ones you use. Each subpath is a separate entry, so unused parts never reach your bundle.

Prefer minimal installs? The same code is published as individual packages: `@avinash-baraiya/pragma-core`, `-interpreter`, `-providers`, `-server`, `-react` and `-tanstack`.

Docs, setup guide and live playground: https://pragma-docs.vercel.app/
