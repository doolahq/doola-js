/**
 * The size budgets for everything this repo ships, in one place because every
 * workflow that produces a build enforces them.
 *
 * Gzip, because that is what the browser downloads. Both numbers are budgets
 * rather than observations — they exist to make growth a decision, so raise
 * one in the same commit that spends it, never in a follow-up.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGETS = [
  {
    label: '@doola/js esm',
    file: 'packages/js/dist/index.js',
    // The shim is a script tag and a promise. If it ever approaches this, the
    // thing that grew belongs in the loader, which partners do not bundle.
    limit: 3 * 1024,
  },
  {
    label: 'loader iife',
    file: 'packages/loader/dist/index.global.js',
    // Blocking on the partner's page before anything renders, on their
    // connection, counted against their LCP.
    limit: 6 * 1024,
  },
];

let failed = false;

// Every budget is reported before the exit code is decided, so one commit that
// spends two budgets does not need two runs to discover that.
for (const { label, file, limit } of BUDGETS) {
  const size = gzipSync(readFileSync(file)).length;
  const over = size >= limit;

  console.log(`${label}: ${size} bytes gzip (limit ${limit}) ${over ? 'OVER BUDGET' : 'ok'}`);
  failed ||= over;
}

if (failed) {
  process.exitCode = 1;
}
