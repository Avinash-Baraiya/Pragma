/**
 * @pragma/interpreter — turns natural-language instructions into validated
 * TableQuery results: deterministic parser, model routing, caching and the engine.
 *
 * @packageDocumentation
 */

export { createEngine } from './engine.js';
export type {
  AmbiguityPolicy,
  Engine,
  EngineEvent,
  EngineLimits,
  EngineOptions,
  InterpretOptions,
  LocalOptions,
  MentionSuggestions,
  ModelInterpretation,
  ModelInterpreter,
  ModelInterpretRequest,
  RouterMode,
} from './engine.js';
export { parseDeterministic } from './deterministic/parser.js';
export type { DeterministicResult, ParseContext } from './deterministic/parser.js';
export { MemoryCache } from './cache.js';
export type { CacheStore, MaybePromise, MemoryCacheOptions } from './cache.js';
export type { Proposal } from './types.js';
export { ENGINE_VERSION } from './version.js';
