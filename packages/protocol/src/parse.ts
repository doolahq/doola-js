import { MIN_SUPPORTED_VERSION, PROTOCOL_VERSION } from './messages';
import type { AppMessage, LoaderMessage } from './messages';
import { APP_SPEC, LOADER_SPEC, acceptsAll, type Spec } from './spec';

function parse<T>(data: unknown, spec: Spec): T | null {
  if (typeof data !== 'object' || data === null) return null;

  const { v, type, payload } = data as { v?: unknown; type?: unknown; payload?: unknown };
  // Integer, not just number: NaN is a number and every comparison with it is
  // false, so a bare range check lets `v: NaN` through both bounds. This also
  // rejects infinities and fractional versions, none of which name a version.
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (v > PROTOCOL_VERSION || v < MIN_SUPPORTED_VERSION) return null;
  if (typeof type !== 'string') return null;
  if (typeof payload !== 'object' || payload === null) return null;

  // Own property, not a bare index: `spec['toString']` is a truthy
  // Object.prototype member and `acceptsAll` over no fields passes vacuously.
  // `hasOwnProperty.call`, not `Object.hasOwn`: tsc's lib for target ES2020
  // does not declare it, and esbuild would emit the call through untouched.
  const fields = Object.prototype.hasOwnProperty.call(spec, type) ? spec[type] : undefined;
  if (!fields || !acceptsAll(fields)(payload)) return null;

  return data as T;
}

/**
 * For the mounting peer: a message the app sent, or `null`.
 *
 * Null covers every way a message can be unusable — unknown type, malformed
 * payload, a version outside the supported window — because there is nothing
 * useful either side can do differently between those cases, and throwing
 * would turn a stray `postMessage` from any script on the page into a crash.
 */
export function parseAppMessage(data: unknown): AppMessage | null {
  return parse<AppMessage>(data, APP_SPEC);
}

/** For the app: a message the mounting peer sent, or `null`. */
export function parseLoaderMessage(data: unknown): LoaderMessage | null {
  return parse<LoaderMessage>(data, LOADER_SPEC);
}
