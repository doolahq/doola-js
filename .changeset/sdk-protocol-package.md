---
'@doola/sdk-protocol': minor
---

The loader ↔ app wire format, extracted so both sides share one implementation:
message types for each direction, inbound validators that drop anything
malformed or unknown, outbound payload projections, and version negotiation.

Policy stays with its owner and is deliberately not here: `RETRYABLE` and
`tokenError` (whether the loader keeps renewing is the loader's call, and the
wire carries only the resulting boolean), and `parseSession` (the
`fetchAccessToken` boundary, which is partner code rather than the bus).
