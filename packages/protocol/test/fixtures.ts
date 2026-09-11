import type { AppMessage, LoaderMessage } from '../src/messages';

export const session = { accessToken: 'cs_test_abc', expiresIn: 600 };

/**
 * One accepted example of every message, both directions. Typed as the unions
 * so a new message type is a compile error here: coverage cannot silently fall
 * behind the protocol.
 */
export const APP_MESSAGES: { [K in AppMessage['type']]: Extract<AppMessage, { type: K }> } = {
  ready: { type: 'ready', payload: { protocolMax: 1 } },
  resize: { type: 'resize', payload: { height: 640 } },
  'scroll-request': { type: 'scroll-request', payload: { top: -20 } },
  'token-request': { type: 'token-request', payload: {} },
  formed: { type: 'formed', payload: { companyId: 'c_1' } },
  'auth-error': { type: 'auth-error', payload: { type: 'mint_failed', message: 'x' } },
  'load-error': { type: 'load-error', payload: { type: 'api_error', message: 'x' } },
  'loader-start': { type: 'loader-start', payload: {} },
};

export const LOADER_MESSAGES: {
  [K in LoaderMessage['type']]: Extract<LoaderMessage, { type: K }>;
} = {
  init: { type: 'init', payload: { session, protocol: 1, locale: 'en' } },
  token: { type: 'token', payload: { session } },
  update: { type: 'update', payload: { locale: 'es', appearance: { brand: '#F9C800' } } },
  'token-error': {
    type: 'token-error',
    payload: { reason: 'renewal_failed', message: 'x', retryable: true },
  },
  presentation: { type: 'presentation', payload: { mode: 'fullScreen' } },
};
