import type { Presentation } from '@doola/js';

/**
 * Init-time validation of the two options that previously failed silently.
 * Everything here throws, matching `publishableKey`, `fetchAccessToken`,
 * `onAuthError` and `onFormed`: a mistake in the partner's call should be a
 * sentence in their console, not a frame that quietly does nothing.
 */

/**
 * The serialized origin of `origin`, which is the only form the inbound check
 * can compare against: `event.origin` never carries a path or a trailing
 * slash, so `https://partner.test/` would fail every inbound comparison while
 * outbound still worked — `postMessage` parses targetOrigin as a URL. The
 * frame would load, the app would send `ready`, and the loader would ignore
 * it: no init, no session, no error anywhere.
 */
export function serializedOrigin(origin: string): string {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`doola: origin must be an absolute URL, received ${JSON.stringify(origin)}.`);
  }

  // Opaque origins (file:, data:, and anything else without a host) serialize
  // to the string "null", which would match nothing and fail the same way.
  if (parsed.origin === 'null')
    throw new Error(`doola: origin must be an http(s) origin, received ${JSON.stringify(origin)}.`);

  return parsed.origin;
}

/**
 * The presentation mode, defaulting to `auto`. Validated because an unknown
 * value fails towards the most disruptive state: only the exact string `auto`
 * builds a media query, and without one the frame reads "full screen" on every
 * viewport — so a typo like `fullscreen` pins a permanent overlay, the
 * opposite of what it was reaching for.
 */
export function presentationModeFrom(
  presentation: Presentation | undefined,
): 'auto' | 'fullScreen' {
  const mode = presentation?.mode ?? 'auto';

  if (mode !== 'auto' && mode !== 'fullScreen')
    throw new Error(
      `doola: presentation.mode must be 'auto' or 'fullScreen', received ${JSON.stringify(mode)}.`,
    );

  return mode;
}
