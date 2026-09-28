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

| Import                                                                                                     | Covers                                                                                                     | Notes                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openAICompatible({ baseURL, model, apiKey? })` from `@avinash-baraiya/pragma-providers/openai-compatible` | OpenAI, Azure-compatible gateways, OpenRouter, Groq, Together, Fireworks, Ollama, vLLM, LM Studio, LiteLLM | Uses `fetch`. `structuredOutput: 'json_schema'` (strict, default), `'json_object'` or `'none'`. `maxTokensParam` and `sendTemperature` handle model quirks.                   |
| `anthropic({ model, apiKey? \| client? })` from `@avinash-baraiya/pragma-providers/anthropic`              | Claude                                                                                                     | Official SDK (optional peer `@anthropic-ai/sdk`), native structured outputs, no sampling parameters (current models reject them), SDK retries disabled. `effort` is optional. |
| `gemini({ model, apiKey })` from `@avinash-baraiya/pragma-providers/gemini`                                | Google Gemini via the Interactions API                                                                     | Uses `fetch`, no SDK. Native JSON-schema output and a system instruction. Newer Gemini keys can only generate through this API.                                               |
| `aiSdk(model)` from `@avinash-baraiya/pragma-providers/ai-sdk`                                             | Any Vercel AI SDK model: Gemini, Mistral, Bedrock, Azure, Cohere, …                                        | Optional peer `ai` (v7).                                                                                                                                                      |
| `mockProvider({ rules })` from `@avinash-baraiya/pragma-providers/mock`                                    | Tests, demos, CI                                                                                           | Deterministic, offline.                                                                                                                                                       |
| `customProvider(id, fn)` from `@avinash-baraiya/pragma-interpreter`                                        | Anything else                                                                                              | Wrap your own gateway in a few lines.                                                                                                                                         |

Model choice is configuration: `model` is always required, and nothing is hard-coded.

Providers must reject with `PragmaModelError`, with accurate `retryable`, `status` and `retryAfterMs` values; the built-ins map HTTP statuses and `Retry-After` for you. They must honour `signal`.

## The interpreter

```ts
import { createModelInterpreter } from '@avinash-baraiya/pragma-interpreter';

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
- **Degradation:** in `@avinash-baraiya/pragma-server`, a circuit breaker serves deterministic-only results (header `x-pragma-degraded: model-unavailable`) while the model keeps failing, and lets one trial request through after `resetAfterMs`.

## Cost and latency

The fastest model call is the one that never happens:

- The deterministic parser answers explicit instructions locally in about a millisecond. Check the "answered without a model" metric in `pnpm eval`.
- Interpretations are cached per instruction, schema, current state and day (default in-memory LRU; plug a shared store such as Redis into `CacheStore` when running several server instances).
- Clarification choices, chip removal, and table sorting and paging are applied locally.

When a model _is_ called:

- **Prompt caching.** The system prompt (rules, schema and examples) depends only on the schema and the ambiguity policy, so it is byte-identical on every request. Only the date, current state and instruction (about 50 tokens) vary. For a 15-field schema the static part is about 1,600 tokens, roughly 97% of the input.
  - The Anthropic provider marks it with `cache_control`.
  - OpenAI and many OpenAI-compatible servers cache identical prefixes automatically (OpenAI from 1,024 tokens).
  - Anthropic's minimum cacheable length depends on the model, so small schemas may fall below it (harmless: the request is simply not cached).
  - Cached tokens are reported as `meta.usage.cachedInputTokens` and totalled by `pnpm eval`.
- **Small output.** The output format is compact; `maxOutputTokens` defaults to 1024.
- **Pick a fast model.** This task (mapping a sentence onto a known schema) does not need the largest model.
  - Start with a small, fast tier, e.g. `claude-haiku-4-5` with the Anthropic provider, or a small hosted model behind an OpenAI-compatible endpoint (Groq and OpenRouter serve several).
  - Measure accuracy and p95 latency with `pnpm eval`, and move up a tier only if accuracy requires it.
  - With Claude models that support `effort`, `effort: 'low'` also reduces latency.
- **Bounded worst case.** A timeout (`timeoutMs`, default 15 s), retries within that deadline, a fallback provider chain and the server's circuit breaker keep slow or failing models from blocking users.

## Measured results

`pnpm eval --provider=gemini` with `gemini-3.5-flash-lite` (September 2026, 106 cases, concurrency 2):

| Metric                                       | Result                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Exact match (all categories)                 | 106 / 106; a rerun of the 29 model-dependent cases matched 28 (one judgement call on "big spenders") |
| Unsupported and adversarial requests refused | 100% in both runs                                                                                    |
| Answered without a model                     | 76% (median 0.46 ms)                                                                                 |
| Model calls                                  | about 5 s median; occasional provider-side stalls of 45–60 s                                         |

With this model's latency floor, set `timeoutMs` to about 8–10 s and configure a fallback provider so users never wait on a stalled call. Gemini reported no cached prompt tokens through the Interactions API, so prompt caching does not reduce latency there yet.

## Measuring a model

```bash
OPENAI_BASE_URL=... OPENAI_MODEL=... OPENAI_API_KEY=... pnpm eval --provider=openai-compatible --out=reports/openai.md
ANTHROPIC_API_KEY=... pnpm eval --provider=anthropic --out=reports/claude.md
```

The report shows exact-match accuracy, ambiguity recall, refusal rate on unsupported and adversarial requests, latency percentiles and token usage, per category. Model runs spend real money.
