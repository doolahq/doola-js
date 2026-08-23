import type { Doola, DoolaComponent, DoolaOptions, FormationOptions } from '@doola/js';

import { defineElementOnce, DoolaFormationElement, FrameController } from './component';
import { envFromPublishableKey } from './env';
import { SessionManager } from './session';

function init(options: DoolaOptions): Doola {
  const { publishableKey, fetchAccessToken, onAuthError } = options;

  if (!publishableKey) throw new Error('doola: publishableKey is required.');
  if (typeof fetchAccessToken !== 'function')
    throw new Error('doola: fetchAccessToken must be a function.');
  if (typeof onAuthError !== 'function') {
    throw new Error(
      'doola: onAuthError is required. When your own user session expires, only your page can send the user back to your login.',
    );
  }

  const env = envFromPublishableKey(publishableKey);
  const frames = new Set<FrameController>();
  let appearance = options.appearance;
  let locale = options.locale;

  const sessions = new SessionManager(fetchAccessToken, onAuthError, (session) => {
    for (const frame of frames) frame.post({ type: 'token', payload: { session } });
  });

  // Start the mint now rather than on first mount: the iframe's `ready`
  // handshake then finds the session already in flight or resolved.
  void sessions.current().catch(() => {});

  defineElementOnce();

  return {
    create(type: 'formation', componentOptions: FormationOptions): DoolaComponent {
      if (type !== 'formation') throw new Error(`doola: unknown component type "${String(type)}".`);
      if (typeof componentOptions?.onFormed !== 'function')
        throw new Error('doola: onFormed is required.');

      const element = document.createElement('doola-formation') as DoolaFormationElement;
      const controller = new FrameController(
        element,
        {
          env,
          publishableKey,
          sessions,
          appearance: () => appearance,
          locale: () => locale,
          presentationMode: options.presentation?.mode ?? 'auto',
          fullScreenBreakpoint: options.presentation?.fullScreenBreakpoint,
        },
        componentOptions,
      );

      element.controller = controller;
      frames.add(controller);

      return element;
    },

    update(next) {
      appearance = next.appearance ?? appearance;
      locale = next.locale ?? locale;

      for (const frame of frames) {
        frame.post({ type: 'update', payload: { appearance, locale } });
      }
    },

    destroy() {
      sessions.stop();

      for (const frame of frames) frame.disconnect();
      frames.clear();
    },
  };
}

declare global {
  interface Window {
    Doola?: { init: typeof init };
  }
}

window.Doola = { init };
