// Build and publish every public package to the local registry under a unique
// prerelease version (dist-tag "local"), then restore the original versions.
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.PRAGMA_REGISTRY ?? 'http://127.0.0.1:4873';
const PACKAGES = ['core', 'interpreter', 'providers', 'server', 'react', 'tanstack'];
const version = `0.1.0-local.${Date.now()}`;
const run = (cmd, options = {}) =>
  execSync(cmd, { stdio: 'inherit', cwd: options.cwd, env: { ...process.env, ...options.env } });

// 1. A registry user (idempotent) gives us a token for publishing.
const token = await (async () => {
  const user = 'pragma-local';
  const password = 'pragma-local-password';
  // With Basic credentials this registers the user the first time and logs in afterwards.
  const res = await fetch(`${REGISTRY}/-/user/org.couchdb.user:${user}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify({ name: user, password, email: 'local@example.invalid' }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`Could not get a registry token: ${JSON.stringify(body)}`);
  return body.token;
})();
// A throwaway npmrc keeps the token out of the repository and your global config.
const npmrcDir = mkdtempSync(join(tmpdir(), 'pragma-registry-'));
const npmrc = join(npmrcDir, '.npmrc');
writeFileSync(
  npmrc,
  `registry=${REGISTRY}/\n//${REGISTRY.replace(/^https?:\/\//, '')}/:_authToken=${token}\n`,
);

// 2. Stamp versions, build, publish, and always restore the manifests.
const originals = new Map(
  PACKAGES.map((p) => [p, readFileSync(`packages/${p}/package.json`, 'utf8')]),
);
try {
  for (const p of PACKAGES) {
    const manifest = JSON.parse(originals.get(p));
    manifest.version = version;
    writeFileSync(`packages/${p}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  run('pnpm build');
  for (const p of PACKAGES) {
    run(`pnpm publish --registry ${REGISTRY} --tag local --no-git-checks`, {
      cwd: `packages/${p}`,
      env: { NPM_CONFIG_USERCONFIG: npmrc },
    });
  }
  console.log(`\nPublished ${version} to ${REGISTRY} (dist-tag "local").`);
} finally {
  for (const [p, text] of originals) writeFileSync(`packages/${p}/package.json`, text);
  rmSync(npmrcDir, { recursive: true, force: true });
}
