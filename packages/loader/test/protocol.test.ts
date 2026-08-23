import { describe, expect, it } from 'vitest';

import { envelope, parseAppMessage, PROTOCOL_VERSION } from '../src/protocol';

describe('parseAppMessage', () => {
  it('accepts a well-formed message at the current version', () => {
    const msg = parseAppMessage({ v: PROTOCOL_VERSION, type: 'resize', payload: { height: 640 } });
    expect(msg).toEqual({ type: 'resize', payload: { height: 640 } });
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

  it('stamps outbound messages with the current version', () => {
    expect(
      envelope({
        type: 'token',
        payload: { session: { accessToken: 'cs_test_x', expiresAt: 'now' } },
      }).v,
    ).toBe(PROTOCOL_VERSION);
  });
});
