# Loader ↔ iframe protocol

The contract between the loader (partner's page, doola code) and the embedded app
(`sdk.doola.com`, inside the iframe). Internal to doola — partners never touch this —
but versioned like a public API because **the two sides deploy independently**:
on every deploy, new-loader-with-old-app and old-loader-with-new-app both exist
in the wild for minutes. Both sides MUST support protocol version N−1.

## Envelope

Every message, both directions:

```json
{ "v": 1, "type": "…", "payload": {} }
```

An unknown `type` is ignored, never an error. A `v` above the receiver's maximum
triggers a downgrade handshake: the receiver replies with its own maximum and both
sides speak the lower version.

## Origin checks — both directions, no exceptions

- The **loader** accepts messages only from the `sdk.doola.com` origin.
- The **app** accepts messages only from the partner origin the iframe was mounted on,
  and posts back to exactly that origin.
- `"*"` as a target origin is forbidden in both directions. This holds regardless of
  same-origin API routing: postMessage origin checking is a different mechanism from CORS.

## Messages: app → loader

| type             | payload             | notes                                                                                          |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `ready`          | `{ protocolMax }`   | app booted; loader replies with `init`                                                         |
| `resize`         | `{ height }`        | from a ResizeObserver on the app root                                                          |
| `scroll-request` | `{ top }`           | app asks the parent page to scroll a point into view                                           |
| `token-request`  | `{}`                | backstop path: app got a 401 mid-session                                                       |
| `formed`         | `{ companyId }`     | loader forwards to the partner's `onFormed` — **only the id, nothing else** (see the contract) |
| `auth-error`     | `{ type, message }` | loader forwards to `onAuthError`                                                               |
| `load-error`     | `{ type, message }` | loader forwards to `onLoadError`                                                               |
| `loader-start`   | `{ componentType }` | first paint inside the frame                                                                   |

## Messages: loader → app

| type           | payload                                       | notes                                             |
| -------------- | --------------------------------------------- | ------------------------------------------------- |
| `init`         | `{ session, appearance?, locale?, protocol }` | first message after `ready`                       |
| `token`        | `{ session }`                                 | renewal result; also the reply to `token-request` |
| `update`       | `{ appearance?, locale? }`                    | runtime `update()` call                           |
| `presentation` | `{ mode }`                                    | inline ↔ fullScreen transitions                   |

## Token renewal

The loader owns renewal; the app cannot renew (its `fetchAccessToken` is partner code
living in the partner's page).

1. Loader schedules renewal at **80% of remaining life** — this number is loader
   policy owned by this document, deliberately absent from the public contract so
   it can change (jitter, a different fraction) without a breaking release.
   Computed from the `expiresAt` the partner's server returned: never from
   decoding the JWT, never a fixed offset (fixed timers fire late under client
   clock skew).
2. On fire, loader calls `fetchAccessToken()` and posts `token` in.
3. Reactive backstop: app hits a 401 (throttled timers in backgrounded tabs),
   posts `token-request`, loader renews on demand.
4. If `fetchAccessToken` fails with a 401 from the partner's own route, the loader
   raises `onAuthError({ type: 'partner_session_expired' })` and stops retrying —
   semantics and the partner's expected response are owned by the contract
   (see `DoolaAuthError`).

## Sessions never touch storage

The session lives in loader memory and app memory, passed only over this bus.
`localStorage`, `sessionStorage`, and cookies are forbidden for it — third-party
storage is partitioned or blocked in Safari and Firefox anyway, and the design
must never depend on it.
