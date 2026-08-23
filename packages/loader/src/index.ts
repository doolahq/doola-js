import type { Doola, DoolaComponent, DoolaOptions, FormationOptions } from '@doola/js';

import {
  defineElementsOnce,
  DoolaElement,
  ELEMENT_TAGS,
  FrameController,
  type InstanceState,
} from './component';
import { envFromPublishableKey } from './env';
import type { AppMessage } from './protocol';
import { SessionManager } from './session';

const DEFAULT_FULLSCREEN_BREAKPOINT = 640;

/**
 * Per-component-type behavior. Everything else in the loader is
 * component-generic, so adding a component type is one entry here
 * (plus its tag in ELEMENT_TAGS) and nothing else.
 */
const COMPONENTS = {
  formation: {
    validate(options: FormationOptions): void {
      if (typeof options?.onFormed !== 'function') throw new Error('doola: onFormed is required.');
    },
    bindMessages(options: FormationOptions): (message: AppMessage) => void {
      return (message) => {
        if (message.type === 'formed') options.onFormed({ companyId: message.payload.companyId });
      };
    },
  },
} as const;

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
  const state: InstanceState = { appearance: options.appearance, locale: options.locale };
  const mounted = new Set<FrameController>();

  const sessions = new SessionManager(fetchAccessToken, onAuthError, (session) => {
    for (const frame of mounted) frame.post({ type: 'token', payload: { session } });
  });

  // Warm start: begin the mint now so the iframe's `ready` handshake finds
  // it in flight. Renewal then only runs while frames are mounted.
  void sessions.current().catch(() => {});

  defineElementsOnce();

  return {
    create(type: 'formation', componentOptions: FormationOptions): DoolaComponent {
      const descriptor = COMPONENTS[type];
      if (!descriptor) throw new Error(`doola: unknown component type "${String(type)}".`);
      descriptor.validate(componentOptions);

      const element = document.createElement(ELEMENT_TAGS[type]) as DoolaElement;
      element.controller = new FrameController(
        element,
        {
          env,
          publishableKey,
          componentType: type,
          sessions,
          state,
          presentationMode: options.presentation?.mode ?? 'auto',
          fullScreenBreakpoint:
            options.presentation?.fullScreenBreakpoint ?? DEFAULT_FULLSCREEN_BREAKPOINT,
          onAuthError,
          onComponentMessage: descriptor.bindMessages(componentOptions),
          onConnect: (controller) => {
            if (mounted.size === 0) sessions.resume();
            mounted.add(controller);
          },
          onDisconnect: (controller) => {
            mounted.delete(controller);
            if (mounted.size === 0) sessions.pause();
          },
        },
        componentOptions,
      );

      return element;
    },

    update(next) {
      state.appearance = next.appearance ?? state.appearance;
      state.locale = next.locale ?? state.locale;

      for (const frame of mounted) {
        frame.post({
          type: 'update',
          payload: { appearance: state.appearance, locale: state.locale },
        });
      }
    },

    destroy() {
      sessions.stop();

      for (const frame of [...mounted]) frame.disconnect();
      mounted.clear();
    },
  };
}

window.Doola = { init };
