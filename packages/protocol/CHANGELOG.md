# @doola/sdk-protocol

## 0.3.0

### Minor Changes

- a00e17a: `update` now carries `preview`, the surface the partner portal's branding preview shows, and the new `PreviewSurface` type names the two it has today: `onboarding` and `dashboard`. `parseLoaderMessage` accepts any string there, so a surface the portal learns before the app does still repaints the branding, and it drops the whole `update`, branding included, when `preview` is anything other than a string. The portal already sends this field and the app already reads it, each from a hand-typed copy; with it in the package, both can import it instead.
  
  No protocol bump. The field is optional, a peer that does not know it ignores it, and the loader never sends it.

## 0.2.0

### Minor Changes

- a8ef284: `onAuthError` can now tell doola's three session 409s apart, when your session route forwards doola's error code. A 409 whose `code` is `E_EMAIL_IN_USE` is `email_in_use`, `E_RESOURCE_CONFLICT` is the new `external_id_conflict` (your `externalCustomerId` conflicts with doola's record), and `E_CUSTOMER_REVOKED` is the new `customer_revoked`. A route that forwards only the status keeps getting `email_in_use` for a first-mint 409, but the frame now shows its generic failure for it rather than telling the founder their email is taken. A 409 on renewal is no longer `email_in_use`: without a code, or with `E_EMAIL_IN_USE`, it is `renewal_failed`, as the docs always said.
  
  To get the new types, forward the code. `@doola/js/server` now answers doola's 409 with the JSON body `{ code }` (and `createCustomerSession` returns it as `code`; send it as the body). In `fetchAccessToken`, read it and reject with it:
  
  ```ts
  if (!r.ok) {
    const { code } = await r.json().catch(() => ({}));
    throw Object.assign(new Error('doola session'), { status: r.status, code });
  }
  ```
  
  If you switch on `error.type` exhaustively, add the two new cases.

## 0.1.1

### Patch Changes

- a582a43: The npm page and description now say up front that this package is internal to doola, and point partners to `@doola/js`.

## 0.1.0

### Minor Changes

- 16f11f6: Add the `checkout-request` app → loader message: the founder asking to be
  handed back to the partner's checkout, from a waiting screen for a company
  that is still unpaid.

  It routes to the same `onFormed` with the same `{ companyId }`, so a partner
  already integrated against it needs no change. What does change is the
  guarantee: `onFormed` can now fire more than once for one company, and a
  handler that creates a fresh order per call would charge a returning founder
  twice. The contract says so on `onFormed`.

  No protocol bump. A new message type is something the other side may ignore,
  and both sides already drop what they do not recognise.

- 2ec73d5: The loader ↔ app wire format, extracted so both sides share one implementation:
  message types for each direction, inbound validators that drop anything
  malformed or unknown, outbound payload projections, and version negotiation.

  Policy stays with its owner and is deliberately not here: `RETRYABLE` and
  `tokenError` (whether the loader keeps renewing is the loader's call, and the
  wire carries only the resulting boolean), and `parseSession` (the
  `fetchAccessToken` boundary, which is partner code rather than the bus).
