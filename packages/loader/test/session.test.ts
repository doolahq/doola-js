import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../src/session';

const session = (ttlMs: number) => ({
  accessToken: 'cs_test_token',
  expiresAt: new Date(Date.now() + ttlMs).toISOString(),
});

const TEN_MINUTES = 600_000;

describe('SessionManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mints once and shares the result across concurrent callers', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    const [a, b] = await Promise.all([manager.current(), manager.current()]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('does not start a renewal loop while nothing is mounted', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES * 3);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renews proactively at 80% of remaining life once resumed, and broadcasts', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES));
    const onSession = vi.fn();
    const manager = new SessionManager(fetch, vi.fn(), onSession);

    await manager.current();
    manager.resume();
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES * 0.8 - 1_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onSession).toHaveBeenCalledTimes(2);
  });

  it('pause() stops renewing; resume() with a stale session re-mints', async () => {
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    manager.resume();
    manager.pause();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES * 2);
    expect(fetch).toHaveBeenCalledTimes(1);

    manager.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never schedules a zero-delay renewal loop for an already-stale expiresAt', async () => {
    const fetch = vi.fn().mockResolvedValue(session(-1_000));
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

  it('maps a first-fetch failure to mint_failed and a renewal failure to renewal_failed', async () => {
    const onAuthError = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(session(TEN_MINUTES))
      .mockRejectedValueOnce(new Error('down'));
    const manager = new SessionManager(fetch, onAuthError, vi.fn());

    await manager.current();
    manager.resume();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

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
    const fetch = vi.fn().mockResolvedValue(session(TEN_MINUTES));
    const manager = new SessionManager(fetch, vi.fn(), vi.fn());

    await manager.current();
    manager.resume();
    manager.stop();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES * 2);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
