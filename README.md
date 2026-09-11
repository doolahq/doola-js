# doola-js

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

## Install

```bash
npm install @doola/js
```

## The one route you host

Your server is the only place your doola API key lives. It mints a short-lived
session for your signed-in user:

```js
// ~10 lines, needs no database
app.post('/doola-session', async (req, res) => {
  if (!req.user) return res.status(401).end();

  const r = await fetch('https://api.doola.com/v1/partner/customer-sessions', {
    method: 'POST',
    headers: { authorization: process.env.DOOLA_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: req.user.email }),
  });

  // one exception: doola's 401 means YOUR key or tenant, not the
  // customer's session — forwarding it would loop them to your login.
  if (!r.ok) return res.status(r.status === 401 ? 502 : r.status).end();

  // forward exactly the fields the loader consumes, never the whole body
  const { accessToken, expiresIn } = await r.json();
  res.json({ accessToken, expiresIn });
});
```

## Mount

```js
import { loadDoola } from '@doola/js';

const doola = await loadDoola({
  publishableKey: 'pk_live_…',
  fetchAccessToken: async () => {
    const r = await fetch('/doola-session', { method: 'POST' });
    if (!r.ok) throw Object.assign(new Error('doola session'), { status: r.status });
    return r.json();
  },
  onAuthError: (e) => {
    if (e.type === 'partner_session_expired') location.href = '/login';
  },
  onFormed: ({ companyId }) => startCheckout(companyId),
});

// no arguments: the app decides what renders from what the session resolves to
document.querySelector('#doola').append(doola.create());
```

Optional but cheap: `<link rel="preconnect" href="https://sdk.doola.com" />` in your
`<head>` lets the iframe's TLS handshake overlap the session mint.

Branding — your logo, colors, and typography — is configured once in the
[partner portal](https://portal.doola.com) and applies before first paint.

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
