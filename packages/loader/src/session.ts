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

/** The session plus its deadlines, precomputed once on the local clock at receipt. */
interface ActiveSession {
  session: CustomerSession;
  renewAt: number;
  staleAt: number;
}

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
  private active: ActiveSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<CustomerSession> | null = null;
  // Starts paused: a mint must not begin a renewal loop on a page that
  // never mounts a frame. resume() runs on first mount.
  private paused = true;
  // Set by stop(). A fetch already in flight then settles silently: nothing
  // cached, nothing scheduled, no callback either way — the partner asked
  // for teardown, not for whatever the result would otherwise imply.
  private stopped = false;

  constructor(
    private readonly fetchAccessToken: FetchAccessToken,
    private readonly onAuthError: (error: DoolaAuthError) => void,
    private readonly onSession: (session: CustomerSession) => void,
  ) {}

  /** The current session, minting or re-minting if absent or stale. */
  current(): Promise<CustomerSession> {
    const fresh = this.fresh();
    if (fresh) return Promise.resolve(fresh.session);

    return this.refresh();
  }

  /** Backstop path: the app hit a 401 mid-session and asked for a fresh token. */
  renewNow(): void {
    // Failure is already routed to onAuthError inside refresh(); swallowing
    // the rejection keeps a failed background renewal from surfacing as an
    // unhandled rejection in the partner's console.
    this.refresh().catch(() => {});
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

    const fresh = this.fresh();
    if (fresh) this.schedule(fresh);
    else this.renewNow();
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    this.active = null;
  }

  /** The live session if it is still fresh enough to hand out, else null. */
  private fresh(): ActiveSession | null {
    return this.active && Date.now() < this.active.staleAt ? this.active : null;
  }

  private refresh(): Promise<CustomerSession> {
    // Whether a failure is a mint or a renewal is session state, not the
    // caller's business (docs/protocol.md step 4): once any session has
    // existed, every re-fetch is a renewal.
    const fallback: DoolaAuthError['type'] = this.active ? 'renewal_failed' : 'mint_failed';

    // Collapse concurrent callers (several components mounting at once,
    // or the proactive timer racing the 401 backstop) into one fetch.
    return (this.pending ??= this.mint(fallback));
  }

  // async on purpose: a synchronous throw from partner code becomes a
  // rejection, so the catch below — the only path that delivers onAuthError
  // and token-error — always runs.
  private async mint(fallback: DoolaAuthError['type']): Promise<CustomerSession> {
    try {
      const session = await this.fetchAccessToken();
      if (this.stopped) return session;

      const now = Date.now();
      const ttlMs = session.expiresIn * 1_000;
      const active: ActiveSession = {
        session,
        renewAt: now + ttlMs * RENEWAL_FRACTION,
        staleAt: now + ttlMs - STALENESS_MARGIN_MS,
      };
      this.active = active;

      if (!this.paused) this.schedule(active);
      this.onSession(session);

      return session;
    } catch (error: unknown) {
      if (this.stopped) throw error;

      const type = classifyRejection(error, fallback);
      this.onAuthError({ type, message: error instanceof Error ? error.message : String(error) });

      throw error;
    } finally {
      this.pending = null;
    }
  }

  /**
   * Fire at 80% of the lifetime, counted from receipt. On a mid-life
   * resume the delay is the remainder to the same point, so pause/resume
   * never renews earlier or later than planned.
   */
  private schedule(active: ActiveSession): void {
    if (this.timer) clearTimeout(this.timer);

    const delay = active.renewAt - Date.now();

    this.timer = setTimeout(() => this.renewNow(), Math.max(delay, MIN_RENEWAL_DELAY_MS));
  }
}
