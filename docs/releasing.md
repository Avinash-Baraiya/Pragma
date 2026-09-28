# Releasing

Pragma is published to npm as seven packages that always share a version: the one-install package `@avinash-baraiya/pragma` and the individual packages it re-exports (`-core`, `-interpreter`, `-providers`, `-server`, `-react`, `-tanstack`). Every npm release gets matching git tags and GitHub releases.

## Day-to-day: describe changes with changesets

Every pull request that changes a published package adds a changeset:

```bash
pnpm changeset
```

Pick the packages and the bump (`patch` for fixes, `minor` for features, `major` for breaking changes; see [versioning](versioning.md)), and write one or two sentences for the changelog.

## Automated releases

`.github/workflows/release.yml` runs on every push to `main`:

1. While unreleased changesets exist, it opens or updates a **"chore: version packages"** pull request that bumps versions and writes the changelogs.
2. When you merge that pull request, it runs lint, type checks and tests, publishes the new versions to npm with **provenance**, pushes the `<package>@<version>` git tags, and creates a **GitHub release** for each package with its changelog.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no npm token is stored in GitHub.

### One-time setup

1. **Allow the workflow to open pull requests:** repository **Settings → Actions → General → Workflow permissions**, tick **"Allow GitHub Actions to create and approve pull requests"**.
2. **Trusted publishing** (after the first release, because npm only offers it for existing packages): for each of the seven packages on npmjs.com, open **Settings → Trusted publishing → GitHub Actions** and enter owner `Avinash-Baraiya`, repository `Pragma`, workflow `release.yml`. Then, under **Publishing access**, choose **"Require two-factor authentication and disallow tokens"**.
3. **Switch the workflow on:** repository **Settings → Secrets and variables → Actions → Variables**, add `RELEASE_AUTOMATION` with the value `true`. Until then the Release workflow is skipped.

## First release (from your machine)

npm trusted publishing can only be configured for packages that already exist, so the first release is published locally:

```bash
npm whoami                    # must print avinash-baraiya
pnpm changeset version        # 0.0.0 → 0.1.0, writes CHANGELOG.md files
pnpm install                  # refresh the lockfile
git commit -am "chore: version packages" && git push
pnpm release -- --dry-run     # check the tarballs; nothing is published
pnpm release                  # builds, publishes, tags; npm asks for your 2FA code
git push --tags
```

Then create the GitHub releases for the tags (or let the maintainer tooling do it), and complete the one-time setup above.

## Checking a release

```bash
npm view @avinash-baraiya/pragma version
npm install @avinash-baraiya/pragma   # in a fresh project
```

`pnpm release` skips versions that are already on npm, so re-running it after a partial failure publishes only what is missing.
