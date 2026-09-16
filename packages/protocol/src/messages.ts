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
 * The oldest version still accepted. The two sides deploy independently, so a
 * new build always meets an old peer for a few minutes; N−1 is the window that
 * covers. Retiring a version is a one-line change to this constant, which is
 * what makes it reviewable rather than folklore.
 */
export const MIN_SUPPORTED_VERSION = Math.max(1, PROTOCOL_VERSION - 1);

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
 * every unsaved draft. The wire format is a flat string map; which keys mean
 * anything is owned by the branding backend, and the app applies only the ones
 * it knows.
 */
export type Appearance = Record<string, string>;

/** App -> mounting peer (the loader, or the portal's preview). */
export type AppMessage =
  | { type: 'ready'; payload: { protocolMax: number } }
  | { type: 'resize'; payload: { height: number } }
  | { type: 'scroll-request'; payload: { top: number } }
  | { type: 'token-request'; payload: Record<string, never> }
  | { type: 'formed'; payload: { companyId: string } }
  | { type: 'auth-error'; payload: { type: AuthErrorType; message: string } }
  | { type: 'load-error'; payload: { type: LoadErrorType; message: string } }
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
