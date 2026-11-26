---
'@doola/js': minor
---

`createCustomerSession` and `createSessionHandler` now forward doola's code on a 400 `E_VALIDATION_FAILED`, as they do for the scope 403: the session route answers the 400 with `{ code: 'E_VALIDATION_FAILED' }`. The code only: which field doola refused stays in `failure.doolaFields`, for your server log. Every other 400 still answers without a code.

On the first session the loader treats that 400 as final, like the scope 403: the frame offers no Try again, and `onLoadError` gets `invalid_request_error` alongside `onAuthError`'s `mint_failed`, with a message that names no field. A later `ready` or mount still fetches again, so keep both handlers idempotent. On a renewal it stays a retryable `renewal_failed`: while the frame holds a live token, the app keeps working until it expires. A founder who comes back after the session went stale is minted as a renewal too, so a refusal then is a retryable `renewal_failed` with no token behind it; that is unchanged here.

`onLoadError` now runs even when the partner's `onAuthError` throws, for the scope 403 too; the `onAuthError` error still propagates as before.

The loader is served from js.doola.com, so this reaches every route that forwards doola's code on a 400 as soon as the loader deploys, whatever its `@doola/js` version: a hand-written route that already forwards `error.code` on every error changes too. A route that forwards no code on a 400, such as one built with an older `@doola/js`, keeps the retry.
