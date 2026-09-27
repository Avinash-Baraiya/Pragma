# Contributing

## Setup

Node ≥ 22.12 and pnpm 10.

```bash
pnpm install
pnpm test
```

## Before opening a pull request

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:coverage          # thresholds are enforced
pnpm build && pnpm check:packages && pnpm size
pnpm changeset              # for any user-visible change
```

## Standards

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): …`, `fix(scope): …`, `test: …`, `docs: …`, `refactor: …`, `chore: …`, `ci: …`. Keep each commit to one feature or fix.
- **Types:** strict TypeScript; no `any`; exhaustive switches.
- **Errors:** runtime problems are returned as typed results with stable codes; only configuration errors throw. Never put stack traces, upstream bodies or secrets in issues.
- **Tests:** every bug fix adds a regression test. Parser changes add cases to the parser table _and_ to `benchmarks/dataset/customers.jsonl`. Adapter changes must pass the conformance suite.
- **Parser principle:** when in doubt, decline. A wrong query is worse than asking the model or the user.
- **Public API:** exports are documented with TSDoc and `@public`; breaking changes follow [versioning](docs/versioning.md).
- **Decisions:** significant design changes get an ADR in `docs/adr`.
- **Accessibility:** UI changes keep the axe checks passing and remain fully keyboard-operable.
