// Publish every public package whose current version is not yet on npm.
//
//   pnpm release              # build, then publish (npm asks for your 2FA code locally)
//   pnpm release --otp=123456 # pass the 2FA code up front instead of being prompted
//   pnpm release -- --dry-run # show what would be published, publish nothing
//
// Each package is packed with pnpm (which rewrites `workspace:^` ranges to real
// versions) and the tarball is published with npm, so the same script works for
// a local publish with 2FA and for CI with npm trusted publishing (OIDC) and
// provenance. For every published package it creates the git tag
// `<name>@<version>` and prints "New tag: <name>@<version>", which the
// changesets GitHub Action uses to create the matching GitHub release.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dependency order: a package is published after the packages it depends on.
const PACKAGES = ['core', 'interpreter', 'providers', 'server', 'react', 'tanstack', 'pragma'];
const dryRun = process.argv.includes('--dry-run');
// A one-time password from your authenticator app: pnpm release --otp=123456
const otp = process.argv.find((arg) => arg.startsWith('--otp='));
const inCI = process.env.GITHUB_ACTIONS === 'true';

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const quiet = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const published = [];
const outDir = mkdtempSync(join(tmpdir(), 'pragma-release-'));
try {
  for (const dir of PACKAGES) {
    const cwd = join('packages', dir);
    const {
      name,
      version,
      private: isPrivate,
    } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (isPrivate) continue;
    if (quiet('npm', ['view', `${name}@${version}`, 'version'])) {
      console.log(`• ${name}@${version} is already on npm, skipping`);
      continue;
    }

    const packDir = mkdtempSync(join(outDir, `${dir}-`));
    run('pnpm', ['pack', '--pack-destination', packDir], {
      cwd,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const tarball = readdirSync(packDir).find((file) => file.endsWith('.tgz'));
    if (!tarball) throw new Error(`pnpm pack produced no tarball for ${name}`);

    const args = ['publish', join(packDir, tarball), '--access', 'public'];
    if (inCI) args.push('--provenance');
    if (dryRun) args.push('--dry-run');
    if (otp) args.push(otp);
    console.log(`\n→ ${dryRun ? 'Dry run: ' : ''}publishing ${name}@${version}`);
    run('npm', args);
    published.push(`${name}@${version}`);
  }

  if (!dryRun) {
    for (const tag of published) {
      if (!quiet('git', ['tag', '--list', tag])) run('git', ['tag', tag]);
      console.log(`New tag: ${tag}`);
    }
  }
  console.log(
    published.length === 0
      ? '\nNothing to publish.'
      : `\n${dryRun ? 'Would publish' : 'Published'}: ${published.join(', ')}`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
