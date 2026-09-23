# @doola/js

## 0.1.0

### Minor Changes

- 865cc76: First published release of the loader shim: `loadDoola()`, the `<doola-embed>`
  mount, the `fetchAccessToken` session boundary and the `DoolaError` codes, with
  the full public contract in `src/types.d.ts`.

  `0.1.x` rather than `1.0.0` on purpose. The surface is what partners will pin
  forever once it is stable, and nothing has integrated against it yet — the
  minor series says so, and buys room to reshape it before the guarantees in
  CONTRIBUTING.md ("additive is fine, removals effectively never happen") start
  binding.

### Patch Changes

- 16f11f6: Add the `checkout-request` app → loader message: the founder asking to be
  handed back to the partner's checkout, from a waiting screen for a company
  that is still unpaid.

  It routes to the same `onFormed` with the same `{ companyId }`, so a partner
  already integrated against it needs no change. What does change is the
  guarantee: `onFormed` can now fire more than once for one company, and a
  handler that creates a fresh order per call would charge a returning founder
  twice. The contract says so on `onFormed`.

  No protocol bump. A new message type is something the other side may ignore,
  and both sides already drop what they do not recognise.

- 16f11f6: Report a frame that never loads. Until now `onLoadError` could only fire from a
  `load-error` message sent by the app, so the one failure where the app never
  runs — a 404, a `frame-src` CSP that refuses the frame, a browser extension, or
  a crash before the first post — reached the partner as nothing at all: an empty
  box on their page and silence from every handler they registered.

  The loader now raises `render_error` itself. A backstop starts at mount; the
  frame element's `load` event then brings it forward to a few seconds, and
  `ready` clears it. Whichever deadline expires first is the report, and the
  backstop is a ceiling — a late `load` cannot push it out. `load` is the arming
  signal rather than the failure signal because Chromium fires it for a 404, a CSP-refused frame and a
  connection-refused request exactly as it does for a healthy document — and
  fires `error` for none of them — so only the absence of `ready` says what the
  navigation finished as.

  Reported once per mount, and the `message` names which of the three causes it
  was: the document never loaded, it loaded but never started, or it spoke a
  protocol version this loader does not support. A late `ready` does not retract
  the error — the partner has already reacted — but does not prevent the handshake
  either, so a frame that recovers still works.

  A frame promoted to full screen on a narrow viewport is returned to its inline
  placeholder and the page scroll is released, so a failure cannot leave a founder
  on a blank fixed sheet.

- 0d66fba: Inject the loader tag with `crossorigin="anonymous"`, so an uncaught error
  inside the loader reaches a partner's `window.onerror` with a file, line and
  stack instead of the opaque "Script error.". `js.doola.com` already serves
  `Access-Control-Allow-Origin: *`, so nothing else has to change for it.
