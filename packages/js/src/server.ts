/**
 * The customer a session is minted for, as POST /v1/partner/customer-sessions
 * takes it. If no doola customer matches under your tenant, one is created, and
 * only then are the profile fields used.
 */
export interface DoolaCustomer {
  /**
   * Matched after `externalCustomerId`, and the new customer's email when none
   * matches. Send only an address your own auth has verified: doola resolves the
   * customer from it, and the session route answers with doola's code for it.
   */
  email: string;

  /**
   * Your own id for this customer, unique per tenant, up to 255 characters.
   * Optional but recommended: doola matches it before the email, so a customer
   * who changes their email with you stays the same doola customer.
   */
  externalCustomerId?: string | undefined;

  /** Used only when doola creates the customer. */
  firstName?: string | undefined;

  /** Used only when doola creates the customer. */
  lastName?: string | undefined;

  /** ISO 3166-1 alpha-3, such as `USA`. */
  countryOfResidence?: string | undefined;

  /** E.164, such as `+12125550100`. */
  phoneNumber?: string | undefined;
}

/**
 * What a customer session may reach, one scope per product: `sdk:formation`
 * for `create()`, `sdk:tax` for `create({ product: 'tax' })`. `sdk:tax` needs
 * the tax feature on your account; without it doola refuses the mint.
 */
export type DoolaScope = 'sdk:formation' | 'sdk:tax';

/**
 * A service the SDK sells on top of the formation, by its price name.
 * `EinCreation` is an EIN on its own. `VariantEinExpedited` is the extra on top
 * of a Standard EIN, the price of `variant: "Expedite"` on `EinCreation` in the
 * Partner API. EIN in the formation flow is part of the formation, so it needs
 * no price.
 */
export type DoolaPricedService = 'EinCreation' | 'VariantEinExpedited';

/**
 * Your prices for one session, shown in the SDK in place of the prices set in
 * the Partner Portal. If you send prices, they are the complete price list for
 * that customer: a service you leave out is not offered. If you send none, the
 * portal's prices apply. A list that prices nothing counts as none, so there
 * is no way to offer none of the priced services here: to offer none, turn
 * them off in the Partner Portal. doola never charges these: you do, on your
 * own page.
 *
 * The helpers send them as they are, every name in `pricesInCents` included,
 * and doola checks them: an unknown name or currency, or an amount that is
 * negative or not a whole number, is refused with a 400 `E_VALIDATION_FAILED`.
 */
export interface DoolaServicePrices {
  /**
   * The ISO 4217 code of the prices in `pricesInCents`, such as `USD`, `MXN`
   * or `CLP`. It applies to those prices only.
   */
  currency: string;

  /**
   * Per service, a whole number of at least 0 in the currency's ISO 4217
   * minor unit: 2 decimals for USD, so USD 149.00 is `14900`; none for CLP,
   * so CLP 140,000 is `140000`; 3 for KWD, so KWD 1.500 is `1500`. Empty
   * means no prices, so the portal's apply, and a name whose value is
   * `undefined` is left out.
   */
  pricesInCents: Readonly<Partial<Record<DoolaPricedService, number>>>;
}

/**
 * What the session route sends the browser: the status, and the JSON body when
 * there is one. `body` is set only with status 200, and carries exactly what
 * `fetchAccessToken` resolves with. A failure carries `code` instead, when
 * doola gave one.
 */
export interface CustomerSessionResult {
  /** The status for the session route: doola's own, except that its 401 becomes a 502. */
  status: number;

  /** Set only with status 200. Send it as JSON, with `Cache-Control: no-store`. */
  body: { accessToken: string; expiresIn: number } | null;

  /**
   * doola's error code on a 409, such as `E_EMAIL_IN_USE`, on the 403
   * `E_SCOPE_NOT_ENTITLED`, or on the 400 `E_VALIDATION_FAILED`. Send it as
   * the JSON body `{ code }` with `status`, so `fetchAccessToken` can reject
   * with it: the loader tells the 409s apart by this code, and stops retrying
   * a scope your account does not hold or a field doola refused. Only the
   * code: which field doola refused stays in `failure.doolaFields`.
   * Unlike `failure`, it is safe for the browser.
   */
  code?: string;

  /** Why `body` is null, for your logs. Never send it to the browser. */
  failure?: CustomerSessionFailure;
}

