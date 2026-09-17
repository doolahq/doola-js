import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '../src/messages';
import { appEnvelope, loaderEnvelope } from '../src/envelope';
import { parseLoaderMessage } from '../src/parse';

import { APP_MESSAGES, LOADER_MESSAGES, session } from './fixtures';

describe('projection', () => {
  it('puts only the company id on the wire, whatever it was handed', () => {
    const leaky = { companyId: 'c_1', ownerSsn: '000-00-0000', email: 'a@b.co' };

    const sent = appEnvelope(
      // A wider object assigned to a narrower type: legal TypeScript, and
      // exactly what the projection exists to stop.
      { type: 'formed', payload: leaky as { companyId: string } },
      PROTOCOL_VERSION,
    );

    expect(sent.payload).toStrictEqual({ companyId: 'c_1' });
  });

  it('forwards only the session fields the contract defines', () => {
    const fromPartnerRoute = { ...session, refreshToken: 'do-not-forward' };

    const sent = loaderEnvelope(
      { type: 'token', payload: { session: fromPartnerRoute } },
      PROTOCOL_VERSION,
    );

    expect(sent.payload).toStrictEqual({ session: { accessToken: 'cs_test_abc', expiresIn: 600 } });
  });

  it('omits an absent optional key rather than sending it as undefined', () => {
    const sent = loaderEnvelope(
      { type: 'init', payload: { session, protocol: 1 } },
      PROTOCOL_VERSION,
    );

    // toStrictEqual, not toEqual: the latter treats { locale: undefined } as
    // equal to {}, and the structured clone behind postMessage does not.
    expect(Object.keys(sent.payload).sort()).toStrictEqual(['protocol', 'session']);

    // Which is also the init a loader older than `presentation` sends, and a
    // new app still has to accept it.
    expect(parseLoaderMessage(sent)).not.toBeNull();
  });

  it.each(Object.values(APP_MESSAGES).map((m) => [m.type, m] as const))(
    'keeps every declared field of %s',
    (_type, message) => {
      const sent = appEnvelope(message, PROTOCOL_VERSION);

      expect(sent.type).toBe(message.type);
      expect(sent.payload).toStrictEqual(message.payload);
    },
  );

  it.each(Object.values(LOADER_MESSAGES).map((m) => [m.type, m] as const))(
    'keeps every declared field of %s',
    (_type, message) => {
      const sent = loaderEnvelope(message, PROTOCOL_VERSION);

      expect(sent.type).toBe(message.type);
      expect(sent.payload).toStrictEqual(message.payload);
    },
  );
});

describe('stamping', () => {
  it('carries the version it was given, not the newest one', () => {
    expect(appEnvelope(APP_MESSAGES.resize, 1).v).toBe(1);
    expect(loaderEnvelope(LOADER_MESSAGES.token, 1).v).toBe(1);
  });
});
