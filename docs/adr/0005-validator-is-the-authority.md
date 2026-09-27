# 5. The validator is the authority; models only propose

**Status:** accepted

## Context

Language models are powerful interpreters but unreliable authorities: they hallucinate fields, invent operators, follow injected instructions and occasionally emit malformed JSON.

## Decision

Every proposal, from the deterministic parser, a model or a remote server, passes the strict structural parser and then the schema-aware validator, before and after it is applied. Hidden fields are rejected exactly like unknown ones. Explanations are generated from the validated query, never from model prose.

## Consequences

- A compliant but malicious model still cannot reach anything outside the schema. This is verified by property-based and adversarial tests.
- Model quality affects _usefulness_, never _safety_.
- Unknown enum values become a clarification listing the real values instead of a guess.
