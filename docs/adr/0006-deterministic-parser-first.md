# 6. A conservative deterministic parser runs before any model

**Status:** accepted

## Context

Many table instructions are explicit ("age > 25", "sort by country then age desc", "20 per page"). Sending them to a model adds cost, latency, a network dependency and non-determinism for no benefit. A parser that guesses, however, produces confidently wrong queries.

## Decision

A dictionary-driven parser handles explicit phrasing. It claims an instruction only when **every** meaningful token is understood; otherwise it declines and the instruction goes to the model (or returns `unsupported` when none is configured). Values never start at keywords, field names, the table name, recency phrases or prepositions.

## Consequences

- Explicit instructions work offline, instantly and identically every time. The evaluation gate asserts exact matches for them.
- Semantic phrasing ("Indian customers", "older than 40", "high-value accounts") is deliberately left to the model; the gate asserts the parser declines it.
- Every parser bug found so far that produced a wrong query (found by the example app and the evaluation dataset) came from claiming too much; each fix made the parser decline instead of guess.
