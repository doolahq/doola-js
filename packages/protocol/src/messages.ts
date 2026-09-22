/**
 * The wire vocabulary: what a message may say, independent of who is speaking.
 *
 * These types are declared here rather than imported from `@doola/js` so the
 * package has no runtime dependency and can be published on its own. They are
 * not a second opinion: `test/conformance.test.ts` asserts at compile time that
 * each one is mutually assignable with its counterpart in the public contract,
 * so a change there that this package has not followed fails the build.
 */

/**
 * Bump only for a change the other side cannot ignore. Adding an optional field
 * or a new message type is not one: unknown types and unexpected keys are
 * already dropped by both sides.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The oldest version still accepted, making the supported window the closed
 * range `[MIN_SUPPORTED_VERSION, PROTOCOL_VERSION]` — the two sides deploy
 * independently, so a new build always meets an old peer for a few minutes.
 * Retiring a version is a one-line change to this constant, which is what
 * makes it reviewable rather than folklore.
 *
 * A literal for that reason. Deriving it from PROTOCOL_VERSION would retire the
 * oldest version as a side effect of bumping the newest — dropping peers still
 * in the wild with nothing in the diff to review.
 */
export const MIN_SUPPORTED_VERSION = 1;

/**
 * The version both sides speak: `min(mine, theirs)`. A peer older than
 * `MIN_SUPPORTED_VERSION` never reaches this — its messages are refused at the
 * parse boundary.
 */
export function negotiate(theirMax: number): number {
  return Math.min(PROTOCOL_VERSION, theirMax);
}

/** Minted by the partner's server, carried in memory, never stored. */
export interface CustomerSession {
  accessToken: string;
  /**
   * Seconds. The only expiry input either side may act on — deriving remaining
   * life from `expiresAt` would mix the server's clock into the end user's.
   */
  expiresIn: number;
  /** RFC 3339 with a UTC offset or `Z`. Present for humans reading logs. */
  expiresAt?: string | undefined;
}

export type AuthErrorType =
  'partner_session_expired' | 'email_in_use' | 'mint_failed' | 'renewal_failed';

export type LoadErrorType =
  | 'api_connection_error'
  | 'authentication_error'
  | 'invalid_request_error'
  | 'render_error'
  | 'api_error';

export type PresentationMode = 'inline' | 'fullScreen';

/**
 * Branding pushed by an internal mounting peer — the partner portal's preview,
 * which mounts the app the way the loader does and sends a fresh `update` for
 * every unsaved draft. The wire format is a flat map; which keys mean anything
 * is owned by the branding backend (docs/protocol.md), and the app applies only
 * the ones it knows.
 *
 * Values are `unknown` on purpose. `acceptsAll` fails the whole payload when
 * one field fails, so any value type the wire failed to anticipate costs a
 * partner the entire `init` or `update` — not the one key — and the frame keeps
 * whatever it had, or never starts. The table already carries three shapes that
 * would each have to be guessed: strings, an explicit `null` for a partner who
 * never opened the portal, and `attribution`, which is a boolean.
 *
 * So the wire checks that this is a map and stops. The app is what knows the
 * keys: `setBranding` walks its own table and applies the ones it recognises,
 * which makes an unrecognised value inert rather than fatal.
 */
export type Appearance = Record<string, unknown>;

/**
 * Forwarded verbatim to the partner's `onAuthError` / `onLoadError`, so these
 * are the contract's own error objects and conformance.test.ts asserts the
 * whole shape rather than the tag alone.
 */
export type AuthErrorPayload = { type: AuthErrorType; message: string };
export type LoadErrorPayload = { type: LoadErrorType; message: string };

/** App -> mounting peer (the loader, or the portal's preview). */
export type AppMessage =
  | { type: 'ready'; payload: { protocolMax: number } }
  | { type: 'resize'; payload: { height: number } }
  | { type: 'scroll-request'; payload: { top: number } }
  | { type: 'token-request'; payload: Record<string, never> }
  | { type: 'formed'; payload: { companyId: string } }
  /**
   * The founder asking to be handed back to the partner's checkout, from a
   * waiting screen for a company that is still unpaid. Same payload as
   * `formed` and the same destination, because to the partner it is the same
   * request: start checkout for this company.
   */
  | { type: 'checkout-request'; payload: { companyId: string } }
  | { type: 'auth-error'; payload: AuthErrorPayload }
  | { type: 'load-error'; payload: LoadErrorPayload }
  | { type: 'loader-start'; payload: Record<string, never> };

/** Mounting peer -> app. */
export type LoaderMessage =
  | {
      type: 'init';
      payload: {
        session: CustomerSession;
        protocol: number;
        locale?: string | undefined;
        appearance?: Appearance | undefined;
        presentation?: PresentationMode | undefined;
      };
    }
  | { type: 'token'; payload: { session: CustomerSession } }
  | {
      type: 'update';
      payload: { locale?: string | undefined; appearance?: Appearance | undefined };
    }
  | {
      type: 'token-error';
      payload: { reason: AuthErrorType; message: string; retryable: boolean };
    }
  | { type: 'presentation'; payload: { mode: PresentationMode } };

/** A stamped message as it crosses `postMessage`. */
export interface Envelope<M extends { type: string }> {
  v: number;
  type: M['type'];
  payload: Record<string, unknown>;
}
