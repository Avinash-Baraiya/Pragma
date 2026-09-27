# 1. Interpreters emit mutations, not final queries

**Status:** accepted

## Context

Users refine tables step by step: "only India", "sort newest", "remove the country filter", "clear everything". If an interpreter (especially a model) returned a complete new query, every refinement would risk dropping or corrupting state the user did not mention, and "remove X" would have no natural representation.

## Decision

Interpreters return a list of mutations (`addFilter`, `removeFilter`, `setSort`, `setPageSize`, `reset`, …). The engine applies them in order to the current state, all-or-nothing.

## Consequences

- Merge, replace, remove and reset semantics are uniform and testable in one place (`applyMutations`).
- Model output is small and easy to validate; the model never re-emits state it did not change.
- Clarification options carry mutations, so a choice is applied locally without another model call.
- Page reset rules ("any result-changing edit returns to page 1") are enforced centrally.
