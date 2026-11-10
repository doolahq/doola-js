---
'@doola/js': minor
---

`create()` takes an optional `product`, `'formation'` (the default) or `'tax'`, so a partner mounts tax filing with the same package, keys and session route. `create()` with no argument is unchanged, and the formation frame URL is byte-for-byte what it was. An unknown product throws at `create()`.

`onFormed` is now optional in the types. The loader checks it when a formation component is created, with the same message as before, and never for tax.

`createCustomerSession` and `createSessionHandler` take an optional `scopes` (`sdk:formation`, `sdk:tax` or both). Omitted, the field is not sent and the mint body is unchanged. The helpers now forward doola's code on a 403 `E_SCOPE_NOT_ENTITLED`, and on the first mint the loader treats it as terminal: no Try again, and `onLoadError` with `invalid_request_error` alongside `onAuthError`. On a renewal it stays a retryable `renewal_failed`. Every other 403 still answers without a code.
