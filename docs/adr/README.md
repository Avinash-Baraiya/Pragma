# Architecture decision records

| #                                          | Decision                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| [0001](0001-mutations-not-final-state.md)  | Interpreters emit mutations, not final queries            |
| [0002](0002-filter-tree.md)                | Filters are a tree from protocol v1.0                     |
| [0003](0003-relative-dates-in-protocol.md) | Relative dates stay relative in the protocol              |
| [0004](0004-server-registered-schemas.md)  | Servers resolve schemas from their own registry           |
| [0005](0005-validator-is-the-authority.md) | The validator is the authority; models only propose       |
| [0006](0006-deterministic-parser-first.md) | A conservative deterministic parser runs before any model |

New decisions: copy the format (Status, Context, Decision, Consequences), number sequentially, and never rewrite an accepted record; supersede it with a new one.
