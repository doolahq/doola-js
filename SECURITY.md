# Security policy

## Reporting a vulnerability

Email **security@doola.com**. Do not open a public issue.

We will acknowledge within 2 business days. Please include reproduction steps and
the affected package or endpoint.

## Scope notes for researchers

- The publishable key (`pk_…`) is public by design; possessing one is not a finding.
- The session token (`cs_…`) is scoped to a single customer and expires in minutes;
  findings about widening that scope are very much in scope.
- The partner API key (`dk_…`) must never be observable in a browser context.
  Anything that makes that possible is the highest-severity class here.
