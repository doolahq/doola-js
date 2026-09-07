import { describe, expect, it } from 'vitest';

import { envelope, parseAppMessage, PROTOCOL_VERSION, tokenError } from '../src/protocol';

describe('parseAppMessage', () => {
  it('accepts a well-formed message at the current version', () => {
    const msg = parseAppMessage({ v: PROTOCOL_VERSION, type: 'resize', payload: { height: 640 } });
    expect(msg?.type).toBe('resize');
    expect(msg?.payload).toEqual({ height: 640 });
  });

  it('rejects a message from a future protocol version', () => {
    expect(parseAppMessage({ v: PROTOCOL_VERSION + 1, type: 'resize', payload: {} })).toBeNull();
  });

  it('accepts N-1 messages', () => {
    expect(
      parseAppMessage({ v: PROTOCOL_VERSION - 1, type: 'resize', payload: { height: 1 } }),
    ).not.toBeNull();
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

  it('stamps outbound messages with the current version', () => {
    expect(
      envelope({
        type: 'token',
        payload: { session: { accessToken: 'cs_test_x', expiresIn: 600 } },
      }).v,
    ).toBe(PROTOCOL_VERSION);
  });
});
