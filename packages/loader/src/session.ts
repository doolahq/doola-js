import type { CustomerSession, DoolaAuthError, FetchAccessToken } from '@doola/js';

/**
 * Renew at this fraction of the token's remaining life. Loader policy,
 * deliberately not part of the public contract (docs/protocol.md).
 */
const RENEWAL_FRACTION = 0.8;

/** Floor so a short-lived or clock-skewed token can't schedule a zero-delay renewal loop. */
const MIN_RENEWAL_DELAY_MS = 5_000;

function isPartnerSessionExpired(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
  );
}

/**
 * Owns the one session shared by every component of a Doola instance.
 * The embedded app cannot renew — fetchAccessToken is partner code
 * living in the partner's page — so renewal always happens here and the
 * fresh token is broadcast into every mounted frame.
 */
export class SessionManager {
  private session: CustomerSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<CustomerSession> | null = null;
  private stopped = false;

  constructor(
    private readonly fetchAccessToken: FetchAccessToken,
    private readonly onAuthError: (error: DoolaAuthError) => void,
    private readonly onSession: (session: CustomerSession) => void,
  ) {}

  /** The current session, fetching the first one if needed. */
  current(): Promise<CustomerSession> {
    if (this.session) return Promise.resolve(this.session);

    return this.refresh('mint_failed');
  }

  /** Backstop path: the app hit a 401 mid-session and asked for a fresh token. */
  renewNow(): void {
    this.refreshInBackground();
  }

  stop(): void {
    this.stopped = true;

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.session = null;
  }

  /**
   * Fire-and-forget renewal. The failure is already routed to onAuthError
   * inside refresh(); swallowing the rejection here keeps a failed
   * background renewal from surfacing as an unhandled rejection in the
   * partner's console.
   */
  private refreshInBackground(): void {
    this.refresh('renewal_failed').catch(() => {});
  }

  private refresh(failureType: DoolaAuthError['type']): Promise<CustomerSession> {
    // Collapse concurrent callers (several components mounting at once,
    // or the proactive timer racing the 401 backstop) into one fetch.
    const pending = (this.pending ??= this.fetchAccessToken()
      .then((session) => {
        this.pending = null;
        if (this.stopped) return session;

        this.session = session;
        this.schedule(session.expiresAt);
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

    this.timer = setTimeout(() => this.refreshInBackground(), delay);
  }
}
