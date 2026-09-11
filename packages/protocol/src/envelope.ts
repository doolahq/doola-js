import { type AppMessage, type Envelope, type LoaderMessage } from './messages';
import { APP_SPEC, LOADER_SPEC, type Field, type Payload } from './spec';

/**
 * Copies out exactly the fields the spec names, and nothing else.
 *
 * TypeScript does not excess-property-check a value that is not a fresh object
 * literal, so a wider object assigned to a narrower type compiles and then
 * crosses the origin boundary intact. `formed` is why this matters: the
 * contract says it carries the company id alone, and projecting is the only
 * way to make that true of the bytes rather than only of the types.
 *
 * An absent optional field is left out rather than sent as `undefined` — the
 * structured clone behind `postMessage` preserves the key either way, and a
 * documented wire format should not carry keys that mean nothing.
 */
function project(payload: unknown, fields: Record<string, Field>): Payload {
  const values = payload as Payload;
  const projected: Payload = {};

  for (const name of Object.keys(fields)) {
    const value = values[name];
    if (value === undefined) continue;

    const nested = fields[name]?.fields;
    projected[name] = nested ? project(value, nested) : value;
  }

  return projected;
}

/**
 * Stamp and project a message from the app.
 *
 * `version` is required on purpose. It is a property of the connection, agreed
 * once in the `ready`/`init` handshake, and a default would make "claim the
 * newest version to an old peer" the thing you get by forgetting — the exact
 * failure the handshake exists to prevent.
 *
 * The two directions are separate functions rather than one factory so a
 * bundler can drop whichever side a consumer does not use. A `const` assigned
 * from a call is not something it can prove safe to remove, and the loader
 * ships to partners' pages under a 6 KB budget.
 */
export function appEnvelope(message: AppMessage, version: number): Envelope<AppMessage> {
  return {
    v: version,
    type: message.type,
    payload: project(message.payload, APP_SPEC[message.type] ?? {}),
  };
}

/** Stamp and project a message from the mounting peer. */
export function loaderEnvelope(message: LoaderMessage, version: number): Envelope<LoaderMessage> {
  return {
    v: version,
    type: message.type,
    payload: project(message.payload, LOADER_SPEC[message.type] ?? {}),
  };
}
