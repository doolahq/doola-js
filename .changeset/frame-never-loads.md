---
'@doola/js': patch
---

Report a frame that never loads. Until now `onLoadError` could only fire from a
`load-error` message sent by the app, so the one failure where the app never
runs — a 404, a `frame-src` CSP that refuses the frame, a browser extension, or
a crash before the first post — reached the partner as nothing at all: an empty
box on their page and silence from every handler they registered.

The loader now raises `render_error` itself. The frame element's `load` event
arms a short deadline on the first `ready`, with a longer backstop for a
document that never loads at all. `load` is the arming signal rather than the
failure signal because Chromium fires it for a 404, a CSP-refused frame and a
connection-refused request exactly as it does for a healthy document — and
fires `error` for none of them — so only the absence of `ready` says what the
navigation finished as.

Reported once per mount. A late `ready` does not retract it — the partner has
already reacted — but does not prevent the handshake either, so a frame that
recovers still works.
