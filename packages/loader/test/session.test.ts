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

  it('never schedules a zero-delay renewal loop for an already-expired expiresIn', async () => {
    const fetch = vi.fn().mockResolvedValue(session(0));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    manager.resume();
    await vi.advanceTimersByTimeAsync(4_999);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

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
