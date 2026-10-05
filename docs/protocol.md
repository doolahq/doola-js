# Loader ↔ iframe protocol

**Protocol version: 1.** This document is the version declaration; the `since`
column in the message tables records the version each message was added in.

`@doola/sdk-protocol` (`packages/protocol`) exists so both sides can implement
it from one place — message types, inbound validators, outbound payload
projections. **Neither side imports it yet**: the loader still carries its own
copy in `packages/loader/src/protocol.ts` and the app carries one in
`doolahq/doola-sdk-app`, so until adoption lands, package behaviour is not
loader behaviour and this document is the only thing they have in common. It
remains the specification either way: where an implementation disagrees with
it, the implementation has the bug.

The contract between the loader (partner's page, doola code) and the embedded app
(the SDK origin, inside the iframe). Internal to doola — partners never touch this —
but versioned like a public API because **the two sides deploy independently**:
on every deploy, new-loader-with-old-app and old-loader-with-new-app both exist
in the wild for minutes. Both sides MUST accept the closed window
`[MIN_SUPPORTED_VERSION, PROTOCOL_VERSION]`, which is what "support N−1" means
once there is an N−1 to support — at version 1 the window is `[1, 1]`, because
0 is not a version. A receiver drops anything outside it, at either end.

N−1 covers only this pair, which deploys minutes apart. The shim ↔ loader pair
lives under a much stricter rule — every published shim version, for as long as
it is installed anywhere within a loader URL major — owned by CONTRIBUTING.md.

Everywhere this document says "the SDK origin", it means the value the loader
resolved for this instance — from the publishable key's environment, or from the
`origin` option for CNAME partners (both defined in the contract) — never a
hardcoded host. For the preview peer it is the origin of the `/preview` URL the
portal framed (see "The preview peer").

## Envelope

Every message, both directions:

```json
{ "v": 1, "type": "…", "payload": {} }
```

An unknown `type` is ignored, never an error — and so is a known `type` whose
payload does not match its `payload` column below: each side validates what it
receives before acting on it, and drops what fails exactly like an unknown type.
For `ready` that means a malformed handshake leaves the frame without `init`, which
is deliberate — a peer that cannot form a valid `ready` is not handed a session.
Between the loader and the app, version negotiation happens once,
up front, in the `ready`/`init` handshake: `ready` carries the app's
`protocolMax`, `init` replies with the `protocol` both sides then speak —
`min(loaderMax, appMax)`. There is no other downgrade mechanism between them.

`v` is therefore the version a message is **spoken in**, not the sender's
maximum: once `init` has settled it, every later message from either side
carries the negotiated value. This is what makes the receive rule coherent —
each side drops anything whose `v` is above its own maximum, which would
otherwise reject its peer's traffic immediately after a successful downgrade.
Before `init` only `ready` exists, and it carries the app's maximum because
that is the number being negotiated with. The preview peer has no `init`: there
`update` and `resize` flow without one, the portal picks the version of each
`update`, no higher than the `protocolMax` that `ready` announced, and the
preview answers in the latest one it accepted (see "The preview peer").

A receiver drops a message whose `v` is above its own maximum, and equally one
below the oldest version it still supports. Both ends of that window are part of
the rule: the ceiling stops a peer claiming a version this side cannot read, and
the floor is how a retired version stops being spoken to rather than being
half-understood.

## Origin and source checks — both directions, no exceptions

- The **loader** accepts a message only when both hold:
  - `event.source === iframe.contentWindow` of a frame it mounted. Origin is
    not frame identity: any injected `<iframe>` pointing at the SDK origin
    shares that origin, and with two components mounted, source is also what
    attributes a message to the right frame.
  - `event.origin` equals the SDK origin.
- The **app** accepts messages only from the partner origin `init` arrived from,
  and posts back to exactly that origin. The preview document, which never
  receives `init`, locks onto the origin of its first valid `update` instead
  (see "The preview peer").
- `"*"` as a target origin is forbidden, with one rule-shaped carve-out: a
  message MAY target `"*"` only when it is sent before the peer origin is
  knowable AND carries no session, token, or customer data. `ready` is
  currently the only message that passes that test — it is the app's first
  message, sent before anything has told the app the partner origin
  (cross-origin, it cannot read `parent.location.origin`), and it carries only
  `protocolMax`. The app then locks onto the origin `init` came from. A future
  message wanting `"*"` must pass the same predicate, not argue by analogy to
  `ready`. All of this holds regardless of same-origin API routing: postMessage
  origin checking is a different mechanism from CORS.

## Messages: app → loader

| type               | payload                                             | since | notes                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready`            | `{ protocolMax: int ≥ 1 }`                          | 1     | app booted; the one message allowed targetOrigin `"*"`; loader replies with `init`                                                                                                                                                                                                                                                         |
| `resize`           | `{ height: number ≥ 0 }`                            | 1     | from a ResizeObserver on the app root; coalesced to one post per animation frame, skipped when equal to the last posted height. The loader sizes the inline frame to a placeholder until the first one arrives — the app cannot measure before it is connected, and a frame at 0px shows nothing while it boots, fails to mint, or crashes |
| `scroll-request`   | `{ top: number }`                                   | 1     | app asks the parent page to scroll a point into view                                                                                                                                                                                                                                                                                       |
| `token-request`    | `{}`                                                | 1     | backstop path: app got a 401 mid-session                                                                                                                                                                                                                                                                                                   |
| `formed`           | `{ companyId: non-empty string }`                   | 1     | loader forwards to the partner's `onFormed` — **only the id, nothing else** (see the contract)                                                                                                                                                                                                                                             |
| `checkout-request` | `{ companyId: non-empty string }`                   | 1     | the founder asks to be handed back to the partner's checkout for a company that is still unpaid. Routed to the same `onFormed` as `formed`, with **only the id** — no new partner handler, and no protocol bump: a new message type is something the other side may ignore                                                                 |
| `auth-error`       | `{ type: DoolaAuthError['type'], message: string }` | 1     | loader forwards to `onAuthError`                                                                                                                                                                                                                                                                                                           |
| `load-error`       | `{ type: DoolaLoadError['type'], message: string }` | 1     | loader forwards to `onLoadError`                                                                                                                                                                                                                                                                                                           |
| `loader-start`     | `{}`                                                | 1     | first paint inside the frame                                                                                                                                                                                                                                                                                                               |

## Messages: mounting peer → app

The mounting peer is the loader. The portal's branding preview frames a
different document and speaks a subset of these messages; see "The preview
peer".

| type           | payload                                                      | since | notes                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`         | `{ session, appearance?, locale?, protocol, presentation? }` | 1     | first message after `ready`; `appearance` is sent by internal peers only; `presentation` is the frame's mode at handshake time, absent only from a loader older than the field                                                                                   |
| `token`        | `{ session }`                                                | 1     | renewal result; also the reply to `token-request`                                                                                                                                                                                                                |
| `update`       | `{ appearance?, locale?, preview? }`                         | 1     | runtime `update()` call, see below; `appearance` internal peers only; `preview` the portal preview only, see "The preview peer"                                                                                                                                  |
| `token-error`  | `{ reason, message, retryable }`                             | 1     | a token could not be obtained; `reason` is the `DoolaAuthError` type; `retryable` means the loader will keep renewing on its own — the frame may still send `token-request` in either case, for terminal reasons only after the user has acted outside the frame |
| `presentation` | `{ mode }`                                                   | 1     | inline ↔ fullScreen transitions                                                                                                                                                                                                                                  |

`update` carries the loader's **resolved** state, not the partner's raw call:
the contract's merge semantics (absent key keeps, key present as `undefined`
clears) are applied by the loader against the state it holds, and the app
replaces its values wholesale with what arrives. The app never merges.

