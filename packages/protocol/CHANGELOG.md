# @doola/sdk-protocol

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
