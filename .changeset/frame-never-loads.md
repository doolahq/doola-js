---
'@doola/js': patch
---

Report a frame that never loads. Until now `onLoadError` could only fire from a
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
