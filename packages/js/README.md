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

**Full documentation: [docs.doola.com/sdk](https://docs.doola.com/sdk/overview).** This page is
the short version: install, the three steps, and where to read more.

## How it fits together

1. **Your server** mints a short-lived session for the signed-in customer, using your secret key.
2. **Your page** calls `loadDoola()` and appends the element it creates. The customer completes
   the formation wizard inside the iframe.
3. **On submit** you get `onFormed({ companyId })`. You take payment in your own checkout, and your
   server confirms it to doola. Nothing is filed and nothing is spent until you do.

## Before you start

You need two keys. The publishable key selects the environment for the browser, and the secret
key does the same on your server.

| Key         | Prefix                   | Where it lives                                  | How to get it                                                                                                                      |
| ----------- | ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Publishable | `pk_test_` or `pk_live_` | Your frontend. Public by design.                | [Partner portal](https://partners-portal.doola.com), under **SDK**, then **Install**. It identifies you and selects your branding. |
| Secret      | `dk_test_` or `dk_live_` | Your server only. Never in a browser or bundle. | [Partner portal](https://partners-portal.doola.com), under **Settings**, then **API Keys**.                                        |

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
  // Your dk_ secret key. Its prefix selects the API host. A missing key is refused per
  // request, so `next build` passes without it, and a pk_ key throws here.
  apiKey: process.env.DOOLA_API_KEY,

  // Return null when nobody is signed in. The route answers 401, and the loader reports
  // partner_session_expired.
  getCustomer: async (request) => {
    const user = await getSignedInUser(request); // your own auth
    // externalCustomerId is optional but recommended: it is matched before the email, so a
    // customer who changes their email with you stays the same doola customer.
    return user ? { email: user.email, externalCustomerId: user.id } : null;
  },

  // The browser only gets the status. This says why: a revoked key, an outage, or a field
  // doola rejected, with doola's error code.
  onFailure: (failure) => console.error('doola session failed', failure),
});
```

The token acts as that one customer and expires in minutes. The loader calls your route again to
renew it, so a doola session never outlives your own login. Protect the route like any other
authenticated `POST`, including your CSRF protection.

Express, Fastify and other languages: [Create sessions](https://docs.doola.com/sdk/sessions).

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
const element = doola.create();
document.getElementById('doola')!.append(element);
```

`create()` takes no arguments. The app decides what to show from the customer's state: the wizard
for a new customer, their company once one exists.

Keep one instance per page: options are fixed by the first `loadDoola()` call. Frameworks,
sign-out and the full-screen mode on phones: [Embed the SDK](https://docs.doola.com/sdk/embed).

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

<!-- example: confirm-payment -->

```ts
// On your server, after the charge succeeds.
const DOOLA_API = 'https://api.doola.com'; // https://api.test.doola.com with a dk_test_ key

function doolaKey(): string {
  const key = process.env.DOOLA_API_KEY; // your dk_ secret key
  if (!key) throw new Error('DOOLA_API_KEY is not set');

  return key;
}

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
formation and asks to pay. Key your orders by `companyId` so you never charge twice.

After you confirm, replace the element you mounted in step 2: `element.replaceWith(doola.create())`.
Its payment screen does not watch for your confirmation, so only a new element shows the founder
their company. Each `create()` is a separate iframe, so never append a second one beside the old.
From then on, the Partner API's [webhooks](https://docs.doola.com/api/webhooks) tell you how the
formation is going.

Edge cases, refunds and reconciliation: [Take payment](https://docs.doola.com/sdk/payments).

## Documentation

| Read                                                            | For                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| [Quickstart](https://docs.doola.com/sdk/quickstart)             | A working embed and a test payment in about 15 minutes   |
| [How it works](https://docs.doola.com/sdk/how-it-works)         | Keys, sessions and the formation lifecycle               |
| [Take payment](https://docs.doola.com/sdk/payments)             | Your checkout, the confirmation call and every edge case |
| [Client reference](https://docs.doola.com/sdk/reference/client) | Every option, method and callback                        |
| [Server reference](https://docs.doola.com/sdk/reference/server) | `@doola/js/server` and the Partner API endpoints you use |
| [Errors](https://docs.doola.com/sdk/reference/errors)           | `onAuthError`, `onLoadError` and what to do about each   |
| [Security and data](https://docs.doola.com/sdk/security)        | Content Security Policy, Trusted Types and data flows    |
| [Testing](https://docs.doola.com/sdk/testing)                   | The test environment and the sandbox playground          |
| [Go-live checklist](https://docs.doola.com/sdk/go-live)         | Everything to check before live keys                     |
| [Partner API](https://docs.doola.com/api/introduction)          | Webhooks, documents and required actions after payment   |

## Versioning

`@doola/js` follows semver, and the
[changelog](https://github.com/doolahq/doola-js/blob/main/packages/js/CHANGELOG.md) lists every
release. The loader at `js.doola.com/v1` updates in place and stays compatible with every
`@doola/js` release in that major, so fixes reach your site without an upgrade or a deploy.

## Support and security

- Questions: [engineering@doola.com](mailto:engineering@doola.com), or see
  [SUPPORT.md](https://github.com/doolahq/doola-js/blob/main/SUPPORT.md).
- Report vulnerabilities privately, as described in
  [SECURITY.md](https://github.com/doolahq/doola-js/blob/main/SECURITY.md). Never in a public
  issue.

## License

[MIT](https://github.com/doolahq/doola-js/blob/main/LICENSE)
