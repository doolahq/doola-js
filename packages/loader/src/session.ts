import type { CustomerSession, DoolaAuthError, FetchAccessToken } from '@doola/js';

import { parseSession } from './protocol';

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
 * doola answers 409 for several reasons, so a 409 is named by the `code` the
 * rejection carries (FetchAccessToken docs).
 */
const CONFLICTS: ReadonlyMap<string, DoolaAuthError['type']> = new Map([
  ['E_EMAIL_IN_USE', 'email_in_use'],
  ['E_RESOURCE_CONFLICT', 'external_id_conflict'],
  ['E_CUSTOMER_REVOKED', 'customer_revoked'],
] as const);

/**
 * doola's codes only. A client library puts its own `code` on a rejection
 * (axios rejects a 409 with `ERR_BAD_REQUEST`), and that must not take a
 * status-only route off the /v1 mapping.
 */
const DOOLA_CODE = /^E_[A-Z0-9_]+$/;

/** What the partner's `onAuthError` is told, and the reason the frame shows. */
interface AuthFailure {
  error: DoolaAuthError;
  shown: DoolaAuthError['type'];
}

type Classified = { type: DoolaAuthError['type']; shown: DoolaAuthError['type'] };

const same = (type: DoolaAuthError['type']): Classified => ({ type, shown: type });

/**
 * The status→type mapping the loader owns (docs/protocol.md). The public
 * contract (FetchAccessToken docs) asks partners to reject with an object
 * exposing the HTTP `status`, and the `code` their route forwarded.
 * This is the implementer of that published rule.
 */
function classifyRejection(error: unknown, renewal: boolean): Classified {
  const { status, code } = rejection(error);
  const fallback = renewal ? 'renewal_failed' : 'mint_failed';

  if (status === 401) return same('partner_session_expired');
  if (status !== 409) return same(fallback);

  // A route that forwards only the status, as every route did before the code
  // existed. /v1 keeps telling the partner email_in_use on the first mint, but
  // the email may not be the cause, so the founder gets the neutral copy.
  if (code === undefined) {
    return renewal ? same(fallback) : { type: 'email_in_use', shown: 'mint_failed' };
  }

  const conflict = CONFLICTS.get(code);

  // The contract promises email_in_use on the first mint only. Mid-session the
  // frame keeps working until the token expires, which renewal_failed says.
  if (conflict === 'email_in_use' && renewal) return same(fallback);

  return same(conflict ?? fallback);
}

function rejection(error: unknown): { status?: unknown; code?: string } {
  if (typeof error !== 'object' || error === null) return {};

  const { status, code } = error as { status?: unknown; code?: unknown };

  return typeof code === 'string' && DOOLA_CODE.test(code) ? { status, code } : { status };
}

/**
 * Owns the one session shared by every component of a Doola instance.
 * The embedded app cannot renew — fetchAccessToken is partner code
 * living in the partner's page — so renewal always happens here and the
 * fresh session reaches every mounted frame.
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
    private readonly onAuthError: (failure: AuthFailure) => void,
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
    const renewal = this.active !== null;

    // Collapse concurrent callers (several components mounting at once,
    // or the proactive timer racing the 401 backstop) into one fetch.
    return (this.pending ??= this.mint(renewal));
  }

  // async on purpose: a synchronous throw from partner code becomes a
  // rejection, so the catch below — the only path that delivers onAuthError
  // and token-error — always runs.
  private async mint(renewal: boolean): Promise<CustomerSession> {
    try {
      // Parsed, not trusted: this is the partner's own code and the second
      // untrusted boundary after the bus. A bad session here is not an error,
      // it is a renewal loop — see parseSession.
      const session = parseSession(await this.fetchAccessToken());
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

      const { type, shown } = classifyRejection(error, renewal);
      const message = error instanceof Error ? error.message : String(error);
      this.onAuthError({ error: { type, message }, shown });

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
