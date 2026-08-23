import type { CustomerSession, DoolaAuthError, FetchAccessToken } from '@doola/js';

/**
 * Renew at this fraction of the token's remaining life. Loader policy,
 * deliberately not part of the public contract (docs/protocol.md).
 */
const RENEWAL_FRACTION = 0.8;

/** Floor so a short-lived or clock-skewed token can't schedule a zero-delay renewal loop. */
const MIN_RENEWAL_DELAY_MS = 5_000;

/** Treat a session this close to expiry as stale when resuming. */
const STALENESS_MARGIN_MS = 30_000;

function isPartnerSessionExpired(error: unknown): boolean {
  // The public contract (FetchAccessToken docs) asks partners to reject
  // with an object exposing `status: 401` — throwing the fetch Response
  // satisfies it. This is the implementer of that published rule.
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
  );
}

/**
 * Owns the one session shared by every component of a Doola instance.
 * The embedded app cannot renew — fetchAccessToken is partner code
 * living in the partner's page — so renewal always happens here and the
 * fresh token is broadcast into every mounted frame.
 *
 * Renewal only runs while frames are mounted: pause() on last
 * disconnect stops the timer so an idle page never mints tokens nobody
 * consumes; resume() re-mints on next mount if the session went stale.
 */
export class SessionManager {
  private session: CustomerSession | null = null;
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
    if (this.session && !this.isStale(this.session)) return Promise.resolve(this.session);

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

    if (this.session && !this.isStale(this.session)) this.schedule(this.session.expiresAt);
    else this.renewNow();
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    this.session = null;
  }

  private isStale(session: CustomerSession): boolean {
    return new Date(session.expiresAt).getTime() - Date.now() < STALENESS_MARGIN_MS;
  }

  private refresh(failureType: DoolaAuthError['type']): Promise<CustomerSession> {
    // Collapse concurrent callers (several components mounting at once,
    // or the proactive timer racing the 401 backstop) into one fetch.
    const pending = (this.pending ??= this.fetchAccessToken()
      .then((session) => {
        this.pending = null;
        if (this.stopped) return session;

        this.session = session;
        if (!this.paused) this.schedule(session.expiresAt);
        this.onSession(session);

        return session;
      })
      .catch((error: unknown) => {
        this.pending = null;

        const type = isPartnerSessionExpired(error) ? 'partner_session_expired' : failureType;
        this.onAuthError({ type, message: error instanceof Error ? error.message : String(error) });

        throw error;
      }));

    return pending;
  }

  private schedule(expiresAt: string): void {
    if (this.timer) clearTimeout(this.timer);

    const remaining = new Date(expiresAt).getTime() - Date.now();
    const delay = Math.max(remaining * RENEWAL_FRACTION, MIN_RENEWAL_DELAY_MS);

    this.timer = setTimeout(() => this.renewNow(), delay);
  }
}
