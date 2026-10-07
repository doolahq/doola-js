---
'@doola/js': minor
'@doola/sdk-protocol': minor
---

`onAuthError` can now tell doola's three session 409s apart, when your session route forwards doola's error code. A 409 whose `code` is `E_EMAIL_IN_USE` is `email_in_use`, `E_RESOURCE_CONFLICT` is the new `external_id_conflict` (your `externalCustomerId` conflicts with doola's record), and `E_CUSTOMER_REVOKED` is the new `customer_revoked`. A route that forwards only the status keeps getting `email_in_use` for a first-mint 409, but the frame now shows its generic failure for it rather than telling the founder their email is taken. A 409 on renewal is no longer `email_in_use`: without a code, or with `E_EMAIL_IN_USE`, it is `renewal_failed`, as the docs always said.

To get the new types, forward the code. `@doola/js/server` now answers doola's 409 with the JSON body `{ code }` (and `createCustomerSession` returns it as `code`; send it as the body). In `fetchAccessToken`, read it and reject with it:

```ts
if (!r.ok) {
  const { code } = await r.json().catch(() => ({}));
  throw Object.assign(new Error('doola session'), { status: r.status, code });
}
```

If you switch on `error.type` exhaustively, add the two new cases.
