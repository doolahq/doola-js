import { describe, expect, it } from 'vitest';

import { envFromPublishableKey } from '../src/env';

describe('envFromPublishableKey', () => {
  it('resolves live keys to the production stack', () => {
    expect(envFromPublishableKey('pk_live_abc').name).toBe('live');
    expect(envFromPublishableKey('pk_live_abc').sdkOrigin).toBe('https://sdk.doola.com');
  });

  it('resolves test keys to the test stack', () => {
    expect(envFromPublishableKey('pk_test_abc').name).toBe('test');
  });

  it('rejects secret keys with a pointed message', () => {
    expect(() => envFromPublishableKey('dk_live_abc')).toThrow(/Never use your secret dk_ key/);
  });

  it('rejects garbage', () => {
    expect(() => envFromPublishableKey('')).toThrow();
    expect(() => envFromPublishableKey('pk_prod_abc')).toThrow();
  });
});
