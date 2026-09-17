import { describe, expect, it } from 'vitest';

import { MIN_SUPPORTED_VERSION, PROTOCOL_VERSION, negotiate } from '../src/messages';
import { parseAppMessage, parseLoaderMessage } from '../src/parse';

import { APP_MESSAGES, LOADER_MESSAGES, session } from './fixtures';

const DIRECTIONS = [
  { name: 'app -> peer', parse: parseAppMessage, messages: APP_MESSAGES },
  { name: 'peer -> app', parse: parseLoaderMessage, messages: LOADER_MESSAGES },
] as const;

describe.each(DIRECTIONS)('$name', ({ parse, messages }) => {
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
    [
      'token-error message is not a string',
      'token-error',
      { reason: 'mint_failed', message: 42, retryable: true },
    ],
  ])('drops when %s', (_why, type, payload) => {
    expect(parseLoaderMessage({ v: PROTOCOL_VERSION, type, payload })).toBeNull();
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

  it.each(['__proto__', 'toString'])(
    'ignores %s, which is on Object.prototype rather than in the spec',
    (type) => {
      expect(parseAppMessage({ v: PROTOCOL_VERSION, type, payload: {} })).toBeNull();
      expect(parseLoaderMessage({ v: PROTOCOL_VERSION, type, payload: {} })).toBeNull();
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
