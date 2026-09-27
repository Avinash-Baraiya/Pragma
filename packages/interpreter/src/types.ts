import type { Ambiguity, Mutation, PragmaIssue, Suggestion } from '@pragma/core';

/**
 * What an interpreter (deterministic parser or language model) proposes for an
 * instruction. Proposals are untrusted: the engine validates every mutation and
 * ambiguity option against the schema before anything is applied.
 *
 * @public
 */
export interface Proposal {
  readonly mutations: readonly Mutation[];
  readonly ambiguities: readonly Ambiguity[];
  /** Set when the instruction asks for something the schema/protocol cannot express. */
  readonly unsupported?: {
    readonly reason: string;
    readonly messageKey: string;
    readonly suggestions: readonly Suggestion[];
    /** Precise issues when known (e.g. relayed from a server); otherwise `reason` becomes an UNSUPPORTED_OPERATION issue. */
    readonly errors?: readonly PragmaIssue[];
  };
}
