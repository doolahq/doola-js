# Getting help

## Integrating the SDK

Email **engineering@doola.com**, the same address as the
[Partner API docs](https://docs.doola.com). Issues are turned off on this
repository: partner integrations run through your doola contact, not a public
tracker.

Most integration problems surface as an `onAuthError` or `onLoadError` `type`.
[docs/errors.md](docs/errors.md) says what each one means and what your code
should do. When you write, include:

- the `@doola/js` version
- the error `type` and `message`, and whether it came from `onAuthError` or
  `onLoadError`
- the browser and its version
- whether you use a `pk_test_` or a `pk_live_` key

Publishable keys are public, so sharing one is fine. **Never send your partner
API key (`dk_…`) or a session token (`cs_…`).**

## Not a partner yet

[Partner with doola](https://www.doola.com/partner-with-us/) to get API access.

## Security

Report vulnerabilities to **security@doola.com**, never in public. See
[SECURITY.md](SECURITY.md).
