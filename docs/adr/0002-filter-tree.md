# 2. Filters are a tree from protocol v1.0

**Status:** accepted

## Context

A flat list of conditions cannot express "India or US, and older than 25", and retrofitting boolean logic later would break every consumer.

## Decision

`TableQuery.filter` is a tree rooted at an AND/OR group, with optional negation and stable node ids. `flattenFilter()` returns the plain conjunction when that is all there is, so simple adapters stay simple.

## Consequences

- Adapters must handle groups, or detect them with `flattenFilter` and fall back (the TanStack adapter uses a whole-row global filter).
- The normalizer flattens same-logic groups and collapses OR-ed equality into `in`, keeping trees minimal.
- Limits bound the work: at most 20 conditions and a nesting depth of 3.
