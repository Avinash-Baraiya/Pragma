# Adding an AI model

<p class="lead">Explicit instructions work without a model. Connect one to understand free phrasing like “Indian customers”, “big spenders” or “people who haven't logged in for a while”. You bring the model and the key; Pragma never ships one.</p>

<div class="flow" role="img" aria-label="The browser answers what it can locally and sends the rest to your server, which calls your model and validates the answer.">
  <div class="flow__col">
    <span class="flow__tag">Browser</span>
    <strong>Ask bar + engine</strong>
    <p>Explicit instructions are answered here, in about 1 ms. No network.</p>
  </div>
  <div class="flow__arrow"><span>only what it can't parse</span></div>
  <div class="flow__col flow__col--brand">
    <span class="flow__tag">Your server</span>
    <strong>Pragma server handler</strong>
    <p>Holds the API key, calls the model, validates the answer against the schema.</p>
  </div>
  <div class="flow__arrow"><span>schema metadata + instruction</span></div>
  <div class="flow__col">
    <span class="flow__tag">Model provider</span>
    <strong>OpenAI · Claude · Gemini · Ollama · …</strong>
    <p>Never sees row data or hidden fields.</p>
  </div>
</div>

::: info What leaves your infrastructure
Only schema metadata (field names, types, aliases, enum values) and the user's instruction. Row data never does. The answer is validated on your server and again in the browser before anything is applied.
:::

<div class="steps">

### Install

The server handler and providers are already part of `@avinash-baraiya/pragma`, so there's nothing extra to install. The Anthropic and AI SDK providers need their SDK (shown below); the others use `fetch`.

### Choose a provider

Every provider takes a `model` (nothing is hard-coded) and reads your key from wherever you pass it.

::: code-group

```ts [OpenAI & compatible]
// OpenAI, OpenRouter, Groq, Together, Fireworks, Ollama, vLLM, LM Studio, LiteLLM…
import { openAICompatible } from '@avinash-baraiya/pragma/providers/openai-compatible';

const provider = openAICompatible({
  baseURL: 'https://api.openai.com/v1', // or http://localhost:11434/v1 for Ollama
  model: process.env.OPENAI_MODEL!,
  apiKey: process.env.OPENAI_API_KEY,
});
```

```ts [Anthropic (Claude)]
// npm install @anthropic-ai/sdk
import { anthropic } from '@avinash-baraiya/pragma/providers/anthropic';

const provider = anthropic({
  model: 'claude-haiku-4-5', // a small, fast tier is usually enough
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

```ts [Google Gemini]
import { gemini } from '@avinash-baraiya/pragma/providers/gemini';

const provider = gemini({
  model: process.env.GEMINI_MODEL!, // e.g. gemini-3.5-flash-lite
  apiKey: process.env.GEMINI_API_KEY!,
});
```

```ts [Vercel AI SDK]
// npm install ai @ai-sdk/mistral (or any AI SDK provider)
import { aiSdk } from '@avinash-baraiya/pragma/providers/ai-sdk';
import { mistral } from '@ai-sdk/mistral';

const provider = aiSdk(mistral('mistral-small-latest'));
```

```ts [Your own gateway]
import { customProvider } from '@avinash-baraiya/pragma';

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

### Mount the server handler

::: code-group

```ts [Next.js]
// app/api/pragma/route.ts
import { createPragmaHandler } from '@avinash-baraiya/pragma/server';
import { customersSchema } from '@/lib/schema';

export const POST = createPragmaHandler({
  schemas: { customers: customersSchema }, // registered on the server, never sent by the client
  provider,
  authorize: async ({ request }) => (await getSession(request)) !== null,
});
```

```ts [Express]
import express from 'express';
import { createPragmaHandler, toNodeHandler } from '@avinash-baraiya/pragma/server';

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

### Point the browser at it

```ts
import { createEngine } from '@avinash-baraiya/pragma';
import { remoteInterpreter } from '@avinash-baraiya/pragma/providers/remote';

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

</div>

## Latency and cost

<div class="cards cards--stats">
  <div><strong>76%</strong><span>of instructions in the evaluation set never reached a model</span></div>
  <div><strong>0.46 ms</strong><span>median local answer time</span></div>
  <div><strong>~97%</strong><span>of prompt tokens reusable by provider prompt caching</span></div>
</div>

- Answers are cached per instruction, schema, current state and day.
- The system prompt is identical on every request, so providers with prompt caching reuse about 97% of input tokens.
- Pick a small, fast model first and measure it with `pnpm eval` in the repository. Set `timeoutMs` (default 15 s) and a fallback provider so a slow model never blocks users.

Measured results and every option: [AI models reference](/reference/llm).
