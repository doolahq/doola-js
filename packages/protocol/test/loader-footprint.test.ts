import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * What this package costs the loader.
 *
 * The loader is fetched from js.doola.com on every page load of every partner
 * site, and its CI holds it to 6 KB gzip. That budget is enforced in the loader
 * package, which means a regression introduced here is discovered one repo
 * away from its cause. This measures the same number at the source.
 *
 * It also pins the tree-shaking: the loader imports the peer-side half, and
 * none of the app-side half may follow it in.
 */
const LOADER_IMPORTS = `
  import { parseAppMessage, loaderEnvelope, negotiate } from '../src/index';
  globalThis.x = [parseAppMessage, loaderEnvelope, negotiate];
`;

async function bundle(contents: string): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: __dirname, loader: 'ts' },
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
  });

  return result.outputFiles[0]?.text ?? '';
}

describe('loader footprint', () => {
  it('stays small enough to be worth sharing', async () => {
    const code = await bundle(LOADER_IMPORTS);
    const size = gzipSync(code).length;

    // Generous against today's ~1.3 KB: this is a regression alarm, not a
    // target. Raise it in a PR that says what got bigger and why.
    expect(size, `loader-side bundle is ${size} bytes gzip`).toBeLessThan(1800);
  });

  it('leaves the app-side half behind', async () => {
    const code = await bundle(LOADER_IMPORTS);

    // APP_SPEC is not on this list: the loader parses app messages, so it
    // needs that table. What it must not carry is the app's own send and
    // receive paths.
    for (const appOnly of ['parseLoaderMessage', 'appEnvelope']) {
      expect(code, `${appOnly} leaked into the loader bundle`).not.toContain(appOnly);
    }
  });
});
