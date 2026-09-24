import { loadDoola } from '@doola/js';
import { describe, expect, it } from 'vitest';

describe('loadDoola', () => {
  it('rejects on the server with the SSR hint, not a ReferenceError on window', async () => {
    await expect(
      loadDoola({
        publishableKey: 'pk_test_ssr',
        fetchAccessToken: () => Promise.resolve({ accessToken: 'cs_ssr', expiresIn: 3600 }),
        onAuthError: () => {},
        onFormed: () => {},
      }),
    ).rejects.toThrow(/must run in a browser/);
  });
});
