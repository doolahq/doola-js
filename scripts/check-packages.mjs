/**
 * Lints the published packages as the registry receives them: packed by pnpm,
 * so the `publishConfig` rewrite from TypeScript source to `dist` has already
 * happened. The source manifest, and anything `npm pack` produces, point at
 * files no consumer can resolve (docs/releasing.md, "Why `pnpm publish`"), so
 * both tools read the tarball and nothing else. That is also why this never
 * uses `attw --pack`: it shells out to npm.
 *
 * Needs `pnpm build` first. Without `dist` the tarball is missing its entry
 * points, and publint says so.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every package that is not private, derived the way release.yml finds what to
// publish, so a new published package is checked without an edit here.
const PACKAGES = readdirSync('packages')
  .map((name) => `packages/${name}`)
  .filter((dir) => !JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).private);

const ATTW_ARGS = {
  // ESM only by design (its tsup.config.ts), so the CommonJS resolution modes
  // describe a consumer it does not support rather than a bug.
  'packages/protocol': ['--profile', 'esm-only'],
};

function pnpm(args, options) {
  return spawnSync('pnpm', args, { stdio: 'inherit', encoding: 'utf8', ...options });
}

// Outside the repository, so a tarball cannot end up in a commit.
const destination = mkdtempSync(join(tmpdir(), 'doola-js-pack-'));

let failed = false;

try {
  // Every package is checked before the exit code is decided, as in
  // check-budgets.mjs.
  for (const dir of PACKAGES) {
    const pack = pnpm(['pack', '--json', '--pack-destination', destination], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    if (pack.status !== 0) {
      console.error(`pnpm pack failed in ${dir}`);
      failed = true;
      continue;
    }

    const { filename } = JSON.parse(pack.stdout);

    // Suggestions are hidden: the two it raises today (an `engines` field on a
    // browser package, a `git+` prefix npm adds on publish) do not apply.
    const publint = pnpm(['exec', 'publint', 'run', filename, '--strict', '--level', 'warning']);
    const attw = pnpm(['exec', 'attw', filename, ...(ATTW_ARGS[dir] ?? [])]);

    failed ||= publint.status !== 0 || attw.status !== 0;
  }
} finally {
  rmSync(destination, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
}
