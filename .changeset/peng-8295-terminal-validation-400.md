---
'@doola/js': minor
---

`createCustomerSession` and `createSessionHandler` now forward doola's code on a 400 `E_VALIDATION_FAILED`, as they do for the scope 403: the session route answers the 400 with `{ code: 'E_VALIDATION_FAILED' }`. The code only: which field doola refused stays in `failure.doolaFields`, for your server log. Every other 400 still answers without a code.

On the first session the loader treats that 400 as final, like the scope 403: no Try again, and `onLoadError` gets `invalid_request_error` alongside `onAuthError`'s `mint_failed`, with a message that names no field. On a renewal it stays a retryable `renewal_failed`. A route built with an older `@doola/js` forwards no code on a 400 and keeps the retry.
