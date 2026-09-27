/**
 * @pragma/server — HTTP endpoint that interprets instructions server-side, so
 * model credentials never reach the browser.
 *
 * @packageDocumentation
 */

export { createPragmaHandler, problem } from './handler.js';
export type { AuthorizeResult, CorsOptions, PragmaHandler, PragmaHandlerOptions, RateLimitResult, RequestContext } from './handler.js';
export { toNodeHandler } from './node.js';
export type { NodeHandlerOptions } from './node.js';
export type { CircuitBreakerOptions } from './circuit-breaker.js';
