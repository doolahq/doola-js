# Loader ↔ iframe protocol

**Protocol version: 1.** This document is the version declaration; the `since`
column in the message tables records the version each message was added in.

The contract between the loader (partner's page, doola code) and the embedded app
(the SDK origin, inside the iframe). Internal to doola — partners never touch this —
but versioned like a public API because **the two sides deploy independently**:
on every deploy, new-loader-with-old-app and old-loader-with-new-app both exist
in the wild for minutes. Both sides MUST support protocol version N−1.

N−1 covers only this pair, which deploys minutes apart. The shim ↔ loader pair
lives under a much stricter rule — every published shim version, for as long as
it is installed anywhere within a loader URL major — owned by CONTRIBUTING.md.

Everywhere this document says "the SDK origin", it means the value the loader
resolved for this instance — from the publishable key's environment, or from the
`origin` option for CNAME partners (both defined in the contract) — never a
hardcoded host.

## Envelope

Every message, both directions:

```json
{ "v": 1, "type": "…", "payload": {} }
```

An unknown `type` is ignored, never an error. Version negotiation happens once,
up front, in the `ready`/`init` handshake: `ready` carries the app's
`protocolMax`, `init` replies with the `protocol` both sides then speak —
`min(loaderMax, appMax)`. There is no other downgrade mechanism.

## Origin and source checks — both directions, no exceptions

- The **loader** accepts a message only when both hold:
  - `event.source === iframe.contentWindow` of a frame it mounted. Origin is
    not frame identity: any injected `<iframe>` pointing at the SDK origin
    shares that origin, and with two components mounted, source is also what
    attributes a message to the right frame.
  - `event.origin` equals the SDK origin.
- The **app** accepts messages only from the partner origin `init` arrived from,
  and posts back to exactly that origin.
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

| type             | payload             | since | notes                                                                                                                          |
| ---------------- | ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ready`          | `{ protocolMax }`   | 1     | app booted; the one message allowed targetOrigin `"*"`; loader replies with `init`                                             |
| `resize`         | `{ height }`        | 1     | from a ResizeObserver on the app root; coalesced to one post per animation frame, skipped when equal to the last posted height |
| `scroll-request` | `{ top }`           | 1     | app asks the parent page to scroll a point into view                                                                           |
| `token-request`  | `{}`                | 1     | backstop path: app got a 401 mid-session                                                                                       |
| `formed`         | `{ companyId }`     | 1     | loader forwards to the partner's `onFormed` — **only the id, nothing else** (see the contract)                                 |
| `auth-error`     | `{ type, message }` | 1     | loader forwards to `onAuthError`                                                                                               |
| `load-error`     | `{ type, message }` | 1     | loader forwards to `onLoadError`                                                                                               |
| `loader-start`   | `{}`                | 1     | first paint inside the frame                                                                                                   |

## Messages: mounting peer → app

The mounting peer is the loader — or the portal's branding preview, see below.

| type           | payload                                       | since | notes                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`         | `{ session, appearance?, locale?, protocol }` | 1     | first message after `ready`; `appearance` is sent by internal peers only                                                                                                                                                                                         |
| `token`        | `{ session }`                                 | 1     | renewal result; also the reply to `token-request`                                                                                                                                                                                                                |
| `update`       | `{ appearance?, locale? }`                    | 1     | runtime `update()` call — see below; `appearance` internal peers only                                                                                                                                                                                            |
| `token-error`  | `{ reason, message, retryable }`              | 1     | a token could not be obtained; `reason` is the `DoolaAuthError` type; `retryable` means the loader will keep renewing on its own — the frame may still send `token-request` in either case, for terminal reasons only after the user has acted outside the frame |
| `presentation` | `{ mode }`                                    | 1     | inline ↔ fullScreen transitions                                                                                                                                                                                                                                  |

`update` carries the loader's **resolved** state, not the partner's raw call:
the contract's merge semantics (absent key keeps, key present as `undefined`
clears) are applied by the loader against the state it holds, and the app
replaces its values wholesale with what arrives. The app never merges.

`appearance` on `init` and `update` is a doola-internal channel, not a partner
option — branding lives in the partner portal, and the public `update()` carries
only `locale`. Its consumer is the portal's branding preview, which mounts the app
the way a loader does and speaks this protocol unchanged: `ready`, `init`, then
`update { appearance }` for each unsaved draft. It adds no message types — the
`branding_preview` message in earlier sketches is `update { appearance }`. The
shape of `appearance` is owned by the branding backend (PENG-6219).

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
   `FetchAccessToken`):
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
