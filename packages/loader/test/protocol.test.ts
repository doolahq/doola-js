import { describe, expect, it } from 'vitest';

import {
  envelope,
  negotiate,
  parseAppMessage,
  PROTOCOL_VERSION,
  tokenError,
} from '../src/protocol';

describe('parseAppMessage', () => {
  it('accepts a well-formed message at the current version', () => {
    const msg = parseAppMessage({ v: PROTOCOL_VERSION, type: 'resize', payload: { height: 640 } });
    expect(msg?.type).toBe('resize');
    expect(msg?.payload).toEqual({ height: 640 });

    expect(
      parseAppMessage({ v: PROTOCOL_VERSION, type: 'formed', payload: { companyId: 'c_1' } }),
    ).not.toBeNull();
    expect(
      parseAppMessage({ v: PROTOCOL_VERSION, type: 'ready', payload: { protocolMax: 2 } }),
    ).not.toBeNull();
  });

  it('rejects a message from a future protocol version', () => {
    expect(parseAppMessage({ v: PROTOCOL_VERSION + 1, type: 'resize', payload: {} })).toBeNull();
  });

  it('accepts N-1 messages', () => {
    expect(
      parseAppMessage({ v: PROTOCOL_VERSION - 1, type: 'resize', payload: { height: 1 } }),
    ).not.toBeNull();
  });

  it('drops a known type whose payload has the wrong shape', () => {
    const bad = [
      { type: 'ready', payload: { protocolMax: 'x' } },
      { type: 'ready', payload: { protocolMax: 0 } },
      { type: 'ready', payload: { protocolMax: 1.5 } },
      { type: 'formed', payload: { companyId: 123 } },
      { type: 'formed', payload: { companyId: '' } },
      { type: 'resize', payload: { height: Number.NaN } },
      { type: 'auth-error', payload: { type: 'not_a_case', message: 'x' } },
      { type: 'load-error', payload: { type: 'api_error', message: 42 } },
    ];
    for (const m of bad) {
      expect(parseAppMessage({ v: PROTOCOL_VERSION, ...m }), JSON.stringify(m)).toBeNull();
    }
  });

  it('rejects non-envelope junk without throwing', () => {
    for (const junk of [
      null,
      'string',
      42,
      {},
      { v: 1 },
      { v: 1, type: 'x' },
      { type: 'resize', payload: {} },
    ]) {
      expect(parseAppMessage(junk)).toBeNull();
    }
  });

  it('marks only the terminal auth cases as not retryable', () => {
    const retryable = (type: Parameters<typeof tokenError>[0]['type']) =>
      tokenError({ type, message: '' }).payload.retryable;

    expect(retryable('partner_session_expired')).toBe(false);
    expect(retryable('email_in_use')).toBe(false);
    expect(retryable('mint_failed')).toBe(true);
    expect(retryable('renewal_failed')).toBe(true);
  });

  it("stamps outbound messages with the version it is given, not this side's maximum", () => {
    const token = {
      type: 'token',
      payload: { session: { accessToken: 'cs_test_x', expiresIn: 600 } },
    } as const;

    expect(envelope(token, PROTOCOL_VERSION).v).toBe(PROTOCOL_VERSION);

    // The case that matters once PROTOCOL_VERSION moves past an app's maximum:
    // after negotiating down, everything after init is spoken in the agreed
    // version, so an app applying parseAppMessage's own rule still accepts it.
    const agreed = negotiate(1);
    expect(envelope(token, agreed).v).toBe(agreed);
  });

  it('negotiates down to the lower of the two maximums', () => {
    expect(negotiate(PROTOCOL_VERSION + 1)).toBe(PROTOCOL_VERSION);
    expect(negotiate(1)).toBe(1);
  });
});
