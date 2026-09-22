---
'@doola/js': patch
---

Report a frame that never loads. Until now `onLoadError` could only fire from a
`load-error` message sent by the app, so the one failure where the app never
runs — a 404, a `frame-src` CSP that refuses the frame, a browser extension, or
a crash before the first post — reached the partner as nothing at all: an empty
box on their page and silence from every handler they registered.

The loader now raises `render_error` itself, from an `error` listener on the
frame element and from a 45-second deadline on the first `ready`. Both are
needed: a 404 and a CSP-blocked frame still fire the element's `load` event, so
only the absence of `ready` distinguishes a frame that loaded from one that
loaded and is dead.

Reported once per mount. A late `ready` does not retract it — the partner has
already reacted — but does not prevent the handshake either, so a frame that
recovers still works.