/**
 * Why a session could not be minted, for your logs. The browser sees the status,
 * and doola's code when the route forwards {@link CustomerSessionResult.code}, so
 * this is the one place a bad key, an outage or a rejected field shows up.
 */
export interface CustomerSessionFailure {
  /**
   * - `doola_unauthorized`: doola answered 401, so the key is wrong, revoked or
   *   for another environment. The route answers 502.
   * - `doola_error`: any other non-2xx from doola, passed through as is.
   * - `doola_unreachable`: the request failed, or timed out before a 2xx body
   *   had arrived. The route answers 502.
   * - `invalid_response`: a 2xx without a usable session. The route answers 502.
   */
  reason: 'doola_unauthorized' | 'doola_error' | 'doola_unreachable' | 'invalid_response';

  /** The status doola answered with, when it answered. */
  doolaStatus?: number;

  /** `error.code` from doola's error envelope, such as `E_VALIDATION_FAILED`. */
  doolaCode?: string;

  /**
   * `error.fields` from doola's error envelope, set only when doola sends it,
   * as on a 400 `E_VALIDATION_FAILED`: each refused field by its path, such as
   * `servicePrices.pricesInCents.EinExpedited`, with its own `code` when doola
   * gives one, and a `message`. For your logs only: never send it to the browser.
   */
  doolaFields?: Readonly<Record<string, { code?: string; message?: string }>>;
}

/** For {@link createCustomerSession}. */
export interface CustomerSessionOptions {
  /**
   * Your secret `dk_live_` or `dk_test_` key. Its prefix selects the API host.
   * Typed to accept `process.env` as is: a missing key, or a publishable `pk_`
   * key, is refused with an error that never contains the value.
   */
  apiKey: string | undefined;

  /** The signed-in customer, from your own auth. */
  customer: DoolaCustomer;

  /**
   * The products this session may mount. List every product the page
   * creates: one session serves every component, so a session without
   * `sdk:formation` makes a formation component refuse. Omitted, the field
   * is not sent and doola mints formation only.
   */
  scopes?: readonly DoolaScope[] | undefined;

  /**
   * This customer's prices, in place of the Partner Portal's for this
   * session. Omitted, the field is not sent and the portal's prices apply.
   * Send them on every call: each renewal is a new session, and one without
   * prices falls back to the portal's.
   */
  servicePrices?: DoolaServicePrices | undefined;
}

/** For {@link createSessionHandler}. */
export interface SessionHandlerOptions {
  /**
   * As in {@link CustomerSessionOptions.apiKey}. A key that is present but
   * invalid throws when the handler is created. A missing key is refused per
   * request instead, because `next build` evaluates route modules, often
   * without the secret set.
   */
  apiKey: string | undefined;

  /**
   * Your own auth. Return the signed-in customer, or null when nobody is
   * signed in: the route then answers 401, which the loader reports as
   * `partner_session_expired`.
   */
  getCustomer: (request: Request) => DoolaCustomer | null | Promise<DoolaCustomer | null>;

  /**
   * Called with the reason whenever a session could not be minted, for your
   * logs. Awaited before the route answers, so an error from it, sync or async,
   * rejects the request rather than going unhandled.
   */
  onFailure?: ((failure: CustomerSessionFailure) => void | Promise<void>) | undefined;

  /**
   * As in {@link CustomerSessionOptions.scopes}, for every request this route
   * serves. To offer tax to only some of your customers, call
   * {@link createCustomerSession} per request instead.
   */
  scopes?: readonly DoolaScope[] | undefined;

  /**
   * As in {@link CustomerSessionOptions.servicePrices}, sent for every
   * customer of this route: one price list kept in your code. They are read
   * once, when the handler is created, so a later change to the object is
   * not sent. For prices per customer, or prices that change while the route
   * runs, call {@link createCustomerSession} per request instead.
   */
  servicePrices?: DoolaServicePrices | undefined;
}

interface Credentials {
  apiKey: string;
  apiOrigin: string;
}

const API_ORIGINS: ReadonlyArray<readonly [prefix: string, origin: string]> = [
  ['dk_live_', 'https://api.doola.com'],
  ['dk_test_', 'https://api.test.doola.com'],
];

// Node's fetch waits up to 300s for headers, which would hold a serverless
// function open for minutes while doola is slow.
const MINT_TIMEOUT_MS = 10_000;

