/**
 * @doola/js — public contract for the doola embedded SDK.
 *
 * Every exported name here is effectively permanent once partners ship
 * against it — see CONTRIBUTING.md for the contract-surface rules.
 *
 * This package contains no UI and no loader logic: it injects doola's
 * versioned loader, which mounts an iframe against sdk.doola.com where
 * every screen lives.
 */

/**
 * A short-lived credential for one of the partner's customers, minted by
 * the partner's server via POST /v1/partner/customer-sessions.
 *
 * This is the broker response passed through verbatim. `expiresAt` is
 * required: the loader uses it to renew the session proactively before
 * expiry. Renewal mechanics are specified in docs/protocol.md and are
 * not part of this contract.
 */
export interface CustomerSession {
  /** The `cs_<env>_…` token. Held in memory; never persisted by the loader. */
  accessToken: string;
  /** ISO 8601 expiry, straight from the broker response. */
  expiresAt: string;
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
 */
export interface DoolaAuthError {
  type: 'partner_session_expired' | 'mint_failed' | 'renewal_failed';
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
 * Runtime appearance overrides.
 *
 * The canonical branding — logo, colors, typography — is configured in
 * the partner portal and served inside the iframe document itself, so it
 * applies before first paint with no flash. This object is a narrow
 * per-mount override on top of that, mirroring the portal's token set.
 * It cannot reference doola's internal DOM: no selectors, no CSS.
 */
export interface Appearance {
  variables?: {
    colorPrimary?: string;
    colorBackground?: string;
    colorText?: string;
    colorDanger?: string;
    fontFamily?: string;
    borderRadius?: string;
    spacingUnit?: string;
  };
}

/**
 * How the frame presents on constrained viewports.
 *
 * `fullScreen` promotes the iframe to a fixed full-viewport overlay so
 * the frame owns the whole scroll context — the mitigation for the iOS
 * keyboard covering focused inputs inside a scrolled iframe. With mode
 * `auto` (default), inline presentation promotes to full screen below
 * `fullScreenBreakpoint`.
 */
export interface Presentation {
  mode?: 'inline' | 'fullScreen' | 'auto';
  /** Viewport width in px below which `auto` promotes to full screen. Default 640. */
  fullScreenBreakpoint?: number;
}

/** Options accepted by {@link loadDoola}. */
export interface DoolaOptions {
  /**
   * The partner's publishable key (`pk_test_…` or `pk_live_…`).
   * Public by design: it identifies the partner and selects branding,
   * nothing else. The key prefix also selects the API environment —
   * test keys talk to the test stack, live keys to production.
   */
  publishableKey: string;

  fetchAccessToken: FetchAccessToken;

  /** MUST be handled — see {@link DoolaAuthError} for each case and the expected response. */
  onAuthError: (error: DoolaAuthError) => void;

  appearance?: Appearance;
  presentation?: Presentation;

  /** BCP 47 tag. v1 supports `en` only; the option exists so adding locales is not a breaking change. */
  locale?: string;
}

/** Components available in v1. The formation component includes the post-purchase mini-dashboard. */
export type DoolaComponentType = 'formation';

/** Lifecycle callbacks shared by every component type. */
export interface ComponentOptions {
  /** Fired the first time any UI (including a loading state) is visible. */
  onLoaderStart?: (event: { componentType: DoolaComponentType }) => void;

  /** Fired when the component fails to load. May fire more than once; handlers must be idempotent. */
  onLoadError?: (error: DoolaLoadError) => void;
}

/** Options for `create('formation')`. */
export interface FormationOptions extends ComponentOptions {
  /**
   * The payment handoff. Fires when the customer completes the wizard
   * and the draft formation is submitted; the company is parked at
   * Awaiting Payment until the partner's server confirms payment.
   *
   * Carries ONLY the company id. Deliberately no amount, state, or
   * add-on selection: anything delivered into the partner page's
   * JavaScript can be edited in DevTools before checkout reads it. The
   * partner's server derives what is owed from
   * GET /v1/partner/companies/{companyId}.
   */
  onFormed: (event: { companyId: string }) => void;
}

/**
 * The mounted-component handle. The returned element is a standard
 * custom element: append it to the DOM to mount, remove it to unmount.
 * It behaves as a block element — 100% of the parent's width, height
 * driven by content via the loader's resize negotiation.
 *
 * Deliberately an interface, not a type alias: methods on the handle can
 * be added additively in later minors without renaming the public type.
 */
export interface DoolaComponent extends HTMLElement {}

/** The initialized SDK instance. */
export interface Doola {
  create(type: 'formation', options: FormationOptions): DoolaComponent;

  /** Runtime updates. Only `appearance` and `locale` can change after init. */
  update(options: Pick<DoolaOptions, 'appearance' | 'locale'>): void;

  /**
   * Tears down every component and the session. Call on the partner
   * app's logout, never on ordinary unmount or navigation.
   */
  destroy(): void;
}

/**
 * Injects the loader script from js.doola.com/v1/doola.js (if not
 * already present) and initializes it. Resolves once the loader is
 * ready to create components. Call once per page; reuse the instance.
 */
export declare function loadDoola(options: DoolaOptions): Promise<Doola>;
