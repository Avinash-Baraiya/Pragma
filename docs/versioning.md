# Versioning

## Packages

All packages follow [semantic versioning](https://semver.org) and are released with [Changesets](https://github.com/changesets/changesets) (`pnpm changeset`). Every user-visible change needs a changeset in its pull request.

- **Patch:** bug fixes that don't change documented behaviour.
- **Minor:** additions — new exports, options, operators, error or warning codes, providers.
- **Major:** removals or behaviour changes to anything documented as public.

A deprecation is announced in a minor release (with a runtime warning where practical) and removed no earlier than the next major.

## What is public

- Exports of each package entry point and subpath, marked `@public` in TSDoc.
- The `TableQuery`, mutation and result shapes ([protocol](protocol.md)).
- Error and warning codes, and message keys ([errors](errors.md)).
- Operator semantics ([operators](operators.md)).

English message _texts_ may be improved in minor releases. Use `messageKey` and `params` if you depend on wording.

## Protocol

The payload carries `version: "1.0"`.

- **Additive changes** (a new optional property, a new operator) become `1.x`. Consumers must ignore what they don't understand; the strict parser of an older library rejects unknown properties, so upgrade Pragma before sending newer payloads to it.
- **Breaking changes** become `2.0` and ship with a migration function (`migrateQuery`) from the previous major.
- A payload from a different major version is rejected with `UNSUPPORTED_PROTOCOL_VERSION`, never guessed at. The browser client also checks the server's `meta.protocolVersion`.

## Schema

The schema carries `schemaVersion: "1"` and evolves under the same rules. `schema.hash` changes whenever a schema changes, which invalidates cached interpretations automatically.

## Runtime support

- Node.js 22.12+ (active LTS lines; CI tests 22 and 24).
- Evergreen browsers (last two versions).
- React 18+ (tested with React 19); TanStack Table 9.
- TypeScript 5.4+ (the packages are built and typechecked with strict settings, including `exactOptionalPropertyTypes`).
