import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIN_SUPPORTED_VERSION, PROTOCOL_VERSION } from '../src/messages';
import { APP_SPEC, LOADER_SPEC } from '../src/spec';

/**
 * `docs/protocol.md` is the specification and this package is one
 * implementation of it — CONTRIBUTING says the document wins when they
 * disagree. That rule is worth nothing unless something notices the
 * disagreement, and two hand-maintained lists of messages is exactly the drift
 * this package was created to end.
 *
 * So: the document's message tables and the code's spec tables must name the
 * same messages, and the version the document declares must be the version the
 * code speaks.
 */
const doc = readFileSync(resolve(__dirname, '../../../docs/protocol.md'), 'utf8');

/** Message rows look like: `| \`ready\` | \`{ … }\` | 1 | notes |` */
function messagesUnder(heading: string): string[] {
  const section = doc.split(`## ${heading}`)[1] ?? '';
  const table = section.split('\n## ')[0] ?? '';

  return [...table.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map((match) => match[1]!).sort();
}

describe('docs/protocol.md', () => {
  it('declares the version this package speaks', () => {
    const declared = doc.match(/\*\*Protocol version:\s*(\d+)\.?\*\*/);

    expect(declared, 'no "**Protocol version: N**" found').not.toBeNull();
    expect(Number(declared?.[1])).toBe(PROTOCOL_VERSION);
  });

  it('keeps the supported window at N-1 or narrower', () => {
    // MIN_SUPPORTED_VERSION is a literal so retiring a version is deliberate.
    // This is the other half: it must never silently widen past what the doc
    // promises either.
    expect(MIN_SUPPORTED_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
    expect(MIN_SUPPORTED_VERSION).toBeGreaterThanOrEqual(PROTOCOL_VERSION - 1);
  });

  it('documents exactly the app messages the spec accepts', () => {
    expect(messagesUnder('Messages: app → loader')).toStrictEqual(Object.keys(APP_SPEC).sort());
  });

  it('documents exactly the peer messages the spec accepts', () => {
    expect(messagesUnder('Messages: mounting peer → app')).toStrictEqual(
      Object.keys(LOADER_SPEC).sort(),
    );
  });
});