**`init` is the complete state snapshot; every other loader→app message is a
delta.** (The preview peer has no `init`, so there every `update` is complete;
see below.) That is the rule, and it is why nothing is lost when the loader posts
before the frame can receive: `init` re-reads the session, the locale and the
presentation mode at handshake time, so a dropped `token` or `presentation` is
superseded rather than missed. Any future loader→app message carrying state
rather than an event must therefore also appear on `init`, or a frame that
mounts after it will never learn that state.

`presentation` on `init` carries the mode the frame is already in, and exists
because the `presentation` message cannot. The loader decides inline vs. full
screen when it mounts the iframe, which is before the frame has navigated off
`about:blank` — a `postMessage` targeted at the SDK origin is dropped by the
browser at that point, silently, by the same rule this document states above.
`init` is built in reply to `ready`, so it is the first moment a message is
guaranteed to arrive. The `presentation` message then covers transitions only.
An app that ignores the field renders inline until the first transition.

`appearance` on `init` and `update` is a doola-internal channel, not a partner
option — branding lives in the partner portal, and the public `update()` carries
only `locale`. Its consumer is the portal's branding preview, which does not
mount the app: it frames the session-less preview document and sends
`update { appearance, preview }` for each unsaved draft (below). The app still
accepts `appearance` on `init` and `update`, ahead of the saved config, but no
peer sends it there today. No message type was added for any of this: the
`branding_preview` message in earlier sketches is `update { appearance }`. The
shape of `appearance` is owned by the branding backend (PENG-6219).

## The preview peer

The partner portal's branding preview (PENG-6500) shows a partner their unsaved
branding on the real screens. It cannot mount the app the way a loader does: the
app waits for `init`, `init` needs a customer session, and minting one takes a
`dk_` key the portal never holds. So the SDK origin serves a second document for
it at `/preview` (doola-sdk-app `preview.html`, PENG-6816), which renders the
formation wizard's own screens on sample data and holds no session at all. It speaks a subset of
this protocol:

- **Preview → portal**: `ready`, exactly as the app sends it (the same inline
  script, the same `"*"` carve-out), then `resize`. Nothing else: no
  `loader-start`, no `formed`, no `token-request`, and no `scroll-request`.
  After Continue, Back or Edit the preview focuses the new step's heading
  instead; where the browser lets a framed document's focus scroll its parent
  (Chromium and Firefox do), that brings the step into the portal's view.
