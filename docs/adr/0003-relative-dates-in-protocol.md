# 3. Relative dates stay relative in the protocol

**Status:** accepted

## Context

"Last 7 days" can be stored as absolute timestamps or as a relative expression. Absolute timestamps go stale, lose the user's intent, and make cached interpretations wrong the next day. Relative expressions need a timezone to mean anything.

## Decision

Relative operators (`last`, `next`, `today`, `thisWeek`, …) are stored as-is, and the query carries `context.timezone`. `resolveDates()` converts them to absolute ranges at execution time, for backends that want them.

## Consequences

- Queries stay semantic, shareable and cacheable (the cache key includes the calendar day for safety).
- Every executor must resolve dates the same way; the reference implementation and the conformance suite define that, including DST.
- The engine warns (`TIMEZONE_DEFAULTED`) when relative dates are resolved in an implicit UTC.
