import type { Doola, DoolaComponent, DoolaOptions } from '@doola/js';

import {
  defineElementOnce,
  DoolaElement,
  ELEMENT_TAG,
  FrameController,
  type InstanceState,
} from './component';
import { envFromPublishableKey } from './env';
import { SessionManager } from './session';

const DEFAULT_FULLSCREEN_BREAKPOINT = 640;

/**
 * One live instance per page (the contract's loadDoola doc). destroy()
 * releases the latch; a second init() while one is live is a partner
 * bug we surface loudly rather than letting two sessions race.
 */
let liveInstance = false;

function init(options: DoolaOptions): Doola {
  const { publishableKey, fetchAccessToken, onAuthError, onFormed } = options;

  if (liveInstance)
    throw new Error('doola: an instance is already live. Call destroy() on it first.');
  if (!publishableKey) throw new Error('doola: publishableKey is required.');
  if (typeof fetchAccessToken !== 'function')
    throw new Error('doola: fetchAccessToken must be a function.');
  if (typeof onAuthError !== 'function') {
    throw new Error(
      'doola: onAuthError is required. When your own user session expires, only your page can send the user back to your login.',
    );
  }
  if (typeof onFormed !== 'function') throw new Error('doola: onFormed is required.');

  // The key always resolves the environment; a CNAME partner's `origin`
  // overrides only where the app is served from (see the contract).
  const env = envFromPublishableKey(publishableKey);
  const sdkOrigin = options.origin ?? env.sdkOrigin;

  const state: InstanceState = { appearance: options.appearance, locale: options.locale };
  const mounted = new Set<FrameController>();
  let destroyed = false;

  const sessions = new SessionManager(fetchAccessToken, onAuthError, (session) => {
    for (const frame of mounted) frame.post({ type: 'token', payload: { session } });
  });

  // Warm start: begin the mint now so the iframe's `ready` handshake finds
  // it in flight. Renewal then only runs while frames are mounted.
  void sessions.current().catch(() => {});

  defineElementOnce();
  liveInstance = true;

  const assertLive = (method: string): void => {
    if (destroyed)
      throw new Error(`doola: ${method}() called on a destroyed instance. Call loadDoola() again.`);
  };

  return {
    create(): DoolaComponent {
      assertLive('create');

      const element = document.createElement(ELEMENT_TAG) as DoolaElement;
      element.controller = new FrameController(element, {
        sdkOrigin,
        publishableKey,
        sessions,
        state,
        presentationMode: options.presentation?.mode ?? 'auto',
        fullScreenBreakpoint:
          options.presentation?.fullScreenBreakpoint ?? DEFAULT_FULLSCREEN_BREAKPOINT,
        onAuthError,
        onFormed,
        onLoaderStart: options.onLoaderStart,
        onLoadError: options.onLoadError,
        onConnect: (controller) => {
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

      // Merge per key (the contract's update() doc): an absent key keeps
      // the current value, a key present as `undefined` clears it. The
      // resolved state goes over the bus; the app never merges.
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
      if (destroyed) return;
      destroyed = true;

      sessions.stop();
      for (const frame of [...mounted]) frame.disconnect();
      mounted.clear();

      liveInstance = false;
    },
  };
}

window.Doola = { init };
