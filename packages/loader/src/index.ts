import type { Doola, DoolaComponent, DoolaOptions } from '@doola/js';

import {
  defineElementOnce,
  DoolaElement,
  ELEMENT_TAG,
  FrameController,
  type InstanceHandlers,
  type InstanceState,
} from './component';
import { envFromPublishableKey } from './env';
import { tokenError, type LoaderMessage } from './protocol';
import { SessionManager } from './session';

/** `auto` promotes to full screen below this width. Loader policy — see `Presentation` in the contract. */
const FULLSCREEN_BREAKPOINT_PX = 640;

/**
 * The live instance, or null. One live instance per page (the
 * contract's loadDoola doc): liveness is identity, so "this handle was
 * destroyed" and "this handle is not the live one" are the same check.
 * The key rides along because the contract makes a same-key repeat
 * init() return the instance rather than fail.
 */
let live: { instance: Doola; publishableKey: string } | null = null;

function init(options: DoolaOptions): Doola {
  const { publishableKey, fetchAccessToken, onAuthError, onFormed } = options;

  if (live && live.publishableKey !== publishableKey) {
    throw new Error(
      'doola: an instance with a different publishableKey is already live. Call destroy() on it first.',
    );
  }
  // Repeat init with the same key: the live instance, its options
  // untouched (contract, loadDoola).
  if (live) return live.instance;
  if (!publishableKey) throw new Error('doola: publishableKey is required.');
  if (typeof fetchAccessToken !== 'function')
    throw new Error('doola: fetchAccessToken must be a function.');
  if (typeof onAuthError !== 'function') {
    throw new Error(
      'doola: onAuthError is required. When your own user session expires, only your page can send the user back to your login.',
    );
  }
  if (typeof onFormed !== 'function') throw new Error('doola: onFormed is required.');

  // The key always resolves the environment — even for CNAME partners,
  // whose `origin` overrides only where the app is served from — so the
  // env lookup must run (and validate the key) before the override.
  const env = envFromPublishableKey(publishableKey);
  const sdkOrigin = options.origin ?? env.sdkOrigin;

  const state: InstanceState = { locale: options.locale };
  // Snapshot: the contract fixes options at init, so later mutation of the
  // partner's object must not change what mounted frames observe.
  const handlers: InstanceHandlers = {
    onAuthError,
    onFormed,
    onLoaderStart: options.onLoaderStart,
    onLoadError: options.onLoadError,
  };
  const presentationMode = options.presentation?.mode ?? 'auto';
  const fullScreenQuery =
    presentationMode === 'auto'
      ? window.matchMedia(`(max-width: ${FULLSCREEN_BREAKPOINT_PX}px)`)
      : null;
  const mounted = new Set<FrameController>();
  const broadcast = (message: LoaderMessage): void => {
    for (const frame of mounted) frame.post(message);
  };

  // A failed fetch is answered on both sides: the frame gets token-error so
  // it never hangs on an unanswered token-request, the partner gets onAuthError.
  const sessions = new SessionManager(
    fetchAccessToken,
    (error) => {
      broadcast(tokenError(error));
      onAuthError(error);
    },
    (session) => broadcast({ type: 'token', payload: { session } }),
  );

  defineElementOnce();

  const isLive = (): boolean => live?.instance === instance;
  const assertLive = (method: string): void => {
    if (!isLive())
      throw new Error(`doola: ${method}() called on a destroyed instance. Call loadDoola() again.`);
  };

  const instance: Doola = {
    create(): DoolaComponent {
      assertLive('create');

      const element = document.createElement(ELEMENT_TAG) as DoolaElement;
      element.controller = new FrameController(element, {
        isDestroyed: () => !isLive(),
        sdkOrigin,
        publishableKey,
        sessions,
        state,
        handlers,
        fullScreenQuery,
        onConnect: (controller) => {
          // First mount resumes the manager, which also starts the first
          // mint — in parallel with the iframe load it just triggered.
          if (mounted.size === 0) sessions.resume();
          mounted.add(controller);
        },
        onDisconnect: (controller) => {
          mounted.delete(controller);
          if (mounted.size === 0) sessions.pause();
        },
      });

      return element;
    },

    update(next) {
      assertLive('update');

      // Absent key keeps, present-as-undefined clears — types.d.ts (update).
      if (!('locale' in next)) return;

      state.locale = next.locale;
      broadcast({ type: 'update', payload: { locale: state.locale } });
    },

    destroy() {
      if (!isLive()) return;
      live = null;

      sessions.stop();
      // dispose() empties `mounted` itself via each onDisconnect.
      for (const frame of [...mounted]) frame.dispose();
    },
  };

  live = { instance, publishableKey };

  return instance;
}

// First evaluation wins: a second copy of this script (a partner tag plus
// the shim's, say) must not swap in a fresh module with its own live-latch.
window.Doola ??= { init };
