/**
 * The customer a session is minted for, as POST /v1/partner/customer-sessions
 * takes it. If no doola customer matches under your tenant, one is created, and
 * only then are the profile fields used.
 */
export interface DoolaCustomer {
  /** Matched after `externalCustomerId`, and the new customer's email when none matches. */
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
 * What the session route sends the browser: the status, and the JSON body when
 * there is one. `body` is set only with status 200, and carries exactly what
 * `fetchAccessToken` resolves with.
 */
export interface CustomerSessionResult {
  /** The status for the session route: doola's own, except that its 401 becomes a 502. */
  status: number;

  /** Set only with status 200. Send it as JSON, with `Cache-Control: no-store`. */
  body: { accessToken: string; expiresIn: number } | null;

  /** Why `body` is null, for your logs. Never send it to the browser. */
  failure?: CustomerSessionFailure;
}

/**
 * Why a session could not be minted. The browser only ever sees the status, so
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

// Picked rather than spread: a user record passed as the customer must not
// forward the rest of its fields to doola.
function mintRequestBody(customer: DoolaCustomer): string {
  const { email, externalCustomerId, firstName, lastName, countryOfResidence, phoneNumber } =
    customer;

  return JSON.stringify({
    email,
    externalCustomerId,
    firstName,
    lastName,
    countryOfResidence,
    phoneNumber,
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

function failed(status: number, failure: CustomerSessionFailure): CustomerSessionResult {
  return { status, body: null, failure };
}

async function mint(
  { apiKey, apiOrigin }: Credentials,
  customer: DoolaCustomer,
): Promise<CustomerSessionResult> {
  const signal = AbortSignal.timeout(MINT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${apiOrigin}/v1/partner/customer-sessions`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: mintRequestBody(customer),
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
    const detail = { doolaStatus, ...doolaCodeFrom(envelope) };

    // doola's 401 means the key or tenant is wrong, not the customer's session.
    // The loader reads any 401 as partner_session_expired, so passing it on would
    // send a signed-in customer to the partner's login, on every renewal.
    if (doolaStatus === 401) return failed(502, { reason: 'doola_unauthorized', ...detail });

    // Every other status passes through, so doola's 409 reaches the loader as
    // email_in_use, and a status doola adds later needs no change here.
    return failed(doolaStatus, { reason: 'doola_error', ...detail });
  }

  const body = sessionFrom(envelope);

  if (body) return { status: 200, body };

  // The timeout also covers the body, and readEnvelope swallows the abort, so a
  // session cut off mid-body is doola being slow, not doola sending garbage.
  const reason = signal.aborted ? 'doola_unreachable' : 'invalid_response';

  return failed(502, { reason, doolaStatus });
}

// RFC 6749 section 5.1: a response carrying a token must not be cached.
function respond(status: number, body: CustomerSessionResult['body']): Response {
  if (!body) return new Response(null, { status, headers: { 'cache-control': 'no-store' } });

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Mints a session for one customer and returns what the session route should
 * send, for Express, Fastify or your own routing. Send `status`, with `body` as
 * JSON when it is not null. {@link createSessionHandler} does this for a
 * web-standard route.
 *
 * Never rejects for a doola or network failure: those resolve to a status, with
 * `failure` saying why. It rejects only for a missing or invalid `apiKey`, which
 * is checked on every call, so let your framework's error handling see it.
 */
export async function createCustomerSession(
  options: CustomerSessionOptions,
): Promise<CustomerSessionResult> {
  return mint(credentials(options.apiKey), options.customer);
}

/**
 * Builds the session route for any runtime with the web-standard `Request`
 * and `Response`: Next.js route handlers, Remix, Hono, Bun, Deno, Cloudflare
 * Workers and Node 18 or later. Throws at once for a key that is present but
 * invalid, such as a publishable `pk_` key.
 *
 * A missing key, and an error from `getCustomer` or `onFailure`, reject the
 * request, to your framework's own error handling.
 */
export function createSessionHandler(
  options: SessionHandlerOptions,
): (request: Request) => Promise<Response> {
  const { apiKey, getCustomer, onFailure } = options;
  const checked = apiKey ? credentials(apiKey) : undefined;

  return async (request) => {
    const resolved = checked ?? credentials(apiKey);
    const customer = await getCustomer(request);

    if (!customer) return respond(401, null);

    const { status, body, failure } = await mint(resolved, customer);

    if (failure) await onFailure?.(failure);

    return respond(status, body);
  };
}
