/**
 * @pragma/providers — model integrations. Import each from its subpath so that
 * unused SDKs are never bundled:
 *
 * - `@pragma/providers/openai-compatible`
 * - `@pragma/providers/anthropic` (peer: `@anthropic-ai/sdk`)
 * - `@pragma/providers/ai-sdk` (peer: `ai`)
 * - `@pragma/providers/mock`
 * - `@pragma/providers/remote` (browser → `@pragma/server`)
 *
 * The root entry re-exports only the dependency-free providers.
 *
 * @packageDocumentation
 */

export { openAICompatible } from './openai-compatible.js';
export type { OpenAICompatibleOptions } from './openai-compatible.js';
export { mock, mockProvider } from './mock.js';
export type { MockOutput, MockProviderOptions, MockRule } from './mock.js';
export { remoteInterpreter } from './remote.js';
export type { RemoteInterpretRequestBody, RemoteInterpreterOptions } from './remote.js';
