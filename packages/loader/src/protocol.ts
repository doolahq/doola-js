import type { CustomerSession, DoolaAuthError, DoolaLoadError } from '@doola/js';

/**
 * The loader <-> iframe protocol. Spec: docs/protocol.md. The two sides
 * deploy independently, so every message carries `v` and both sides
 * support N-1. Unknown message types are ignored, never an error.
 */
export const PROTOCOL_VERSION = 1;

/** The version both sides speak: min(loaderMax, appMax) — docs/protocol.md, Envelope. */
export function negotiate(protocolMax: number): number {
  return Math.min(PROTOCOL_VERSION, protocolMax);
}

export type AppMessage =
  | { type: 'ready'; payload: { protocolMax: number } }
  | { type: 'resize'; payload: { height: number } }
  | { type: 'scroll-request'; payload: { top: number } }
  | { type: 'token-request'; payload: Record<string, never> }
  | { type: 'formed'; payload: { companyId: string } }
  | { type: 'auth-error'; payload: DoolaAuthError }
  | { type: 'load-error'; payload: DoolaLoadError }
  | { type: 'loader-start'; payload: Record<string, never> };

export type LoaderMessage =
  | {
      type: 'init';
      payload: { session: CustomerSession; locale?: string | undefined; protocol: number };
    }
  | { type: 'token'; payload: { session: CustomerSession } }
  | { type: 'update'; payload: { locale?: string | undefined } }
  | {
      type: 'token-error';
      payload: { reason: DoolaAuthError['type']; message: string; retryable: boolean };
    }
  | { type: 'presentation'; payload: { mode: 'inline' | 'fullScreen' } };

export type Envelope = LoaderMessage & { v: number };

/**
 * Whether the loader will keep renewing on its own after this failure.
 * Exhaustive over the contract's union so a new case is a compile error
 * here rather than a silent "retryable".
 */
const RETRYABLE: Record<DoolaAuthError['type'], boolean> = {
  partner_session_expired: false,
  email_in_use: false,
  mint_failed: true,
  renewal_failed: true,
};

/** Exhaustive over the contract's union for the same reason as RETRYABLE. */
const LOAD_ERROR: Record<DoolaLoadError['type'], true> = {
  api_connection_error: true,
  authentication_error: true,
  invalid_request_error: true,
  render_error: true,
  api_error: true,
};

const AUTH_ERROR_TYPES: ReadonlySet<string> = new Set(Object.keys(RETRYABLE));
const LOAD_ERROR_TYPES: ReadonlySet<string> = new Set(Object.keys(LOAD_ERROR));

type Payload = Record<string, unknown>;
type ShapeCheck = (payload: Payload) => boolean;

const isFiniteNumber = (x: unknown): x is number => Number.isFinite(x);
const isPositiveInt = (x: unknown): x is number =>
  isFiniteNumber(x) && Number.isInteger(x) && x > 0;
const isNonEmptyString = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isTaggedError =
  (types: ReadonlySet<string>): ShapeCheck =>
  (p) =>
    typeof p.type === 'string' && types.has(p.type) && typeof p.message === 'string';

/**
 * A required-key check, not a projection: it bounds what the loader acts
 * on, not what escapes — field-level narrowing for partner-facing payloads
 * (`formed`) lives at the handler. Exhaustive over AppMessage so a new
 * message must declare its shape; a payload that fails is dropped like an
 * unknown type.
 */
const PAYLOAD_SHAPE: Record<AppMessage['type'], ShapeCheck> = {
  ready: (p) => isPositiveInt(p.protocolMax),
  resize: (p) => isFiniteNumber(p.height) && p.height >= 0,
  'scroll-request': (p) => isFiniteNumber(p.top),
  'token-request': () => true,
  formed: (p) => isNonEmptyString(p.companyId),
  'auth-error': isTaggedError(AUTH_ERROR_TYPES),
  'load-error': isTaggedError(LOAD_ERROR_TYPES),
  'loader-start': () => true,
};

/** Parse an inbound message; null for anything malformed, unknown, or from a future protocol. */
export function parseAppMessage(data: unknown): AppMessage | null {
  if (typeof data !== 'object' || data === null) return null;

  const { v, type, payload } = data as { v?: unknown; type?: unknown; payload?: unknown };
  if (typeof v !== 'number' || v > PROTOCOL_VERSION) return null;
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) return null;

  const hasShape = (PAYLOAD_SHAPE as Record<string, ShapeCheck>)[type];
  if (!hasShape?.(payload as Payload)) return null;

  return data as AppMessage;
}

export function tokenError(error: DoolaAuthError): Extract<LoaderMessage, { type: 'token-error' }> {
  return {
    type: 'token-error',
    payload: { reason: error.type, message: error.message, retryable: RETRYABLE[error.type] },
  };
}

export function envelope(message: LoaderMessage): Envelope {
  return { v: PROTOCOL_VERSION, ...message };
}
