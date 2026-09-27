# @pragma/providers

Model integrations. Import each one from its subpath so unused SDKs are never bundled.

| Import                                | For                                                                  |
| ------------------------------------- | -------------------------------------------------------------------- |
| `@pragma/providers/openai-compatible` | OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio, … (fetch, no SDK) |
| `@pragma/providers/anthropic`         | Claude via `@anthropic-ai/sdk` (optional peer)                       |
| `@pragma/providers/ai-sdk`            | Any Vercel AI SDK model via `ai` (optional peer)                     |
| `@pragma/providers/mock`              | Tests and demos                                                      |
| `@pragma/providers/remote`            | Browser client for `@pragma/server`                                  |

Docs: [models](../../docs/llm.md)
