# @doola/js

[![npm](https://img.shields.io/npm/v/@doola/js)](https://www.npmjs.com/package/@doola/js)
[![CI](https://github.com/doolahq/doola-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/doolahq/doola-js/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/doolahq/doola-js/badge)](https://scorecard.dev/viewer/?uri=github.com/doolahq/doola-js)
[![license](https://img.shields.io/npm/l/@doola/js)](https://github.com/doolahq/doola-js/blob/main/LICENSE)

Embed [doola](https://www.doola.com) US company formation in your product. Your customer forms
an LLC or C Corp, with the state filing, EIN, registered agent and documents, inside your app and
under your brand.

This package is small on purpose (under 1 KB gzipped) and contains no UI. It loads doola's
versioned loader from `js.doola.com`, which mounts an iframe served from `sdk.doola.com`. Every
screen, field and validation lives inside that iframe:

- **Sensitive data never touches your code.** SSNs, ITINs and signatures are typed into doola's
  origin and sent to doola's API. They never appear in your JavaScript, your error tracker, your
  session replay or your logs.
- **You never redeploy for our changes.** State requirements, IRS forms and UI improvements ship
  inside the iframe. This package pins the shape of the call, never the behavior behind it.

## How it fits together

1. **Your server** mints a short-lived session for the signed-in customer, using your secret key.
2. **Your page** calls `loadDoola()` and appends the element it creates. The customer completes
   the formation wizard inside the iframe.
3. **On submit** you get `onFormed({ companyId })`. You take payment in your own checkout, and your
   server confirms it to doola. Nothing is filed and nothing is spent until you do.

## Before you start

You need two keys. The publishable key selects the environment for the browser, and the secret
key does the same on your server.

| Key         | Prefix                   | Where it lives                                  | How to get it                                                                               |
| ----------- | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Publishable | `pk_test_` or `pk_live_` | Your frontend. Public by design.                | Issued by doola with your SDK access. It identifies you and selects your branding.          |
| Secret      | `dk_test_` or `dk_live_` | Your server only. Never in a browser or bundle. | [Partner portal](https://partners-portal.doola.com), under **Settings**, then **API Keys**. |

Test and live are separate stacks with separate data. Use a matching pair:

| Environment | Keys                   | Partner API                  | Embedded app                 |
| ----------- | ---------------------- | ---------------------------- | ---------------------------- |
| Test        | `pk_test_`, `dk_test_` | `https://api.test.doola.com` | `https://sdk.test.doola.com` |
| Live        | `pk_live_`, `dk_live_` | `https://api.doola.com`      | `https://sdk.doola.com`      |

## Install

```bash
npm install @doola/js
```

TypeScript types are included. The package is ESM and CommonJS, with two entry points: `@doola/js`
runs in the browser only, and `@doola/js/server` runs on your server, on Node 18 or later or any
runtime with the web-standard `fetch`.

## 1. Mint a session on your server

Your server is the only place your secret key lives. Add one authenticated route that
[creates a customer session](https://docs.doola.com/api/api-reference/customer-sessions/create-a-customer-session)
for the signed-in customer. It needs no database. `createSessionHandler` builds the route: it
takes the web-standard `Request` and returns a `Response`. That makes it a Next.js route handler
as written, and a one-line wrapper in Remix (`action`), Hono, Bun, Deno and Cloudflare Workers,
where `process.env` needs the `nodejs_compat` flag.

<!-- example: session-route -->

```ts
// POST /doola-session
import { createSessionHandler } from '@doola/js/server';

export const POST = createSessionHandler({
  // Your dk_ secret key. Its prefix selects the API host, and a missing key throws here.
  apiKey: process.env.DOOLA_API_KEY,

  // Return null when nobody is signed in. The route answers 401, and the loader reports
  // partner_session_expired.
  getCustomer: async (request) => {
    const user = await getSignedInUser(request); // your own auth
    // externalCustomerId is optional but recommended: it is matched before the email, so a
    // customer who changes their email with you stays the same doola customer.
    return user ? { email: user.email, externalCustomerId: user.id } : null;
  },
});
```

The customer can also carry `firstName`, `lastName`, `countryOfResidence` and `phoneNumber`,
which doola uses only when it creates the customer.

For Express, Fastify or your own routing, `createCustomerSession` returns the status and body to
send:

```ts
import { createCustomerSession } from '@doola/js/server';

app.post('/doola-session', async (req, res) => {
  const user = await getSignedInUser(req); // your own auth
  if (!user) {
    res.status(401).end();
    return;
  }

  const { status, body } = await createCustomerSession({
    apiKey: process.env.DOOLA_API_KEY,
    customer: { email: user.email, externalCustomerId: user.id },
  });

  if (body) res.status(status).json(body);
  else res.status(status).end();
});
```

<details>
<summary>Not on JavaScript? The same route over plain HTTP</summary>

From any other language, call `POST /v1/partner/customer-sessions` with your secret key as the
whole `Authorization` header, with no `Bearer` prefix. Then keep the rules the helper owns:

- **doola's 401 becomes a 502.** It means your key or tenant is wrong, not the customer's session.
  Passed on, the loader would read it as `partner_session_expired` and send a signed-in customer to
  your login page. Every other status passes through, so doola's 409 still reaches the loader as
  `email_in_use`.
- **Unwrap the response.** doola wraps every response in `{ payload, error }`. Send the browser
  only `accessToken` and `expiresIn` from the payload, never the whole body.
- **A failure to reach doola is a 502 too**, as is a response that is not JSON.

<!-- example: session-route-http -->

```ts
// POST /doola-session
const DOOLA_API = 'https://api.doola.com'; // https://api.test.doola.com with a dk_test_ key

// Read per request, never at import: Next.js runs this module during `next build`, where your
// secret is often not set.
function doolaKey(): string {
  const key = process.env.DOOLA_API_KEY; // your dk_ secret key
  if (!key) throw new Error('DOOLA_API_KEY is not set');

  return key;
}

export async function POST(request: Request): Promise<Response> {
  const user = await getSignedInUser(request); // your own auth
  if (!user) return new Response(null, { status: 401 });

  const r = await fetch(`${DOOLA_API}/v1/partner/customer-sessions`, {
    method: 'POST',
    headers: { authorization: doolaKey(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, externalCustomerId: user.id }),
  });

  if (!r.ok) return new Response(null, { status: r.status === 401 ? 502 : r.status });

  const { payload } = await r.json();
  return Response.json({ accessToken: payload.accessToken, expiresIn: payload.expiresIn });
}
```

</details>

The token acts as that one customer and expires in minutes. The loader calls your route again to
renew it, so a doola session never outlives your own login. Protect the route like any other
authenticated `POST`, including your CSRF protection.

## 2. Mount in the browser

```ts
import { loadDoola } from '@doola/js';

const doola = await loadDoola({
  publishableKey: 'pk_live_…',

  // Called on mount and on every renewal. Always fetch a fresh session.
  fetchAccessToken: async () => {
    const r = await fetch('/doola-session', { method: 'POST' });
    // Reject with the HTTP status: the loader maps 401 and 409 to their own error types.
    if (!r.ok) throw Object.assign(new Error('doola session'), { status: r.status });
    return r.json();
  },

  // Can fire more than once, so keep it idempotent.
  onAuthError: (error) => {
    if (error.type === 'partner_session_expired') location.assign('/login');
    if (error.type === 'email_in_use') showSupportMessage();
  },

  // The customer submitted the wizard. Start your checkout for this company.
  onFormed: ({ companyId }) => startCheckout(companyId),
});

// Mount into an element on your page: <div id="doola"></div>
document.getElementById('doola')!.append(doola.create());
```

`create()` takes no arguments. The app decides what to show from the customer's state: the wizard
for a new customer, their company once one exists.

To start the connection early, add these to your `<head>`:

```html
<link rel="preconnect" href="https://js.doola.com" crossorigin />
<link rel="preconnect" href="https://sdk.doola.com" />
```

With test keys or `origin`, point the second hint at your frame host instead, as under
[Content Security Policy](#content-security-policy).

## 3. Take payment, then confirm it

`onFormed` hands you a company id and nothing else, on purpose. Anything delivered into your
page's JavaScript can be edited in DevTools, so your server works out what is owed. When your
checkout starts:

1. **Look the company up** with your secret key, using
   [Get a company](https://docs.doola.com/api/api-reference/companies/get-a-company). Charge only
   while its `formationSubmissionStatus` is `AWAITING_PAYMENT`.
2. **Check it belongs to the signed-in customer.** Pass the company's `doolaCustomerId` to
   [Get a customer](https://docs.doola.com/api/api-reference/customers/get-a-customer) and compare
   the `email`.
3. **Price it on your server** from the company's `state`, `entityType` and attached `services`,
   plus the state fee from
   [List state filing fees](https://docs.doola.com/api/api-reference/reference-data/list-state-filing-fees).
   Never read a price from the browser.
4. **Charge, then confirm** with
   [Confirm payment](https://docs.doola.com/api/api-reference/companies/confirm-payment-for-a-draft-formation).
   Nothing is filed until you do:

<!-- example: confirm-payment after session-route-http -->

```ts
// On your server, after the charge succeeds. DOOLA_API and doolaKey are as in the plain HTTP
// route in step 1.
async function confirmPayment(companyId: string, paymentReference: string): Promise<void> {
  const path = `/v1/partner/companies/${encodeURIComponent(companyId)}/payment-confirmed`;

  const r = await fetch(`${DOOLA_API}${path}`, {
    method: 'POST',
    headers: { authorization: doolaKey(), 'content-type': 'application/json' },
    // Your own reference (a payment intent id, an order id). Logged, never verified.
    body: JSON.stringify({ partnerReference: paymentReference }),
  });

  // Idempotent, so a failed call is safe to retry.
  if (!r.ok) throw new Error(`doola payment-confirmed failed with ${r.status}`);
}
```

`onFormed` can fire again for the same company, for example when a founder comes back to an unpaid
formation and asks to pay. Key your orders by `companyId` so you never charge twice. The iframe
shows a waiting screen until your confirmation arrives. After that, the
`company_formation_completed` [webhook](https://docs.doola.com/api/webhooks) tells you when the
company is formed.

## Options

Pass these once, to `loadDoola`. Full definitions with JSDoc ship in the package's types.

| Option             | Required | Description                                                                                                                                                             |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishableKey`   | Yes      | `pk_test_…` or `pk_live_…`. Its prefix selects the environment.                                                                                                         |
| `fetchAccessToken` | Yes      | Returns `{ accessToken, expiresIn }` from your route. On failure, reject with an object carrying the HTTP `status`.                                                     |
| `onAuthError`      | Yes      | A session could not be created or renewed. See [Errors](#errors).                                                                                                       |
| `onFormed`         | Yes      | `({ companyId })` when the customer submits, or asks to pay again. Start your checkout.                                                                                 |
| `onLoadError`      | No       | The component failed to load or run. Useful for your analytics, since the iframe shows its own error screen in most cases.                                              |
| `onLoaderStart`    | No       | The first time anything (including a loading state) is visible in the iframe.                                                                                           |
| `presentation`     | No       | `{ mode: 'auto' }` (default) switches to a full-screen overlay on narrow screens, so the iOS keyboard never covers an input. `{ mode: 'fullScreen' }` always uses it.   |
| `locale`           | No       | BCP 47 tag. `en` only today. Change it later with `doola.update({ locale })`.                                                                                           |
| `origin`           | No       | Your own domain for the app, by arrangement: doola adds it to its CDN and issues its certificate first. Keep it a constant: the session token is posted to this origin. |

Your logo, colors and font aren't options. doola applies them inside the iframe, based on your
publishable key.

## Errors

**`loadDoola()` rejects** when it cannot start. Handle this with your own fallback UI:

- Not running in a browser (see [Frameworks and SSR](#frameworks-and-ssr)).
- The loader could not load: a Content Security Policy, an ad blocker or the network.
- An invalid option, such as a key that is not `pk_test_…` or `pk_live_…`. The message says which.

**`onAuthError`** receives one of four types:

| `type`                    | What happened                                                                         | What to do                                                |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `partner_session_expired` | Your route returned 401: your own user's session has ended.                           | Redirect to your login. Retrying cannot succeed.          |
| `email_in_use`            | Your route returned doola's 409: this email belongs to a doola account outside yours. | Offer a support path or a different email. Never retried. |
| `mint_failed`             | The first session fetch failed for another reason, such as a 5xx or the network.      | Show your error state. Mounting again fetches again.      |
| `renewal_failed`          | A renewal failed for a reason other than 401. The current session keeps working.      | Usually nothing.                                          |

**`onLoadError`** reports `api_connection_error`, `authentication_error`,
`invalid_request_error`, `render_error` or `api_error`. The iframe renders its own error screen,
except for a frame that never started (a 404, a CSP refusal, a blocked request). In that case
`render_error` is the only signal, and your page is the only place to tell the customer.

Full playbook: [docs/errors.md](https://github.com/doolahq/doola-js/blob/main/docs/errors.md).

## Content Security Policy

If your site sends a CSP, allow the loader script and the iframe:

```text
script-src https://js.doola.com;
frame-src https://sdk.doola.com;
```

With test keys, the frame comes from `https://sdk.test.doola.com`, and with `origin` from your own
domain. Nothing else is needed: the session request goes to your own route, and the loader sets
its styles through the CSSOM, which `style-src` does not restrict.

If your CSP enforces Trusted Types (`require-trusted-types-for 'script'`), also allow the
`doola-js` policy. If you already send a `trusted-types` directive, add `doola-js` to its list:

```text
trusted-types doola-js;
```

The policy accepts only the loader URL, and the loader writes to no other Trusted Types sink. If
the name is not allowed, `loadDoola()` rejects with a message naming this directive.

## Frameworks and SSR

`loadDoola()` runs in the browser only. On the server it rejects, so call it from a client-only
path: `useEffect`, `onMounted`, a `'use client'` component or a dynamic import.

- **One instance per page.** Calling `loadDoola()` again with the same key returns the live
  instance, so React StrictMode's double invoke is safe. A different key rejects until you call
  `destroy()`.
- **Mounting.** `create()` returns a `<doola-embed>` element. Append it to mount it and remove it
  to unmount it. It is a block element: full width, with its height following the content.
- **Logout.** Call `doola.destroy()` when your user logs out, and never on an ordinary unmount or
  route change. It ends the session and every component, and the instance cannot be reused. To
  embed again, call `loadDoola()` again.

## Browser support

The embedded app needs Chrome or Edge 111+, Firefox 128+, or Safari 16.4+ (iOS 16.4+). It keeps
the session in memory and needs no third-party cookies, so it works in browsers that block them.

## Security

- Your secret `dk_` key belongs on your server only. The loader refuses anything that is not a
  publishable key, and `@doola/js/server` refuses a publishable one.
- Treat `companyId` like any id from a browser: check it on your server before you charge.
- Keep `origin` a constant. Never derive it from a URL parameter or user input.
- Report vulnerabilities privately, as described in
  [SECURITY.md](https://github.com/doolahq/doola-js/blob/main/SECURITY.md). Never in a public
  issue.

## Versioning

`@doola/js` follows semver, and the
[changelog](https://github.com/doolahq/doola-js/blob/main/packages/js/CHANGELOG.md) lists every
release. The loader at `js.doola.com/v1` updates in place and stays compatible with every
`@doola/js` release in that major, so fixes reach your site without an upgrade or a deploy.

## Links

- [Partner API documentation](https://docs.doola.com/api/introduction): authentication, companies
  and webhooks
- [Test environment and sandbox](https://docs.doola.com/api/sandbox-playground)
- [Support](https://github.com/doolahq/doola-js/blob/main/SUPPORT.md)
- [Source and issues](https://github.com/doolahq/doola-js)

## License

[MIT](https://github.com/doolahq/doola-js/blob/main/LICENSE)
