# Adding an AI model

Explicit instructions work without a model. To understand free phrasing (“Indian customers”, “big spenders”, “people who haven't logged in for a while”), connect a language model. **You bring the model and the API key; Pragma never ships one.**

## How it fits together

```text
Browser                         Your server                      Model provider
────────────────────────        ───────────────────────────      ──────────────
AskBar → engine
  ├─ deterministic parser ✔ (local, no network)
  └─ not fully understood ──▶  createPragmaHandler  ──────────▶  OpenAI / Claude /
                                 (holds the API key,                Gemini / Ollama / …
                                  validates the answer)
     re-validates locally ◀──   InterpretResult     ◀──────────
```

- The **API key lives only on your server**. The browser talks to your endpoint, never to the model provider.
- Only **schema metadata** (field names, types, aliases, enum values) and the instruction are sent to the model. **Row data never is.** Hidden fields are never included.
- The model's answer is validated on the server, and again in the browser, before anything is applied.

## 1. Install the server packages

```bash
npm install @avinash-baraiya/pragma-server @avinash-baraiya/pragma-providers
```

## 2. Choose a provider

Every provider takes a `model` (nothing is hard-coded) and reads your key from wherever you pass it.

::: code-group

```ts [OpenAI & compatible]
// OpenAI, OpenRouter, Groq, Together, Fireworks, Ollama, vLLM, LM Studio, LiteLLM…
import { openAICompatible } from '@avinash-baraiya/pragma-providers/openai-compatible';

const provider = openAICompatible({
  baseURL: 'https://api.openai.com/v1', // or http://localhost:11434/v1 for Ollama
  model: process.env.OPENAI_MODEL!,
  apiKey: process.env.OPENAI_API_KEY,
});
```

```ts [Anthropic (Claude)]
// npm install @anthropic-ai/sdk
import { anthropic } from '@avinash-baraiya/pragma-providers/anthropic';

const provider = anthropic({
  model: 'claude-haiku-4-5', // a small, fast tier is usually enough
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

```ts [Google Gemini]
import { gemini } from '@avinash-baraiya/pragma-providers/gemini';

const provider = gemini({
  model: process.env.GEMINI_MODEL!, // e.g. gemini-3.5-flash-lite
  apiKey: process.env.GEMINI_API_KEY!,
});
```

```ts [Vercel AI SDK]
// npm install ai @ai-sdk/mistral (or any AI SDK provider)
import { aiSdk } from '@avinash-baraiya/pragma-providers/ai-sdk';
import { mistral } from '@ai-sdk/mistral';

const provider = aiSdk(mistral('mistral-small-latest'));
```

```ts [Your own gateway]
import { customProvider } from '@avinash-baraiya/pragma-interpreter';

const provider = customProvider('my-gateway', async (request) => {
  const res = await fetch('https://llm.internal/generate', {
    method: 'POST',
    body: JSON.stringify(request),
    signal: request.signal,
  });
  return { text: await res.text() };
});
```

:::

Pass an array to get a fallback chain: `provider: [primary, cheaperFallback]`.

## 3. Mount the handler

::: code-group

```ts [Next.js]
// app/api/pragma/route.ts
import { createPragmaHandler } from '@avinash-baraiya/pragma-server';
import { customersSchema } from '@/lib/schema';

export const POST = createPragmaHandler({
  schemas: { customers: customersSchema }, // registered on the server, never sent by the client
  provider,
  authorize: async ({ request }) => (await getSession(request)) !== null,
});
```

```ts [Express]
import express from 'express';
import { createPragmaHandler, toNodeHandler } from '@avinash-baraiya/pragma-server';

const app = express();
app.use(express.json());
app.post(
  '/api/pragma',
  toNodeHandler(createPragmaHandler({ schemas: { customers: customersSchema }, provider })),
);
```

```ts [Hono / Bun / Deno / Workers]
const handler = createPragmaHandler({ schemas: { customers: customersSchema }, provider });
app.post('/api/pragma', (c) => handler(c.req.raw));
```

:::

The handler enforces body and instruction size limits, returns [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem responses for transport errors, and includes a circuit breaker: while the model keeps failing, users still get deterministic answers.

## 4. Point the browser at it

```ts
import { createEngine } from '@avinash-baraiya/pragma-interpreter';
import { remoteInterpreter } from '@avinash-baraiya/pragma-providers/remote';

export const engine = createEngine({
  schema: customersSchema,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  interpreter: remoteInterpreter({
    url: '/api/pragma',
    headers: () => ({ authorization: `Bearer ${getToken()}` }),
  }),
});
```

Nothing else changes: the same `AskBar`, chips and table now handle free phrasing too.

## Latency and cost

- Most instructions never reach the model. In the evaluation set, **76% were answered locally** (median 0.46 ms).
- Answers are cached per instruction, schema, current state and day.
- The system prompt is identical on every request, so providers with prompt caching reuse about 97% of input tokens.
- Pick a small, fast model first and measure it with `pnpm eval` in the repository. Set `timeoutMs` (default 15 s) and a fallback provider so a slow model never blocks users.

Measured results and every option: [AI models reference](/reference/llm).
