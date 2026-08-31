import type { CustomerSession, DoolaAuthError, FetchAccessToken } from '@doola/js';

/**
 * Renew at this fraction of the token's lifetime. Loader policy,
 * deliberately not part of the public contract (docs/protocol.md).
 */
const RENEWAL_FRACTION = 0.8;

/** Floor so a short-lived or already-stale token can't schedule a zero-delay renewal loop. */
const MIN_RENEWAL_DELAY_MS = 5_000;

/** Treat a session this close to expiry as stale when resuming. */
const STALENESS_MARGIN_MS = 30_000;

/**
 * The status→type mapping the loader owns (docs/protocol.md). The public
 * contract (FetchAccessToken docs) asks partners to reject with an object
 * exposing the HTTP `status` — throwing the fetch Response satisfies it.
 * This is the implementer of that published rule.
 */
function classifyRejection(
  error: unknown,
  fallback: DoolaAuthError['type'],
): DoolaAuthError['type'] {
  const status =
    typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null;

  if (status === 401) return 'partner_session_expired';
  if (status === 409) return 'email_in_use';

  return fallback;
}

/**
 * Owns the one session shared by every component of a Doola instance.
 * The embedded app cannot renew — fetchAccessToken is partner code
 * living in the partner's page — so renewal always happens here and the
 * fresh token is broadcast into every mounted frame.
 *
 * All expiry arithmetic is `expiresIn` relative to the local receipt
 * time — one clock, so client clock skew cannot mistime a renewal
 * (docs/protocol.md, "Token renewal").
 *
 * Renewal only runs while frames are mounted: pause() on last
 * disconnect stops the timer so an idle page never mints tokens nobody
 * consumes; resume() re-mints on next mount if the session went stale.
 */
export class SessionManager {
  private session: CustomerSession | null = null;
  /** Local-clock ms when the current session arrived. */
  private receivedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<CustomerSession> | null = null;
  // Starts paused: the warm-start mint must not begin a renewal loop on a
  // page that never mounts a frame. resume() runs on first mount.
  private paused = true;
  private stopped = false;

  constructor(
    private readonly fetchAccessToken: FetchAccessToken,
    private readonly onAuthError: (error: DoolaAuthError) => void,
    private readonly onSession: (session: CustomerSession) => void,
  ) {}

  /** The current session, minting or re-minting if absent or stale. */
  current(): Promise<CustomerSession> {
    if (this.session && !this.isStale()) return Promise.resolve(this.session);

    return this.refresh('mint_failed');
  }

  /** Backstop path: the app hit a 401 mid-session and asked for a fresh token. */
  renewNow(): void {
    // Failure is already routed to onAuthError inside refresh(); swallowing
    // the rejection keeps a failed background renewal from surfacing as an
    // unhandled rejection in the partner's console.
    this.refresh('renewal_failed').catch(() => {});
  }

  /** Last frame disconnected: stop renewing until something consumes tokens again. */
  pause(): void {
    this.paused = true;

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** A frame (re)connected: restart proactive renewal. */
  resume(): void {
    this.paused = false;

    if (this.session && !this.isStale()) this.schedule();
    else this.renewNow();
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    this.session = null;
  }

  private ttlMs(): number {
    return (this.session?.expiresIn ?? 0) * 1_000;
  }

  private isStale(): boolean {
    return Date.now() - this.receivedAt > this.ttlMs() - STALENESS_MARGIN_MS;
  }

  private refresh(failureType: DoolaAuthError['type']): Promise<CustomerSession> {
    // Collapse concurrent callers (several components mounting at once,
    // or the proactive timer racing the 401 backstop) into one fetch.
    const pending = (this.pending ??= this.fetchAccessToken()
      .then((session) => {
        this.pending = null;
        if (this.stopped) return session;

        this.session = session;
        this.receivedAt = Date.now();
        if (!this.paused) this.schedule();
        this.onSession(session);

        return session;
      })
      .catch((error: unknown) => {
        this.pending = null;

        const type = classifyRejection(error, failureType);
        this.onAuthError({ type, message: error instanceof Error ? error.message : String(error) });

        throw error;
      }));

    return pending;
  }

  /**
   * Fire at receivedAt + 80% of the lifetime. At receipt that is a plain
   * relative timer; on a mid-life resume it is the remainder of the same
   * point, so pause/resume never renews earlier or later than planned.
   */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);

    const delay = this.receivedAt + this.ttlMs() * RENEWAL_FRACTION - Date.now();

    this.timer = setTimeout(() => this.renewNow(), Math.max(delay, MIN_RENEWAL_DELAY_MS));
  }
}