function credentials(apiKey: string | undefined): Credentials {
  if (!apiKey) {
    throw new Error(
      'doola: apiKey is missing. Pass your secret dk_live_ or dk_test_ key, from the partner ' +
        'portal under Settings, then API keys.',
    );
  }

  if (apiKey.startsWith('pk_')) {
    throw new Error(
      'doola: apiKey is a publishable pk_ key. The session route needs your secret dk_ key; ' +
        'the publishable key belongs in the browser, in loadDoola().',
    );
  }

  const match = API_ORIGINS.find(([prefix]) => apiKey.startsWith(prefix));

  if (!match) {
    throw new Error('doola: apiKey is not a doola secret key. Expected dk_live_ or dk_test_.');
  }

  return { apiKey, apiOrigin: match[1] };
}

// What a mint sends besides the customer. An undefined field is left out of
// the body.
interface SessionFields {
  scopes: readonly DoolaScope[] | undefined;
  servicePrices: DoolaServicePrices | undefined;
}

// The top level is picked like the customer, and pricesInCents is copied, so a
// handler keeps the prices it was created with. Its names and amounts pass as
// they are: doola refuses an unknown name, so a typo fails loudly instead of
// being dropped here and hiding a service.
function pickPrices(prices: DoolaServicePrices | undefined): DoolaServicePrices | undefined {
  if (!prices) return undefined;

  const { currency, pricesInCents } = prices;

  return { currency, pricesInCents: { ...pricesInCents } };
}

