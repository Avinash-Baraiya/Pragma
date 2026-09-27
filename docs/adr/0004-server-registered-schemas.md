# 4. Servers resolve schemas from their own registry

**Status:** accepted

## Context

If a browser could send the schema it wants interpreted, a user could unhide fields, add fields that don't exist, or change types, and the model prompt would faithfully follow.

## Decision

`createPragmaHandler` receives schemas keyed by resource. Clients send only the resource name. Client-supplied schemas are accepted only with `allowClientSchema: true`, and never for a registered resource.

## Consequences

- The server is the source of truth for what is queryable. The browser re-validates responses against its own copy as defence in depth.
- Multi-tenant apps with per-tenant schemas register them server-side (for example by building a handler per tenant).
