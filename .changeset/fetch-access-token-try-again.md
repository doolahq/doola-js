---
'@doola/js': patch
---

`fetchAccessToken` is also called each time the founder presses **Try again** after a session fails to start, up to three times, and each failed try reaches `onAuthError`. The guide and the type docs now say so.
