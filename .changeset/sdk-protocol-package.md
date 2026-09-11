---
'@doola/sdk-protocol': minor
---

The loader ↔ app wire format, extracted so both sides share one implementation:
message types for each direction, inbound validators that drop anything
malformed or unknown, outbound payload projections, version negotiation, and
the `token-error` mapping.
