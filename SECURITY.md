# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately through GitHub's
[private vulnerability reporting](https://github.com/Avinash-Baraiya/Pragma/security/advisories/new) for this repository.

Include what you found, how to reproduce it, and its impact. Maintainers will acknowledge the report
and coordinate a fix; disclosure follows once a fixed version is released.

## Scope

In scope: anything that lets a user or a model reach fields outside the schema, bypass validation,
leak credentials or row data, crash the engine or server, or execute code.

## Supported versions

Security fixes are released for the latest minor version of each package.

See [docs/security.md](docs/security.md) for the threat model and the guarantees Pragma provides.
