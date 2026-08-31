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
import { SessionManager } from './session';

/** `auto` promotes to full screen below this width. Loader policy — see `Presentation` in the contract. */
const FULLSCREEN_BREAKPOINT_PX = 640;

/**
 * The live instance, or null. One live instance per page (the
 * contract's loadDoola doc): liveness is identity, so "this handle was
 * destroyed" and "this handle is not the live one" are the same check.
 */
let live: Doola | null = null;

function init(options: DoolaOptions): Doola {
  const { publishableKey, fetchAccessToken, onAuthError, onFormed } = options;

  if (live) throw new Error('doola: an instance is already live. Call destroy() on it first.');
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

  const state: InstanceState = { appearance: options.appearance, locale: options.locale };
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

  const sessions = new SessionManager(fetchAccessToken, onAuthError, (session) => {
    for (const frame of mounted) frame.post({ type: 'token', payload: { session } });
  });

  defineElementOnce();

  const isLive = (): boolean => live === instance;
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

      // Merge semantics: types.d.ts (update) and docs/protocol.md (update
      // message). A call naming no keys merges nothing, so there is nothing
      // to post; when a key is present the resolved state always goes out —
      // the app replaces wholesale, so a same-value post is harmless.
      if (!('appearance' in next) && !('locale' in next)) return;

      if ('appearance' in next) state.appearance = next.appearance;
      if ('locale' in next) state.locale = next.locale;

      for (const frame of mounted) {
        frame.post({
          type: 'update',
          payload: { appearance: state.appearance, locale: state.locale },
        });
      }
    },

    destroy() {
      if (!isLive()) return;
      live = null;

      sessions.stop();
      // dispose() empties `mounted` itself via each onDisconnect.
      for (const frame of [...mounted]) frame.dispose();
    },
  };

  live = instance;

  return instance;
}

// First evaluation wins: a second copy of this script (a partner tag plus
// the shim's, say) must not swap in a fresh module with its own live-latch.
window.Doola ??= { init };
