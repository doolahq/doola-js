---
'@doola/js': patch
---

Inject the loader tag with `crossorigin="anonymous"`, so an uncaught error
inside the loader reaches a partner's `window.onerror` with a file, line and
stack instead of the opaque "Script error.". `js.doola.com` already serves
`Access-Control-Allow-Origin: *`, so nothing else has to change for it.
