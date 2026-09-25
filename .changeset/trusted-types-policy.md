---
'@doola/js': patch
---

`loadDoola()` now works on pages that enforce Trusted Types. The shim creates a `doola-js` policy that accepts only the loader URL, so allow it with `trusted-types doola-js`. Where the name is not allowed, `loadDoola()` rejects with a message naming that directive instead of the browser's `TrustedScriptURL` error. Pages without Trusted Types are unaffected.
