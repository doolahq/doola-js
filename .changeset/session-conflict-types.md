---
'@doola/js': minor
'@doola/sdk-protocol': minor
---

`onAuthError` now tells doola's three session 409s apart. A 409 whose `code` is `E_EMAIL_IN_USE` is `email_in_use` on the first mint, `E_RESOURCE_CONFLICT` is the new `external_id_conflict` (your `externalCustomerId` conflicts with doola's record), and `E_CUSTOMER_REVOKED` is the new `customer_revoked`. A 409 without a recognised `code`, and `E_EMAIL_IN_USE` on renewal, are `mint_failed` or `renewal_failed`, so a founder is never told their email is taken for another reason.

To get the new types, forward the code. `@doola/js/server` now answers a refused session with the JSON body `{ code }` (and `createCustomerSession` returns it as `code`; send it as the body). In `fetchAccessToken`, read it and reject with it:

```ts
if (!r.ok) {
  const { code } = await r.json().catch(() => ({}));
  throw Object.assign(new Error('doola session'), { status: r.status, code });
}
```

If you switch on `error.type` exhaustively, add the two new cases.