- **Portal → preview**: `update` alone, `{ appearance?, preview? }`. `init`,
  `token`, `token-error` and `presentation` are dropped like an unknown type, so
  a session sent to this document by mistake is never applied or stored. (The
  inline script buffers whatever arrives before the bundle runs, as it does for
  the app, and the bundle then drops it.)
- **Origin and source.** The preview accepts messages only from the window that
  framed it (`event.source === window.parent`). The first valid `update` locks
  the origin: from then on the preview hears only that origin, and posts
  `resize` only to it. Before the lock it posts nothing after `ready`, and a
  dropped message locks nothing. So until its first `update` is accepted it
  reports no height, and the portal gives the frame a placeholder height, as the
  loader does.
- **What the portal accepts.** The loader's rule, held by the portal: it acts on
  `ready` and `resize` only when `event.source` is the `contentWindow` of the
  preview frame it created and `event.origin` is the SDK origin, and it posts
  `update` to the SDK origin.
- **Version.** There is no `init` to negotiate one. The portal replies to
  `ready` with an `update` at a version no higher than the `protocolMax` that
  `ready` announced (and, by the receive rule above, no lower than the oldest
  the app still supports), and the preview answers at the version of the latest
  `update` it accepted. The
  portal answers every `ready`, not only the first: a frame whose bundle runs
  after the inline script has stopped buffering announces again.
- **Every `update` is the complete state**, because there is no `init` to carry
  it: the portal sends its whole draft each time, and the preview replaces what
  it shows wholesale. No `appearance` means doola's own palette; no `preview`
  means `onboarding`.
- **`preview` names the surface**: `onboarding` (the formation wizard) or
  `dashboard`. Any other string is shown as `onboarding` rather than failing the
  message, so a portal that learns a surface before the app does still repaints
  the branding. A value that is not a string is a malformed payload, and the
  whole `update` is dropped with it, branding included. The field is additive:
  an app or loader that does not know it ignores it, which is why it needed no
  version bump.
- **No network.** The preview never calls the SDK API, the saved
  `GET /v1/sdk/branding` included, since that would mask the unsaved draft. Its
  only requests are its own static assets and the image `appearance.logoUrl`
  names.

The URL is `https://sdk.test.doola.com/preview`, and `https://sdk.doola.com/preview`
once production is live. Its `ready` is the app's, byte for byte; the portal
knows which document it framed.

## Token renewal

The loader owns renewal; the app cannot renew (its `fetchAccessToken` is partner code
living in the partner's page).

1. Loader schedules renewal at **80% of `expiresIn`** — a relative timer started
   when the session is received. The fraction is loader policy owned by this
   document, deliberately absent from the public contract so it can change
   (jitter, a different fraction) without a breaking release. A relative timer
   never reads the device clock, which makes it the skew-immune option;
   deriving remaining life as `Date.parse(expiresAt) − Date.now()` mixes the
   server clock into the end user's device clock and is rejected for exactly
   that reason. Never computed from decoding the JWT.
2. On fire, loader calls `fetchAccessToken()` and posts `token` in.
3. Reactive backstop: app hits a 401 (throttled timers in backgrounded tabs),
   posts `token-request`, loader renews on demand. The reply is `token` — or,
   when the renewal cannot succeed, `token-error` (step 4), so the frame is
   never left waiting.
4. A `fetchAccessToken` rejection is mapped by the loader from the `status` the
   rejection exposes (the convention lives in the contract, on
   `FetchAccessToken`); a synchronous throw is treated as a rejection with no
   `status`:
   - `401` → `onAuthError({ type: 'partner_session_expired', message: … })`,
     and the loader stops retrying on its own — automatic renewal ends, but a
     `token-request` from the frame (a user-initiated try-again after logging
     back in with the partner) is still honoured, and so is a later mount,
     which fetches afresh. The partner's own user session died. Only the partner's own 401 can reach the loader — the route
     rule lives on `FetchAccessToken` in the contract; a broken `dk_` key
     lands in `mint_failed`/`renewal_failed`, never here.
   - `409` → `onAuthError({ type: 'email_in_use', message: … })`, also
     terminal. First mint only; cannot occur on renewal.
   - anything else → `mint_failed` on first mint, `renewal_failed` on renewal.

   In every case the loader also posts `token-error` into every mounted frame
   with the same `reason`, so the app can render the state instead of hanging
   on an unanswered `token-request`. `onAuthError` fires each time as well —
   the contract makes it idempotent for that reason.

   Semantics and the partner's expected response are owned by the contract
   (see `DoolaAuthError`).

## Sessions never touch storage

The session lives in loader memory and app memory, passed only over this bus.
`localStorage`, `sessionStorage`, and cookies are forbidden for it — third-party
storage is partitioned or blocked in Safari and Firefox anyway, and the design
must never depend on it.
