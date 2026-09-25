# @doola/sdk-protocol

> **Internal to doola. Partners do not use this package.** To embed doola, install
> [`@doola/js`](https://www.npmjs.com/package/@doola/js). This package carries no
> compatibility promise for anyone outside doola's own loader and app.

The wire format doola's SDK loader and embedded app speak to each other, and
the validators both sides run against it.

It exists because the two ends of the bus live in different repositories (the
loader in `doolahq/doola-js`, the app in `doolahq/doola-sdk-app`), and a wire
format maintained twice is a wire format that drifts. It is published only so
the app can adopt it.

The specification is
[`docs/protocol.md`](https://github.com/doolahq/doola-js/blob/main/docs/protocol.md),
and it is authoritative: this package is one implementation of it.
`test/spec-matches-docs.test.ts` fails if the two stop describing the same
messages or the same version.

## What it gives you

```ts
import {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  negotiate,
  parseAppMessage,
  parseLoaderMessage,
  appEnvelope,
  loaderEnvelope,
} from '@doola/sdk-protocol';
```

- `parseAppMessage` / `parseLoaderMessage` — validate an inbound message and
  return it typed, or `null`. Unknown types, malformed payloads and versions
  outside the supported window all return `null`: both sides drop what they
  cannot make sense of rather than throwing, because a stray `postMessage` from
  any script on the page must not be able to crash a frame.
- `appEnvelope` / `loaderEnvelope` — stamp an outbound message and **project
  its payload field by field**. Not ceremony: TypeScript does not
  excess-property-check a value that is not a fresh object literal, so a wider
  object assigned to a narrower type crosses the origin boundary intact unless
  something copies out the declared fields. `formed` carries a company id and
  nothing else because of this.
- `negotiate` — `min(mine, theirs)`, the handshake's only downgrade mechanism.

The version argument on both envelope functions is required. It is a property
of the connection, agreed once in the `ready`/`init` handshake, and defaulting
it would make "claim the newest version to an old peer" the thing you get by
forgetting.

## One table per message

`src/spec.ts` describes each message's fields once, and both the validator and
the projection are derived from that description. Keeping them apart is how a
wire format rots: a field added to a validator but not a projection is silently
dropped on send, and neither mistake is visible in review. The spec type
requires an entry for every key of every payload, so adding a field without
describing it does not compile.

## Versioning

The two sides deploy independently, so for a few minutes on every deploy a new
app talks to an old loader and vice versa. `MIN_SUPPORTED_VERSION` is the floor,
and retiring a version is a one-line change to it — reviewable, rather than
folklore. Adding an optional field or a new message type needs no bump, because
unknown types and unexpected keys are already ignored; changing or removing the
meaning of an existing field does.

## Size

The loader is fetched on every page load of every partner site and its CI holds
it to 6 KB gzip. `test/loader-footprint.test.ts` measures what this package
costs that budget — ~0.9 KB today, minified the way the loader ships — and
asserts the app-side half tree-shakes away. Keep `sideEffects: false` and keep the exports named.