// Picked rather than spread: a user record passed as the customer must not
// forward the rest of its fields to doola.
function mintRequestBody(
  customer: DoolaCustomer,
  { scopes, servicePrices }: SessionFields,
): string {
  const { email, externalCustomerId, firstName, lastName, countryOfResidence, phoneNumber } =
    customer;

  return JSON.stringify({
    email,
    externalCustomerId,
    firstName,
    lastName,
    countryOfResidence,
    phoneNumber,
    scopes,
    servicePrices,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// doola wraps every response in { payload, error }. The payload also carries
// expiresAt, which the loader never reads, so it stays on the server.
async function readEnvelope(response: Response): Promise<Record<string, unknown>> {
  const envelope: unknown = await response.json().catch(() => null);

  return isRecord(envelope) ? envelope : {};
}

// The loader's parseSession rejects an empty token and a non-positive or
// non-finite expiresIn, so passing one on would fail in the browser instead of
// here, as a 502.
function sessionFrom({ payload }: Record<string, unknown>): CustomerSessionResult['body'] {
  if (
    !isRecord(payload) ||
    typeof payload.accessToken !== 'string' ||
    payload.accessToken === '' ||
    typeof payload.expiresIn !== 'number' ||
    !Number.isFinite(payload.expiresIn) ||
    payload.expiresIn <= 0
  ) {
    return null;
  }

  return { accessToken: payload.accessToken, expiresIn: payload.expiresIn };
}

function doolaCodeFrom({ error }: Record<string, unknown>): { doolaCode?: string } {
  return isRecord(error) && typeof error.code === 'string' ? { doolaCode: error.code } : {};
}

// Only code and message, and only when they are strings, so the partner's log
// gets doola's documented field error and nothing else the envelope may carry.
function doolaFieldsFrom({
  error,
}: Record<string, unknown>): Pick<CustomerSessionFailure, 'doolaFields'> {
  if (!isRecord(error) || !isRecord(error.fields)) return {};

  const doolaFields: Record<string, { code?: string; message?: string }> = {};

  for (const [field, value] of Object.entries(error.fields)) {
    if (!isRecord(value)) continue;

    const { code, message } = value;
    doolaFields[field] = {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    };
  }

  return { doolaFields };
}

function failed(status: number, failure: CustomerSessionFailure): CustomerSessionResult {
  return { status, body: null, failure };
}

const SCOPE_NOT_ENTITLED = 'E_SCOPE_NOT_ENTITLED';
const VALIDATION_FAILED = 'E_VALIDATION_FAILED';

// A 409 is about the customer, and the scope 403 and the validation 400 decide
// whether the founder may retry. Every other code (the 401 and other 403s about
// the key or tenant, other 400s about the request) is the partner's to log. The
// code alone, never doola's message or fields, which may name what was sent.
function refused(status: number, failure: CustomerSessionFailure): CustomerSessionResult {
  const { doolaCode } = failure;
  const forwarded =
    status === 409 ||
    (status === 403 && doolaCode === SCOPE_NOT_ENTITLED) ||
    (status === 400 && doolaCode === VALIDATION_FAILED);

  return forwarded && doolaCode
    ? { ...failed(status, failure), code: doolaCode }
    : failed(status, failure);
}

async function mint(
  { apiKey, apiOrigin }: Credentials,
  customer: DoolaCustomer,
  fields: SessionFields,
): Promise<CustomerSessionResult> {
  // Outside the try: prices JSON cannot encode, such as a bigint, are a bug in
  // the caller, not doola being unreachable, and no request was sent.
  const body = mintRequestBody(customer, fields);
  const signal = AbortSignal.timeout(MINT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${apiOrigin}/v1/partner/customer-sessions`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body,
      signal,
    });
  } catch {
    return failed(502, { reason: 'doola_unreachable' });
  }

  // Reading the body also returns undici's socket to the pool, which an unread
  // body blocks until GC.
  const envelope = await readEnvelope(response);
  const doolaStatus = response.status;

  if (!response.ok) {
    const detail = { doolaStatus, ...doolaCodeFrom(envelope), ...doolaFieldsFrom(envelope) };

    // doola's 401 means the key or tenant is wrong, not the customer's session.
    // The loader reads any 401 as partner_session_expired, so passing it on would
    // send a signed-in customer to the partner's login, on every renewal.
    if (doolaStatus === 401) return failed(502, { reason: 'doola_unauthorized', ...detail });

    // Every other status passes through, a 409 with doola's code so the loader
    // can tell them apart, and a status doola adds later needs no change here.
    return refused(doolaStatus, { reason: 'doola_error', ...detail });
  }

  const session = sessionFrom(envelope);

  if (session) return { status: 200, body: session };

  // The timeout also covers the body, and readEnvelope swallows the abort, so a
  // session cut off mid-body is doola being slow, not doola sending garbage.
  const reason = signal.aborted ? 'doola_unreachable' : 'invalid_response';

  return failed(502, { reason, doolaStatus });
}

// RFC 6749 section 5.1: a response carrying a token must not be cached.
function respond({ status, body, code }: CustomerSessionResult): Response {
  const json = body ?? (code ? { code } : null);

  if (!json) return new Response(null, { status, headers: { 'cache-control': 'no-store' } });

  return new Response(JSON.stringify(json), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Mints a session for one customer and returns what the session route should
 * send, for Express, Fastify or your own routing. Send `status`, with `body` as
 * JSON when it is not null, or `{ code }` as JSON when `code` is set.
 * {@link createSessionHandler} does this for a web-standard route.
 *
 * Never rejects for a doola or network failure: those resolve to a status, with
 * `failure` saying why. It rejects only for a missing or invalid `apiKey`, which
 * is checked on every call, and for prices JSON cannot encode, such as a
 * bigint, so let your framework's error handling see it.
 */
export async function createCustomerSession(
  options: CustomerSessionOptions,
): Promise<CustomerSessionResult> {
  const { apiKey, customer, scopes, servicePrices } = options;

  return mint(credentials(apiKey), customer, {
    scopes,
    servicePrices: pickPrices(servicePrices),
  });
}

/**
 * Builds the session route for any runtime with the web-standard `Request`
 * and `Response`: Next.js route handlers, Remix, Hono, Bun, Deno, Cloudflare
 * Workers and Node 18 or later. Throws at once for a key that is present but
 * invalid, such as a publishable `pk_` key.
 *
 * A missing key, prices JSON cannot encode, and an error from `getCustomer` or
 * `onFailure`, reject the request, to your framework's own error handling.
 */
export function createSessionHandler(
  options: SessionHandlerOptions,
): (request: Request) => Promise<Response> {
  const { apiKey, getCustomer, onFailure } = options;
  const fields: SessionFields = {
    scopes: options.scopes && [...options.scopes],
    servicePrices: pickPrices(options.servicePrices),
  };
  const checked = apiKey ? credentials(apiKey) : undefined;

  return async (request) => {
    const resolved = checked ?? credentials(apiKey);
    const customer = await getCustomer(request);

    if (!customer) return respond({ status: 401, body: null });

    const result = await mint(resolved, customer, fields);

    if (result.failure) await onFailure?.(result.failure);

    return respond(result);
  };
}
