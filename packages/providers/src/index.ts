/**
 * @avinash-baraiya/pragma-providers — model integrations. Import each from its subpath so that
 * unused SDKs are never bundled:
 *
 * - `@avinash-baraiya/pragma-providers/openai-compatible`
 * - `@avinash-baraiya/pragma-providers/anthropic` (peer: `@anthropic-ai/sdk`)
 * - `@avinash-baraiya/pragma-providers/ai-sdk` (peer: `ai`)
 * - `@avinash-baraiya/pragma-providers/mock`
 * - `@avinash-baraiya/pragma-providers/remote` (browser → `@avinash-baraiya/pragma-server`)
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
