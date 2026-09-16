import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../src/session';

const session = (expiresIn: number) => ({
  accessToken: 'cs_test_token',
  expiresIn,
});

const TEN_MINUTES_S = 600;
const TEN_MINUTES_MS = TEN_MINUTES_S * 1_000;

describe('SessionManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mints once and shares the result across concurrent callers', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    const [a, b] = await Promise.all([manager.current(), manager.current()]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('does not start a renewal loop while nothing is mounted', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 3);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renews proactively at 80% of expiresIn once resumed, and broadcasts', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const onSession = vi.fn();
    const manager = new SessionManager(fetch, vi.fn(), onSession);

    await manager.current();
    manager.resume();
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 0.8 - 1_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onSession).toHaveBeenCalledTimes(2);
  });

  it('a mid-life pause/resume keeps the original renewal point instead of restarting the 80%', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    manager.resume();

    // 6 of the 8 minutes to the renewal point pass, then a remount cycle.
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 0.6);
    manager.pause();
    manager.resume();

    // The renewal still fires ~2 minutes later, not 8 minutes later.
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 0.2 + 1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pause() stops renewing; resume() with a stale session re-mints', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    manager.resume();
    manager.pause();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(1);

    manager.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['already expired', 0],
    ['negative', -10],
    ['undefined', undefined],
    ['a non-numeric string', 'abc'],
    ['null', null],
  ])(
    'rejects the mint when expiresIn is %s, instead of renewing on a timer',
    async (_label, value) => {
      const fetch = vi.fn().mockResolvedValue({ accessToken: 'cs_test_token', expiresIn: value });
      const onAuthError = vi.fn();
      const manager = new SessionManager(fetch, onAuthError, vi.fn());

      await expect(manager.current()).rejects.toThrow(/expiresIn/);

      manager.resume();
      await vi.advanceTimersByTimeAsync(300);

      // The floor cannot hold for a NaN delay — Math.max propagates NaN — so
      // before this was validated, the non-numeric rows renewed on every tick.
      expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
      expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'mint_failed' }));
    },
  );

  it('maps a 401 rejection to partner_session_expired', async () => {
    const onAuthError = vi.fn();
    const manager = new SessionManager(
      vi.fn().mockRejectedValue({ status: 401 }),
      onAuthError,
      vi.fn(),
    );

    await expect(manager.current()).rejects.toBeDefined();
    expect(onAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'partner_session_expired' }),
    );
  });

  it('routes a synchronous throw from fetchAccessToken through onAuthError like a rejection', async () => {
    const onAuthError = vi.fn();
    const manager = new SessionManager(
      vi.fn(() => {
        throw new Error('sync');
      }),
      onAuthError,
      vi.fn(),
    );

    await expect(manager.current()).rejects.toThrow('sync');
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'mint_failed' }));
  });

  it('maps a 409 rejection to email_in_use', async () => {
    const onAuthError = vi.fn();
    const manager = new SessionManager(
      vi.fn().mockRejectedValue({ status: 409 }),
      onAuthError,
      vi.fn(),
    );

    await expect(manager.current()).rejects.toBeDefined();
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'email_in_use' }));
  });

  it('maps a first-fetch failure to mint_failed and a renewal failure to renewal_failed', async () => {
    const onAuthError = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(session(TEN_MINUTES_S))
      .mockRejectedValueOnce(new Error('down'));
    const manager = new SessionManager(fetch, onAuthError, vi.fn());

    await manager.current();
    manager.resume();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'renewal_failed' }));

    const failing = new SessionManager(
      vi.fn().mockRejectedValue(new Error('down')),
      onAuthError,
      vi.fn(),
    );
    await expect(failing.current()).rejects.toBeDefined();
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'mint_failed' }));
  });

  it('a fetch that fails after stop() reaches nobody', async () => {
    let reject: (e: unknown) => void = () => {};
    const fetch = vi.fn(() => new Promise<never>((_, r) => (reject = r)));
    const onAuthError = vi.fn();
    const manager = new SessionManager(fetch, onAuthError, vi.fn());

    const pending = manager.current();
    manager.stop();
    reject({ status: 401 });

    await expect(pending).rejects.toBeDefined();
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('stop() cancels the pending renewal', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES_S));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    manager.resume();
    manager.stop();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 2);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('parseSession', () => {
  it('rejects a session the app would reject, before it reaches the frame', async () => {
    // The app's isSession requires a non-empty accessToken; a session that
    // fails there drops the whole init and the frame connects forever.
    const fetch = vi.fn().mockResolvedValue({ token: 'cs_test_token', expiresIn: 600 });
    const onAuthError = vi.fn();
    const manager = new SessionManager(fetch, onAuthError, vi.fn());

    await expect(manager.current()).rejects.toThrow(/accessToken/);
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ type: 'mint_failed' }));
  });

  it('forwards only the three documented fields', async () => {
    const onSession = vi.fn();
    const manager = new SessionManager(
      vi.fn().mockResolvedValue({
        accessToken: 'cs_test_token',
        expiresIn: 600,
        expiresAt: '2026-08-31T10:00:00Z',
        refreshToken: 'must not reach the frame',
      }),
      vi.fn(),
      onSession,
    );

    expect(await manager.current()).toEqual({
      accessToken: 'cs_test_token',
      expiresIn: 600,
      expiresAt: '2026-08-31T10:00:00Z',
    });
    expect(onSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ refreshToken: expect.anything() }),
    );
  });

  it('omits expiresAt rather than sending it as undefined', async () => {
    const manager = new SessionManager(
      vi.fn().mockResolvedValue({ accessToken: 'cs_test_token', expiresIn: 600 }),
      vi.fn(),
      vi.fn(),
    );

    expect(Object.keys(await manager.current())).toEqual(['accessToken', 'expiresIn']);
  });
});
