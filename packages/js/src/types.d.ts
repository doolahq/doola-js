/**
 * @doola/js — public contract for the doola embedded SDK.
 *
 * Every exported name here is effectively permanent once partners ship
 * against it — see CONTRIBUTING.md for the contract-surface rules.
 *
 * This package contains no UI and no loader logic: it injects doola's
 * versioned loader, which mounts an iframe against the SDK origin —
 * sdk.doola.com by default — where every screen lives.
 */

/**
 * A short-lived credential for one of the partner's customers, minted by
 * the partner's server via POST /v1/partner/customer-sessions.
 */
export interface CustomerSession {
  /** The `cs_<env>_…` token. Held in memory; never persisted by the loader. */
  accessToken: string;

  /**
   * Remaining lifetime in seconds at mint time — the loader's only
   * expiry input, so its renewal timing never consults the end user's
   * device clock. Renewal mechanics live in docs/protocol.md and are
   * not part of this contract.
   */
  expiresIn: number;

  /**
   * Absolute expiry, for the partner's own server — the loader never
   * reads it, so forwarding it to the browser is optional. If forwarded,
   * it is RFC 3339 with a UTC offset or `Z` (`2026-08-31T10:00:00Z`),
   * straight from the broker response; an offset-less ISO 8601 string is
   * not valid here — JavaScript parses it as local time, a different
   * instant in every timezone.
   */
  expiresAt?: string | undefined;
}

/**
 * Supplied by the partner. Called on mount and again on every renewal,
 * so it must always fetch a fresh session from the partner's own server
 * — the one place their doola API key lives.
 *
 * A function rather than a token, for the same reason Stripe Connect
 * takes `fetchClientSecret` as a function: renewal re-enters the
 * partner's backend, which re-checks its own user session. A doola
 * session can never outlive the partner login that created it.
 *
 * On failure, reject with an object exposing the HTTP `status` the
 * partner's route observed —
 * `throw Object.assign(new Error('doola session'), { status: r.status })`.
 * The route itself must never flatten a failure to 200, and must never
 * forward doola's own 401: that status means the partner's key or
 * tenant, not the customer's session, and the loader reads any 401 as
 * `partner_session_expired` — forwarding it would loop an
 * already-logged-in customer through the partner's login. The route
 * rewrites it to a 5xx (the README route uses 502) so it lands in the
 * transient bucket. Every other status passes through — the route's own
 * 401 and doola's 409 are the customer-addressed ones — so statuses
 * doola adds later reach the loader without partner code changes. The
 * loader maps the status to a {@link DoolaAuthError}; each case's
 * meaning is documented there, and the mapping itself is loader policy
 * (docs/protocol.md).
 */
export type FetchAccessToken = () => Promise<CustomerSession>;

/**
 * Raised when a session cannot be established or renewed.
 *
 * `partner_session_expired` is the case the partner MUST handle: their
 * own user's session died, their token route returned 401, and retrying
 * cannot succeed — doola cannot log a user back in to someone else's
 * product. The expected response is redirecting the user to the
 * partner's own login.
 *
 * `email_in_use` is the other terminal case: the customer's email
 * already belongs to a doola account outside the partner's tenant (the
 * broker's 409 `E_EMAIL_IN_USE`). First mint only, never on renewal, and
 * retrying never succeeds — the expected response is a support path or a
 * different email.
 */
export interface DoolaAuthError {
  type: 'partner_session_expired' | 'email_in_use' | 'mint_failed' | 'renewal_failed';
  message: string;
}

/** Errors surfaced while a component is loading or running. */
export interface DoolaLoadError {
  type:
    | 'api_connection_error'
    | 'authentication_error'
    | 'invalid_request_error'
    | 'render_error'
    | 'api_error';
  message: string;
}

/**
 * How the frame presents on constrained viewports.
 *
 * `fullScreen` promotes the iframe to a fixed full-viewport overlay so
 * the frame owns the whole scroll context — the mitigation for the iOS
 * keyboard covering focused inputs inside a scrolled iframe. `auto`
 * (the default) applies that promotion on narrow viewports on its own;
 * the threshold is loader policy, not a partner option, because the
 * failure it prevents is a property of the device and invisible in the
 * partner's own testing. There is deliberately no way to opt out of
 * the keyboard fix — only to force the overlay for layouts that want
 * it everywhere.
 */
export interface Presentation {
  mode?: 'fullScreen' | 'auto' | undefined;
}

