# @avinash-baraiya/pragma-providers

Model integrations. Import each one from its subpath so unused SDKs are never bundled.

| Import                                                | For                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `@avinash-baraiya/pragma-providers/openai-compatible` | OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio, … (fetch, no SDK) |
| `@avinash-baraiya/pragma-providers/anthropic`         | Claude via `@anthropic-ai/sdk` (optional peer)                       |
| `@avinash-baraiya/pragma-providers/gemini`            | Google Gemini via the Interactions API (fetch, no SDK)               |
| `@avinash-baraiya/pragma-providers/ai-sdk`            | Any Vercel AI SDK model via `ai` (optional peer)                     |
| `@avinash-baraiya/pragma-providers/mock`              | Tests and demos                                                      |
| `@avinash-baraiya/pragma-providers/remote`            | Browser client for `@avinash-baraiya/pragma-server`                  |

Docs: [models](https://pragma-docs.vercel.app/reference/llm)
