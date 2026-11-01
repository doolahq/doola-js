import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MIN_SUPPORTED_VERSION, PROTOCOL_VERSION, negotiate } from '../src/messages';
import { parseAppMessage, parseLoaderMessage } from '../src/parse';

import { APP_MESSAGES, LOADER_MESSAGES, session } from './fixtures';

// `optionalOnly` names a message whose payload has no required field, which is
// where a payload that is the wrong kind of object has nothing else to fail on.
const DIRECTIONS = [
  {
    name: 'app -> peer',
    parse: parseAppMessage,
    messages: APP_MESSAGES,
    optionalOnly: 'token-request',
  },
  {
    name: 'peer -> app',
    parse: parseLoaderMessage,
    messages: LOADER_MESSAGES,
    optionalOnly: 'update',
  },
] as const;

const PROTOTYPE_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];

describe.each(DIRECTIONS)('$name', ({ parse, messages, optionalOnly }) => {
  it.each(Object.values(messages).map((m) => [m.type, m] as const))(
    'accepts a well-formed %s',
    (_type, message) => {
      expect(parse({ v: PROTOCOL_VERSION, ...message })).not.toBeNull();
    },
  );

  it('refuses a version outside the supported window', () => {
    const valid = Object.values(messages)[0]!;

    expect(parse({ v: PROTOCOL_VERSION + 1, ...valid })).toBeNull();
    expect(parse({ v: MIN_SUPPORTED_VERSION - 1, ...valid })).toBeNull();
    expect(parse({ v: MIN_SUPPORTED_VERSION, ...valid })).not.toBeNull();

    // NaN is a number and every comparison with it is false, so a bare range
    // check passes it through both bounds. Infinities and fractions name no
    // version either.
    for (const v of [NaN, Infinity, -Infinity, 1.5]) {
      expect(parse({ v, ...valid }), `v: ${v} was accepted`).toBeNull();
    }
  });

  it('refuses junk that is not an envelope', () => {
    for (const junk of [null, 'string', 42, {}, { v: 1 }, { v: '1', type: 'x', payload: {} }]) {
      expect(parse(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('ignores a type the other side invented', () => {
    expect(parse({ v: PROTOCOL_VERSION, type: 'teleport', payload: {} })).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)('ignores %s as a type, without throwing', (type) => {
    expect(parse({ v: PROTOCOL_VERSION, type, payload: {} })).toBeNull();
  });

  it.each([
    ['an array', []],
    ['a Date', new Date()],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a RegExp', /re/],
    ['an Error', new Error('boom')],
  ])('refuses %s in place of a payload', (_label, payload) => {
    expect(parse({ v: PROTOCOL_VERSION, type: optionalOnly, payload })).toBeNull();
  });

  it('accepts the plain empty payload those impersonate, with or without a prototype', () => {
    expect(parse({ v: PROTOCOL_VERSION, type: optionalOnly, payload: {} })).not.toBeNull();
    expect(
      parse({ v: PROTOCOL_VERSION, type: optionalOnly, payload: Object.create(null) as object }),
    ).not.toBeNull();
  });

  it('never throws on arbitrary input', () => {
    // Biased toward real envelopes so most cases reach the type lookup.
    const envelopeLike = fc.record({
      v: fc.oneof(fc.constant(PROTOCOL_VERSION), fc.anything()),
      type: fc.oneof(fc.constantFrom(...Object.keys(messages), ...PROTOTYPE_KEYS), fc.string()),
      payload: fc.oneof(fc.object(), fc.anything()),
    });

    fc.assert(
      fc.property(fc.oneof(envelopeLike, fc.anything()), (message) => {
        expect(() => parse(message)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });
});

describe('parseAppMessage payload rules', () => {
  it.each([
    ['protocolMax must be a positive integer', 'ready', { protocolMax: 0 }],
    ['protocolMax must not be fractional', 'ready', { protocolMax: 1.5 }],
    ['protocolMax must be a number', 'ready', { protocolMax: 'x' }],
    ['height must be finite', 'resize', { height: Number.NaN }],
    ['height must not be negative', 'resize', { height: -1 }],
    ['companyId must be present', 'formed', {}],
    ['companyId must be a non-empty string', 'formed', { companyId: '' }],
    ['auth-error type must be a contract case', 'auth-error', { type: 'nope', message: 'x' }],
    ['auth-error message must be a string', 'auth-error', { type: 'mint_failed', message: 42 }],
    ['load-error message must be a string', 'load-error', { type: 'api_error', message: 42 }],
    ['load-error type must be a contract case', 'load-error', { type: 'kaboom', message: 'x' }],
    ['top must be finite', 'scroll-request', { top: Number.NaN }],
  ])('drops when %s', (_why, type, payload) => {
    expect(parseAppMessage({ v: PROTOCOL_VERSION, type, payload })).toBeNull();
  });
});

describe('parseLoaderMessage payload rules', () => {
  it.each([
    ['the session has no token', 'token', { session: { accessToken: '', expiresIn: 600 } }],
    ['the session has no lifetime', 'token', { session: { accessToken: 'cs_x' } }],
    ['expiresIn is not a number', 'token', { session: { accessToken: 'cs_x', expiresIn: 'soon' } }],
    [
      'expiresAt is not a string',
      'token',
      { session: { accessToken: 'cs_x', expiresIn: 1, expiresAt: 5 } },
    ],
    ['protocol is zero', 'init', { session, protocol: 0 }],
    ['locale is not a string', 'update', { locale: 42 }],
    ['appearance is an array', 'update', { appearance: ['#fff'] }],
    ['preview is a number', 'update', { appearance: { brand: '#F9C800' }, preview: 1 }],
    ['preview is a boolean', 'update', { appearance: { brand: '#F9C800' }, preview: true }],
    ['preview is null', 'update', { appearance: { brand: '#F9C800' }, preview: null }],
    ['preview is an object', 'update', { appearance: { brand: '#F9C800' }, preview: {} }],
    ['preview is an array', 'update', { appearance: { brand: '#F9C800' }, preview: ['dashboard'] }],
    ['retryable is missing', 'token-error', { reason: 'mint_failed', message: 'x' }],
    [
      'reason is not a contract case',
      'token-error',
      { reason: 'vibes', message: 'x', retryable: true },
    ],
    ['mode is not a resolved mode', 'presentation', { mode: 'auto' }],
    ['the payload is an array', 'update', []],
    [
      'init presentation is not a resolved mode',
      'init',
      { session, protocol: 1, presentation: 'fullscreen' },
    ],
    // The guard spec.ts calls load-bearing: a non-positive lifetime becomes a
    // renewal timer that reschedules on every tick.
    ['expiresIn is zero', 'token', { session: { accessToken: 'cs_x', expiresIn: 0 } }],
    ['init locale is not a string', 'init', { session, protocol: 1, locale: 42 }],
    ['init appearance is not a map', 'init', { session, protocol: 1, appearance: 'blue' }],
    ['appearance is null', 'update', { appearance: null }],
    ['appearance is a Date', 'update', { appearance: new Date() }],
    ['appearance is a Map', 'update', { appearance: new Map([['brand', '#F9C800']]) }],
    [
      'token-error message is not a string',
      'token-error',
      { reason: 'mint_failed', message: 42, retryable: true },
    ],
  ])('drops when %s', (_why, type, payload) => {
    expect(parseLoaderMessage({ v: PROTOCOL_VERSION, type, payload })).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)('drops %s as a token-error reason', (reason) => {
    const payload = { reason, message: 'x', retryable: false };

    expect(parseLoaderMessage({ v: PROTOCOL_VERSION, type: 'token-error', payload })).toBeNull();
  });

  it.each([
    ['a null value, which is what the backend sent before PENG-6667', { brand: null }],
    ['a boolean, which is what attribution is', { attribution: true }],
    ['a number', { radius: 8 }],
    ['a string', { brand: '#F9C800' }],
    ['a shape the wire never anticipated', { logo: { url: 'x', alt: 'y' } }],
  ])('accepts appearance holding %s', (_why, appearance) => {
    // Narrowing this drops the whole update, not the one key — see Appearance.
    expect(
      parseLoaderMessage({ v: PROTOCOL_VERSION, type: 'update', payload: { appearance } }),
    ).not.toBeNull();
  });

  it.each(['onboarding', 'dashboard', 'a-newer-surface'])(
    'carries the preview surface %s, whatever the name',
    (preview) => {
      const update = parseLoaderMessage({
        v: PROTOCOL_VERSION,
        type: 'update',
        payload: { appearance: { brand: '#F9C800' }, preview },
      });

      expect(update?.type === 'update' && update.payload.preview).toBe(preview);
    },
  );

  it('accepts a session that carries expiresAt', () => {
    const payload = {
      session: { ...session, expiresAt: '2026-09-11T12:00:00Z' },
      protocol: 1,
    };

    expect(parseLoaderMessage({ v: PROTOCOL_VERSION, type: 'init', payload })).not.toBeNull();
  });
});

describe('negotiate', () => {
  it('never agrees to a version above this build', () => {
    expect(negotiate(PROTOCOL_VERSION + 5)).toBe(PROTOCOL_VERSION);
    expect(negotiate(PROTOCOL_VERSION)).toBe(PROTOCOL_VERSION);
  });
});