/**
 * Options accepted by {@link loadDoola}. Passed once, at init. A repeat
 * `loadDoola` call with the same `publishableKey` resolves to the live
 * instance, ignoring the options it carries; a different key rejects
 * until `destroy()`.
 */
export interface DoolaOptions {
  /**
   * The partner's publishable key (`pk_test_…` or `pk_live_…`).
   * Public by design: it identifies the partner and selects branding,
   * nothing else. The key prefix also selects the environment — the API
   * host and the SDK origin together: test keys talk to the test stack
   * and load the app from `https://sdk.test.doola.com`, live keys to
   * production and `https://sdk.doola.com`.
   */
  publishableKey: string;

  fetchAccessToken: FetchAccessToken;

  /**
   * MUST be handled — see {@link DoolaAuthError} for each case and the
   * expected response. Fires on every failed fetch, not once per
   * incident — retries, frame-initiated renewals, and later mounts all
   * fetch again. Handlers must be idempotent: a redirect to your login
   * must tolerate being triggered more than once.
   */
  onAuthError: (error: DoolaAuthError) => void;

  /**
   * The payment handoff. Fires when the customer completes the wizard
   * and the draft formation is submitted. On the partner-facing surface
   * the company then reads as `status: "PENDING"` from
   * GET /v1/partner/companies/{companyId} — nothing is filed and nothing
   * is spent until the partner's server confirms payment. (`PENDING`
   * today covers both "not paid" and "paid, not picked up yet"; the
   * discriminator ships with the payment-confirmation endpoint.)
   *
   * Carries ONLY the company id. Deliberately no amount, state, or
   * add-on selection: anything delivered into the partner page's
   * JavaScript can be edited in DevTools before checkout reads it. The
   * partner's server derives what is owed from
   * GET /v1/partner/companies/{companyId}.
   */
  onFormed: (event: { companyId: string }) => void;

  /** Fired the first time any UI (including a loading state) is visible inside the frame. */
  onLoaderStart?: (() => void) | undefined;

  /**
   * Fired when the component fails to load. May fire more than once;
   * handlers must be idempotent.
   */
  onLoadError?: ((error: DoolaLoadError) => void) | undefined;

  /**
   * Where the embedded app is served from, for partners serving the SDK
   * from their own domain via CNAME. Overrides exactly the SDK-origin
   * half of the environment and nothing else — the API host still
   * follows the key. The loader also uses this value as its postMessage
   * origin check, both directions — it is a trust anchor: the session
   * token is posted to this origin. It MUST be a constant in your code,
   * never derived from a URL parameter, form input, or anything else a
   * user can influence.
   */
  origin?: string | undefined;

  presentation?: Presentation | undefined;

  /**
   * BCP 47 tag. v1 supports `en` only; the option exists so adding locales
   * is not a breaking change. Branding itself is not an option here — it
   * is configured once in the partner portal and served inside the frame,
   * so every page embedding a partner renders that partner the same way.
   */
  locale?: string | undefined;
}

/**
 * The mounted handle. The returned element is a standard custom
 * element: append it to the DOM to mount, remove it to unmount.
 * It behaves as a block element — 100% of the parent's width, height
 * driven by content via the loader's resize negotiation.
 *
 * Deliberately an interface, not a type alias: methods on the handle can
 * be added additively in later minors without renaming the public type.
 */
export interface DoolaComponent extends HTMLElement {}

/** The initialized SDK instance. */
export interface Doola {
  /**
   * Returns the embedded-app element. Takes no arguments: the partner
   * does not choose what renders — on every mount the app resolves the
   * session's customer and routes. No company yet lands on the formation
   * wizard; an existing company lands on that company's view, whose
   * state decides the screen — right after checkout that is the waiting
   * state, until the partner's payment confirmation reaches doola.
   */
  create(): DoolaComponent;

  /**
   * Runtime updates. Only `locale` can change after init. Merge
   * semantics, per key: a key absent from the call keeps its current
   * value; a key present with the value `undefined` clears it back to the
   * default. The `| undefined` on the option is contract-bearing for
   * exactly this reason, not style.
   */
  update(options: Pick<DoolaOptions, 'locale'>): void;

  /**
   * Tears down every component and the session. Call on the partner
   * app's logout, never on ordinary unmount or navigation. The instance
   * is dead afterwards: `create()` and `update()` on it throw. To embed
   * again on the same page (an SPA logout → login), call
   * {@link loadDoola} again — it returns a fresh instance without
   * re-injecting the script.
   */
  destroy(): void;
}
