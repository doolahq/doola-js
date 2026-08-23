import type {
  Appearance,
  CustomerSession,
  DoolaAuthError,
  DoolaComponentType,
  DoolaLoadError,
} from '@doola/js';

/**
 * The loader <-> iframe protocol. Spec: docs/protocol.md. The two sides
 * deploy independently, so every message carries `v` and both sides
 * support N-1. Unknown message types are ignored, never an error.
 */
export const PROTOCOL_VERSION = 1;

export type AppMessage =
  | { type: 'ready'; payload: { protocolMax: number } }
  | { type: 'resize'; payload: { height: number } }
  | { type: 'scroll-request'; payload: { top: number } }
  | { type: 'token-request'; payload: Record<string, never> }
  | { type: 'formed'; payload: { companyId: string } }
  | { type: 'auth-error'; payload: DoolaAuthError }
  | { type: 'load-error'; payload: DoolaLoadError }
  | { type: 'loader-start'; payload: { componentType: DoolaComponentType } };

export type LoaderMessage =
  | {
      type: 'init';
      payload: {
        session: CustomerSession;
        appearance?: Appearance | undefined;
        locale?: string | undefined;
        protocol: number;
      };
    }
  | { type: 'token'; payload: { session: CustomerSession } }
  | {
      type: 'update';
      payload: { appearance?: Appearance | undefined; locale?: string | undefined };
    }
  | { type: 'presentation'; payload: { mode: 'inline' | 'fullScreen' } };

export type Envelope = LoaderMessage & { v: number };

/** Parse an inbound message; null for anything malformed or from a future protocol. */
export function parseAppMessage(data: unknown): AppMessage | null {
  if (typeof data !== 'object' || data === null) return null;

  const { v, type, payload } = data as { v?: unknown; type?: unknown; payload?: unknown };
  if (typeof v !== 'number' || v > PROTOCOL_VERSION) return null;
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) return null;

  return data as AppMessage;
}

export function envelope(message: LoaderMessage): Envelope {
  return { v: PROTOCOL_VERSION, ...message };
}
