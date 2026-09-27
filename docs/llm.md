# Language models

Pragma is model-agnostic. One interface is the whole contract:

```ts
interface LanguageModelProvider {
  id: string;
  generate(request: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    jsonSchema: object;
    schemaName: string;
    temperature: number;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<{
    json?: unknown;
    text?: string;
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  }>;
}
```

## Built-in providers

| Import                                                                                     | Covers                                                                                                     | Notes                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openAICompatible({ baseURL, model, apiKey? })` from `@pragma/providers/openai-compatible` | OpenAI, Azure-compatible gateways, OpenRouter, Groq, Together, Fireworks, Ollama, vLLM, LM Studio, LiteLLM | Uses `fetch`. `structuredOutput: 'json_schema'` (strict, default), `'json_object'` or `'none'`. `maxTokensParam` and `sendTemperature` handle model quirks.                   |
| `anthropic({ model, apiKey? \| client? })` from `@pragma/providers/anthropic`              | Claude                                                                                                     | Official SDK (optional peer `@anthropic-ai/sdk`), native structured outputs, no sampling parameters (current models reject them), SDK retries disabled. `effort` is optional. |
| `aiSdk(model)` from `@pragma/providers/ai-sdk`                                             | Any Vercel AI SDK model: Gemini, Mistral, Bedrock, Azure, Cohere, …                                        | Optional peer `ai` (v7).                                                                                                                                                      |
| `mockProvider({ rules })` from `@pragma/providers/mock`                                    | Tests, demos, CI                                                                                           | Deterministic, offline.                                                                                                                                                       |
| `customProvider(id, fn)` from `@pragma/interpreter`                                        | Anything else                                                                                              | Wrap your own gateway in a few lines.                                                                                                                                         |

Model choice is configuration: `model` is always required, and nothing is hard-coded.

Providers must reject with `PragmaModelError`, with accurate `retryable`, `status` and `retryAfterMs` values; the built-ins map HTTP statuses and `Retry-After` for you. They must honour `signal`.

## The interpreter

```ts
import { createModelInterpreter } from '@pragma/interpreter';

const interpreter = createModelInterpreter({
  provider: [primary, fallback], // an ordered fallback chain
  retry: { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 4000 },
  maxRepairs: 1,
  maxOutputTokens: 2000,
});
```

- **Prompt:** schema metadata only (visible fields, types, aliases, descriptions, enum values, allowed operators), the current query summarized, today's date and timezone, and the ambiguity policy. The instruction is fenced as untrusted data. **Never row data.**
- **Output:** a flat, strict JSON format (`MODEL_OUTPUT_JSON_SCHEMA`). It is deliberately non-recursive and closed, so it works with strict structured-output modes. It is converted into mutations and then validated like any other proposal.
- **Repair:** malformed output gets one retry that feeds the parse errors back to the model; after that, `MODEL_OUTPUT_INVALID`.
- **Retries:** only for retryable failures (network errors, 429, 5xx, timeouts). They use exponential backoff with full jitter, honour `Retry-After`, and are bounded by the engine deadline (`timeoutMs`, default 15 s).
- **Fallback:** after its retries are exhausted, the next provider in the chain is tried. `meta.provider` records which one answered.
- **Degradation:** in `@pragma/server`, a circuit breaker serves deterministic-only results (header `x-pragma-degraded: model-unavailable`) while the model keeps failing, and lets one trial request through after `resetAfterMs`.

## Cost and latency

- The deterministic parser answers explicit instructions with no model call. Check the "answered without a model" metric in `pnpm eval`.
- Interpretations are cached per instruction, schema, current state and day (default in-memory LRU; plug in Redis through `CacheStore`).
- Clarification choices, chip removal, sorting and paging from the table UI are applied locally.
- `meta.usage` reports tokens per request; the evaluation report totals them.

## Measuring a model

```bash
OPENAI_BASE_URL=... OPENAI_MODEL=... OPENAI_API_KEY=... pnpm eval --provider=openai-compatible --out=reports/openai.md
ANTHROPIC_API_KEY=... pnpm eval --provider=anthropic --out=reports/claude.md
```

The report shows exact-match accuracy, ambiguity recall, refusal rate on unsupported and adversarial requests, latency percentiles and token usage, per category. Model runs spend real money.
