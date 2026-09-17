import { parseAppMessage as packageParse } from '@doola/sdk-protocol';
import { describe, expect, it } from 'vitest';

import { parseAppMessage as loaderParse } from '../src/protocol';

/**
 * The loader and `@doola/sdk-protocol` are two implementations of one
 * specification, and will be until adoption replaces the first with the second.
 * Until then nothing made them agree: the loader accepted `v: NaN`, took an
 * array as a payload, and threw on `type: '__proto__'` where the package
 * returned null — all three contradicting docs/protocol.md while both suites
 * passed in the same run, each asserting its own half.
 *
 * This is the guard for that window, and it covers the **receive path only**.
 * The send paths still differ — the loader's `envelope` spreads where the
 * package's `loaderEnvelope` projects — which is a wire change that belongs
 * with adoption rather than here.
 */
const CORPUS: [string, unknown][] = [
  ['well-formed ready', { v: 1, type: 'ready', payload: { protocolMax: 1 } }],
  ['well-formed resize', { v: 1, type: 'resize', payload: { height: 640 } }],
  ['formed', { v: 1, type: 'formed', payload: { companyId: 'c_1' } }],
  ['version above the ceiling', { v: 2, type: 'ready', payload: { protocolMax: 1 } }],
  ['version below the floor', { v: 0, type: 'ready', payload: { protocolMax: 1 } }],
  ['NaN version', { v: Number.NaN, type: 'ready', payload: { protocolMax: 1 } }],
  ['array payload on an empty spec', { v: 1, type: 'token-request', payload: [] }],
  ['array payload on a checked spec', { v: 1, type: 'resize', payload: [] }],
  ['prototype member as type: __proto__', { v: 1, type: '__proto__', payload: {} }],
  ['prototype member as type: toString', { v: 1, type: 'toString', payload: {} }],
  ['unknown type', { v: 1, type: 'teleport', payload: {} }],
  ['malformed height', { v: 1, type: 'resize', payload: { height: Number.NaN } }],
  ['missing payload', { v: 1, type: 'resize' }],
  ['null', null],
  ['a string', 'ready'],
];

/** Null, accepted, or threw — the three outcomes a caller can observe. */
function classify(parse: (data: unknown) => unknown, message: unknown): string {
  try {
    return parse(message) === null ? 'null' : 'accepted';
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe('loader and @doola/sdk-protocol', () => {
  it.each(CORPUS)('agree on %s, without throwing', (_label, message) => {
    const loader = classify(loaderParse, message);

    expect(loader).not.toMatch(/^threw/);
    expect(classify(packageParse, message)).toBe(loader);
  });
});
