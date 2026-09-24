# doola-js

[![npm](https://img.shields.io/npm/v/@doola/js)](https://www.npmjs.com/package/@doola/js)
[![CI](https://github.com/doolahq/doola-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/doolahq/doola-js/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/doolahq/doola-js/badge)](https://scorecard.dev/viewer/?uri=github.com/doolahq/doola-js)
[![license](https://img.shields.io/npm/l/@doola/js)](LICENSE)

Browser SDK for embedding [doola](https://www.doola.com) company formation in your product.

Your customer forms a US company — LLC or C Corp, state filing, EIN, registered agent,
documents — inside your app, under your brand, without the data ever passing through
your code.

## How it works

This package is deliberately small. It injects doola's versioned loader from
`js.doola.com`, which mounts an iframe served from `sdk.doola.com` — or from
your own domain via CNAME (the `origin` option).
Every screen, field, and validation lives inside that iframe on doola's origin:

- **Your page never sees the data.** SSNs, ITINs, and signatures are typed into a
  doola origin and sent to doola's API. They are absent from your JavaScript, your
  error tracker, your session replay, and your logs.
- **You never redeploy for our changes.** State requirements, IRS forms, and UI
  improvements ship inside the iframe. The npm package pins the shape of the call,
  never the behavior behind it.

## Get started

The integration guide lives in the [`@doola/js` README](./packages/js/README.md), the page npm
shows. It covers keys and environments, the one route your server hosts, mounting, the payment
handoff, errors, Content Security Policy and browser support.

```bash
npm install @doola/js
```

## Packages

| Package                                      | What it is                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| [`@doola/js`](./packages/js)                 | Loader injection + the TypeScript contract. No UI.                            |
| [`@doola/loader`](./packages/loader)         | The loader served from `js.doola.com`. Public source; never published to npm. |
| [`@doola/sdk-protocol`](./packages/protocol) | The loader ↔ embedded app wire format. Internal; partners never import it.    |
| `@doola/react`                               | React bindings. Arrives after the core contract stabilizes.                   |

## Repository layout

- [`packages/js/src/types.d.ts`](./packages/js/src/types.d.ts) — the public contract (surface rules in [CONTRIBUTING.md](./CONTRIBUTING.md)).
- [`docs/protocol.md`](./docs/protocol.md) — the loader ↔ iframe protocol (internal, versioned), implemented by [`packages/protocol`](./packages/protocol).
- [`docs/errors.md`](./docs/errors.md) — error taxonomy.

## Security

See [SECURITY.md](./SECURITY.md). Never open a public issue for a vulnerability.

## License

[MIT](./LICENSE)
