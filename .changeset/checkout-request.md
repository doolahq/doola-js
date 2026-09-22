---
'@doola/sdk-protocol': minor
'@doola/js': patch
---

Add the `checkout-request` app → loader message: the founder asking to be
handed back to the partner's checkout, from a waiting screen for a company
that is still unpaid.

It routes to the same `onFormed` with the same `{ companyId }`, so a partner
already integrated against it needs no change. What does change is the
guarantee: `onFormed` can now fire more than once for one company, and a
handler that creates a fresh order per call would charge a returning founder
twice. The contract says so on `onFormed`.

No protocol bump. A new message type is something the other side may ignore,
and both sides already drop what they do not recognise.
