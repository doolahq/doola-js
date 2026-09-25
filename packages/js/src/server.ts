/**
 * The customer a session is minted for, as POST /v1/partner/customer-sessions
 * takes it. If no doola customer matches under your tenant, one is created, and
 * only then are the profile fields used.
 */
export interface DoolaCustomer {
  email: string;

  /**
   * Your own id for this customer, unique per tenant, up to 255 characters.
   * Optional but recommended: doola matches it before the email, so a customer
   * who changes their email with you stays the same doola customer.
   */
  externalCustomerId?: string | undefined;

  firstName?: string | undefined;

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
  status: number;
  body: { accessToken: string; expiresIn: number } | null;
}

export interface CustomerSessionOptions {
  /**
   * Your secret `dk_live_` or `dk_test_` key. Its prefix selects the API host.
   * Typed to accept `process.env` as is: a missing key, or a publishable `pk_`
   * key, is refused with an error that never contains the value.
   */
  apiKey: string | undefined;

  customer: DoolaCustomer;
}

export interface SessionHandlerOptions {
  /** As in {@link CustomerSessionOptions.apiKey}, and checked when the handler is created. */
  apiKey: string | undefined;

  /**
   * Your own auth. Return the signed-in customer, or null when nobody is
   * signed in: the route then answers 401, which the loader reports as
   * `partner_session_expired`.
   */
  getCustomer: (request: Request) => DoolaCustomer | null | Promise<DoolaCustomer | null>;
}

interface Credentials {
  apiKey: string;
  apiOrigin: string;
}

const API_ORIGINS: ReadonlyArray<readonly [prefix: string, origin: string]> = [
  ['dk_live_', 'https://api.doola.com'],
  ['dk_test_', 'https://api.test.doola.com'],
];

const BAD_GATEWAY: CustomerSessionResult = { status: 502, body: null };

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
async function readSession(response: Response): Promise<CustomerSessionResult['body']> {
  const envelope: unknown = await response.json().catch(() => null);
  const payload = isRecord(envelope) ? envelope.payload : undefined;

  if (
    !isRecord(payload) ||
    typeof payload.accessToken !== 'string' ||
    typeof payload.expiresIn !== 'number'
  ) {
    return null;
  }

  return { accessToken: payload.accessToken, expiresIn: payload.expiresIn };
}

async function mint(
  { apiKey, apiOrigin }: Credentials,
  customer: DoolaCustomer,
): Promise<CustomerSessionResult> {
  let response: Response;

  try {
    response = await fetch(`${apiOrigin}/v1/partner/customer-sessions`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: mintRequestBody(customer),
    });
  } catch {
    return BAD_GATEWAY;
  }

  if (!response.ok) {
    // An unread body keeps undici's socket out of the pool until GC.
    await response.body?.cancel();

    // doola's 401 means the key or tenant is wrong, not the customer's session.
    // The loader reads any 401 as partner_session_expired, so passing it on would
    // send a signed-in customer to the partner's login, on every renewal.
    if (response.status === 401) return BAD_GATEWAY;

    // Every other status passes through, so doola's 409 reaches the loader as
    // email_in_use, and a status doola adds later needs no change here.
    return { status: response.status, body: null };
  }

  const body = await readSession(response);

  return body ? { status: 200, body } : BAD_GATEWAY;
}

/**
 * Mints a session for one customer and returns what the session route should
 * send, for Express, Fastify or your own routing. Send `status`, with `body` as
 * JSON when it is not null. {@link createSessionHandler} does this for a
 * web-standard route.
 *
 * Never rejects for a doola or network failure: those resolve to a status. It
 * rejects only for an invalid `apiKey`, which is checked on every call.
 */
export async function createCustomerSession(
  options: CustomerSessionOptions,
): Promise<CustomerSessionResult> {
  return mint(credentials(options.apiKey), options.customer);
}

/**
 * Builds the session route for any runtime with the web-standard `Request`
 * and `Response`: Next.js route handlers, Remix, Hono, Bun, Deno, Cloudflare
 * Workers and Node 18 or later. Throws at once for an invalid `apiKey`, so a
 * misconfigured deploy fails on start rather than on a customer's first visit.
 *
 * A rejection from `getCustomer` propagates, to your framework's own error
 * handling.
 */
export function createSessionHandler(
  options: SessionHandlerOptions,
): (request: Request) => Promise<Response> {
  const { getCustomer } = options;
  const resolved = credentials(options.apiKey);

  return async (request) => {
    const customer = await getCustomer(request);

    if (!customer) return new Response(null, { status: 401 });

    const { status, body } = await mint(resolved, customer);

    if (!body) return new Response(null, { status });

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
