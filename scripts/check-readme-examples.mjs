/**
 * Type-checks the TypeScript examples in the READMEs npm publishes, against the
 * packages' own source and the base tsconfig's strict settings. Partners copy
 * these blocks verbatim; format:check formats them, and nothing else compiled
 * them, so an option rename would have shipped a broken quick start.
 *
 * Every ```ts block is its own module. A block that builds on an earlier one
 * says so in a comment right above its fence, and is compiled after it:
 *
 *   <!-- example: session-route -->          names a block
 *   <!-- example: payment after session-route -->  compiles it after that one
 *
 * so renaming something in the earlier block breaks the later one, as it would
 * for a partner. Names left to the partner (their auth, their checkout) are
 * declared in readme-examples.d.ts. Errors are reported at their README line.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The READMEs of every package that is not private, derived as in
// check-packages.mjs, so a new published package is checked without an edit here.
const READMES = readdirSync('packages')
  .map((name) => `packages/${name}`)
  .filter((dir) => !JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).private)
  .map((dir) => `${dir}/README.md`);

const ROOT = resolve('.');
const BLOCK = /^(?:<!-- example: ([\w-]+)(?: after ([\w-]+))? -->\n\n?)?```ts\n([\s\S]*?)^```$/gm;
// Every TypeScript fence, at any indent or spelling, so a block BLOCK misses
// fails the check instead of shipping unchecked while it stays green.
const ANY_TS_FENCE = /^[ \t]*(?:```|~~~)[ \t]*(?:ts|tsx|typescript)\b/gim;
const TSC = createRequire(join(ROOT, 'packages/js/package.json')).resolve('typescript/bin/tsc');

// Outside the repository, like check-packages.mjs, so nothing can end up in a commit.
const dir = mkdtempSync(join(tmpdir(), 'doola-js-readme-'));

// Per example: its source, and the README location of each of its lines.
const examples = [];
const named = new Map();

try {
  for (const readme of READMES) {
    const text = readFileSync(readme, 'utf8');
    const blocks = [...text.matchAll(BLOCK)];
    const fences = text.match(ANY_TS_FENCE)?.length ?? 0;

    if (fences !== blocks.length) {
      throw new Error(
        `${readme}: ${fences - blocks.length} TypeScript block(s) this check cannot read. Use an unindented \`\`\`ts fence.`,
      );
    }

    for (const match of blocks) {
      const [block, name, after, code] = match;
      const fence = match.index + block.indexOf('```ts');
      const firstLine = text.slice(0, fence).split('\n').length + 1;
      const own = {
        code,
        lines: code.split('\n').map((_, i) => `${readme}:${firstLine + i}`),
      };

      const base = after ? named.get(after) : undefined;
      if (after && !base) throw new Error(`${readme}: example "${after}" is not defined above`);

      const example = base
        ? { code: base.code + own.code, lines: [...base.lines.slice(0, -1), ...own.lines] }
        : own;

      if (name) named.set(name, example);
      examples.push(example);
    }
  }

  // A check that finds nothing passes forever, so a renamed fence must fail it.
  if (examples.length === 0) throw new Error(`No \`\`\`ts blocks found in ${READMES.join(', ')}`);

  examples.forEach(({ code }, i) => writeFileSync(join(dir, `example-${i}.ts`), code));

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.base.json'),
      compilerOptions: {
        moduleDetection: 'force',
        paths: {
          '@doola/js': [join(ROOT, 'packages/js/src/index.ts')],
          '@doola/sdk-protocol': [join(ROOT, 'packages/protocol/src/index.ts')],
        },
      },
      files: [
        join(ROOT, 'scripts/readme-examples.d.ts'),
        ...examples.map((_, i) => `example-${i}.ts`),
      ],
    }),
  );

  // lib.dom is checked by every package's own typecheck already.
  const tsc = spawnSync(
    process.execPath,
    [TSC, '-p', join(dir, 'tsconfig.json'), '--pretty', 'false', '--skipDefaultLibCheck'],
    { encoding: 'utf8' },
  );

  if (tsc.status !== 0) {
    const output = `${tsc.stdout}${tsc.stderr}`.replace(
      /^(?:.*[\\/])?example-(\d+)\.ts\((\d+),(\d+)\)/gm,
      (_, i, line, column) => `${examples[Number(i)].lines[Number(line) - 1]}:${column}`,
    );

    process.stderr.write(output);
    process.exitCode = 1;
  } else {
    console.log(`${examples.length} README examples type-check`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
