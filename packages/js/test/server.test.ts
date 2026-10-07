import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { CustomerSession } from '../src/index';
import {
  createCustomerSession,
  createSessionHandler,
  type CustomerSessionResult,
  type DoolaCustomer,
  type SessionHandlerOptions,
} from '../src/server';

const LIVE_KEY = 'dk_live_s3cr3tv4lu3';
const TEST_KEY = 'dk_test_s3cr3tv4lu3';
const CUSTOMER: DoolaCustomer = { email: 'founder@example.com', externalCustomerId: 'usr_1' };

// The shape doola-data's ApiResponseAdvice writes around CustomerSessionDto.
const MINTED = {
  payload: { accessToken: 'cs_live_abc', expiresAt: '2026-09-25T10:10:00Z', expiresIn: 600 },
  error: null,
};

const fetchMock = vi.fn<typeof fetch>();

function doolaError(status: number, code = 'E'): Response {
  return Response.json({ payload: null, error: { code, message: 'doola says' } }, { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(MINTED));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function handler(
  getCustomer: () => DoolaCustomer | null = () => CUSTOMER,
  apiKey: string | undefined = LIVE_KEY,
  onFailure?: SessionHandlerOptions['onFailure'],
) {
  return createSessionHandler({ apiKey, getCustomer, onFailure });
}

function call(route = handler()) {
  return route(new Request('https://partner.example/doola-session', { method: 'POST' }));
}

function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url,
    method: init?.method,
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as unknown,
    signal: init?.signal,
  };
}

describe('createSessionHandler', () => {
  describe('apiKey', () => {
    it.each([
      ['a live publishable key', 'pk_live_s3cr3tv4lu3', /publishable pk_ key/],
      ['a test publishable key', 'pk_test_s3cr3tv4lu3', /publishable pk_ key/],
      ['not a doola key', 'sk_live_s3cr3tv4lu3', /Expected dk_live_ or dk_test_/],
      ['a dk_ key for no environment', 'dk_prod_s3cr3tv4lu3', /Expected dk_live_ or dk_test_/],
    ])('is refused at construction when %s, without echoing it', (_, apiKey, message) => {
      const create = () => createSessionHandler({ apiKey, getCustomer: () => CUSTOMER });

      expect(create).toThrow(message);
      expect(create).not.toThrow(/s3cr3tv4lu3/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // `next build` evaluates route modules, often without the secret set.
    it.each([undefined, ''])(
      'is refused per request, not at construction, when %j',
      async (apiKey) => {
        const route = createSessionHandler({ apiKey, getCustomer: () => CUSTOMER });

        await expect(call(route)).rejects.toThrow(/apiKey is missing/);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('selects the API host from the key prefix', async () => {
      await call(handler(undefined, LIVE_KEY));
      await call(handler(undefined, TEST_KEY));

      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://api.doola.com/v1/partner/customer-sessions',
        'https://api.test.doola.com/v1/partner/customer-sessions',
      ]);
    });

    it('is sent as the raw Authorization header, and never logged or returned', async () => {
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );

      const responses = [];
      for (const doola of [Response.json(MINTED), new Response(null, { status: 401 })]) {
        fetchMock.mockResolvedValue(doola);
        responses.push(await (await call()).text());
      }

      expect(sentRequest().headers.get('authorization')).toBe(LIVE_KEY);
      expect(responses.join()).not.toContain('s3cr3tv4lu3');
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    });
  });

  it('answers 401 without calling doola when nobody is signed in', async () => {
    const response = await call(handler(() => null));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the request to getCustomer and awaits it', async () => {
    const getCustomer = vi.fn(async (_: Request) => CUSTOMER);
    const request = new Request('https://partner.example/doola-session', { method: 'POST' });

    const response = await createSessionHandler({ apiKey: LIVE_KEY, getCustomer })(request);

    expect(getCustomer).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it('POSTs the customer as JSON', async () => {
    await call();

    const sent = sentRequest();
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.body).toEqual({ email: 'founder@example.com', externalCustomerId: 'usr_1' });
  });

  it('forwards the optional profile fields and nothing else from the customer', async () => {
    const profile = {
      email: 'founder@example.com',
      externalCustomerId: 'usr_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      countryOfResidence: 'USA',
      phoneNumber: '+12125550100',
    };
    const user = { ...profile, passwordHash: 'x', role: 'admin' };

    await call(handler(() => user));

    expect(sentRequest().body).toEqual(profile);
  });

  it('unwraps the envelope and forwards only accessToken and expiresIn', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...MINTED, payload: { ...MINTED.payload, customerId: 'c_1' }, extra: 1 }),
    );

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toStrictEqual({ accessToken: 'cs_live_abc', expiresIn: 600 });
  });

  it.each([
    ['a session', () => Response.json(MINTED)],
    ['a failure', () => new Response(null, { status: 401 })],
  ])('marks %s no-store, as RFC 6749 requires of token responses', async (_, doola) => {
    fetchMock.mockResolvedValue(doola());

    expect((await call()).headers.get('cache-control')).toBe('no-store');
  });

  it('gives up on doola after 10 seconds, as a 502', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    expect((await call()).status).toBe(502);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(sentRequest().signal).toBe(timeout.mock.results[0]?.value);
  });

  it("rewrites doola's 401 to a 502, so the loader never reads it as partner_session_expired", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { payload: null, error: { code: 'E_AUTH_INVALID', message: 'authorization is invalid' } },
        { status: 401 },
      ),
    );

    const response = await call();

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
  });

  it.each([400, 403, 404, 429, 500, 503])(
    "passes doola's %i through without its body",
    async (status) => {
      fetchMock.mockResolvedValue(doolaError(status, 'E_TENANT_SUSPENDED'));

      const response = await call();

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
    },
  );

  it("passes doola's 409 through with its code and nothing else from its body", async () => {
    fetchMock.mockResolvedValue(doolaError(409, 'E_EMAIL_IN_USE'));

    const response = await call();

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'E_EMAIL_IN_USE' });
  });

  it.each([
    ['without an error code', { payload: null, error: { message: 'doola says' } }],
    ['with a non-string error code', { payload: null, error: { code: 42 } }],
    ['without an envelope', { message: 'doola says' }],
  ])("passes doola's error through with no body when it comes %s", async (_, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status: 409 }));

    const response = await call();

    expect(response.status).toBe(409);
    expect(await response.text()).toBe('');
  });

  it('answers 502 when doola cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    expect((await call()).status).toBe(502);
  });

  it.each([
    ['not JSON', () => new Response('<html>Bad gateway</html>', { status: 200 })],
    ['an empty body', () => new Response(null, { status: 200 })],
    ['JSON without a payload', () => Response.json({ accessToken: 'cs_live_abc', expiresIn: 600 })],
    ['a null payload', () => Response.json({ payload: null, error: null })],
    [
      'a payload without accessToken',
      () => Response.json({ payload: { expiresIn: 600 }, error: null }),
    ],
    [
      'a payload with a string expiresIn',
      () => Response.json({ payload: { accessToken: 'cs_live_abc', expiresIn: '600' } }),
    ],
    ['an empty accessToken', () => Response.json({ payload: { accessToken: '', expiresIn: 600 } })],
    [
      'a zero expiresIn',
      () => Response.json({ payload: { accessToken: 'cs_live_abc', expiresIn: 0 } }),
    ],
    [
      'a negative expiresIn',
      () => Response.json({ payload: { accessToken: 'cs_live_abc', expiresIn: -5 } }),
    ],
  ])('answers 502 when a 2xx carries %s', async (_, response) => {
    fetchMock.mockResolvedValue(response());

    const answer = await call();

    expect(answer.status).toBe(502);
    expect(await answer.text()).toBe('');
  });

  it.each([
    [
      "doola's 401",
      () => fetchMock.mockResolvedValue(doolaError(401, 'E_AUTH_INVALID')),
      { reason: 'doola_unauthorized', doolaStatus: 401, doolaCode: 'E_AUTH_INVALID' },
      '',
    ],
    [
      "doola's 400",
      () => fetchMock.mockResolvedValue(doolaError(400, 'E_VALIDATION_FAILED')),
      { reason: 'doola_error', doolaStatus: 400, doolaCode: 'E_VALIDATION_FAILED' },
      '',
    ],
    [
      "doola's 409",
      () => fetchMock.mockResolvedValue(doolaError(409, 'E_RESOURCE_CONFLICT')),
      { reason: 'doola_error', doolaStatus: 409, doolaCode: 'E_RESOURCE_CONFLICT' },
      '{"code":"E_RESOURCE_CONFLICT"}',
    ],
    [
      'an error without an envelope',
      () => fetchMock.mockResolvedValue(new Response('<html>', { status: 503 })),
      { reason: 'doola_error', doolaStatus: 503 },
      '',
    ],
    [
      'a network failure',
      () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
      { reason: 'doola_unreachable' },
      '',
    ],
    [
      'a malformed 200',
      () => fetchMock.mockResolvedValue(Response.json({ payload: null })),
      { reason: 'invalid_response', doolaStatus: 200 },
      '',
    ],
  ])(
    'tells onFailure about %s, and the browser only the status, and the code of a 409',
    async (_, arrange, failure, browserBody) => {
      arrange();
      const onFailure = vi.fn();

      const response = await call(handler(undefined, LIVE_KEY, onFailure));

      expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(await response.text()).toBe(browserBody);
    },
  );

  it('does not call onFailure for a session, or for a customer who is signed out', async () => {
    const onFailure = vi.fn();

    await call(handler(undefined, LIVE_KEY, onFailure));
    await call(handler(() => null, LIVE_KEY, onFailure));

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('rejects the request when an async onFailure rejects, rather than leaving it unhandled', async () => {
    fetchMock.mockResolvedValue(doolaError(401));

    const route = handler(undefined, LIVE_KEY, async () => {
      throw new Error('log sink down');
    });

    await expect(call(route)).rejects.toThrow('log sink down');
  });

  it('answers only once an async onFailure has settled', async () => {
    fetchMock.mockResolvedValue(doolaError(401));
    const order: string[] = [];

    const route = handler(undefined, LIVE_KEY, async () => {
      await new Promise((resolve) => setTimeout(resolve));
      order.push('onFailure');
    });

    await call(route).then(() => order.push('response'));

    expect(order).toEqual(['onFailure', 'response']);
  });

  it('reports a 2xx body cut off by the timeout as doola_unreachable, not invalid_response', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    fetchMock.mockImplementation(async (_, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"payload":'));
          init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
        },
      });
      setTimeout(() => timeout.abort(new DOMException('timed out', 'TimeoutError')));

      return new Response(body, { status: 200 });
    });
    const onFailure = vi.fn();

    const response = await call(handler(undefined, LIVE_KEY, onFailure));

    expect(response.status).toBe(502);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith({
      reason: 'doola_unreachable',
      doolaStatus: 200,
    });
  });

  it('lets a failure in getCustomer propagate to the framework', async () => {
    const route = handler(() => {
      throw new Error('auth backend down');
    });

    await expect(call(route)).rejects.toThrow('auth backend down');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createCustomerSession', () => {
  it('resolves to the status and unwrapped body', async () => {
    await expect(createCustomerSession({ apiKey: TEST_KEY, customer: CUSTOMER })).resolves.toEqual({
      status: 200,
      body: { accessToken: 'cs_live_abc', expiresIn: 600 },
    });
    expect(sentRequest().url).toBe('https://api.test.doola.com/v1/partner/customer-sessions');
  });

  it.each([
    ["doola's 401", 502, 'doola_unauthorized', () => fetchMock.mockResolvedValue(doolaError(401))],
    ["doola's 409", 409, 'doola_error', () => fetchMock.mockResolvedValue(doolaError(409))],
    [
      'a network failure',
      502,
      'doola_unreachable',
      () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
    ],
    [
      'a non-JSON body',
      502,
      'invalid_response',
      () => fetchMock.mockResolvedValue(new Response('nope')),
    ],
  ])('maps %s to %i with no body', async (_, status, reason, arrange) => {
    arrange();

    await expect(
      createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER }),
    ).resolves.toMatchObject({ status, body: null, failure: { reason } });
  });

  it("carries doola's code on a refusal, for the browser", async () => {
    fetchMock.mockResolvedValue(doolaError(409, 'E_CUSTOMER_REVOKED'));

    await expect(
      createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER }),
    ).resolves.toMatchObject({ status: 409, body: null, code: 'E_CUSTOMER_REVOKED' });
  });

  it("never carries the code of doola's 401, which is about the key", async () => {
    fetchMock.mockResolvedValue(doolaError(401, 'E_AUTH_INVALID'));

    const result = await createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER });

    expect(result.status).toBe(502);
    expect(result).not.toHaveProperty('code');
  });

  it('returns a new result for every failure, so one caller cannot change the next', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const first = await createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER });
    first.status = 503;
    const second = await createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER });

    expect(second).not.toBe(first);
    expect(second.status).toBe(502);
  });

  it.each([undefined, ''])('rejects a missing apiKey, %j', async (apiKey) => {
    await expect(createCustomerSession({ apiKey, customer: CUSTOMER })).rejects.toThrow(
      /apiKey is missing/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid apiKey without echoing it', async () => {
    const result = createCustomerSession({ apiKey: 'pk_live_s3cr3tv4lu3', customer: CUSTOMER });

    await expect(result).rejects.toThrow(/publishable pk_ key/);
    await expect(result).rejects.not.toThrow(/s3cr3tv4lu3/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves with a body that fetchAccessToken can return as is', () => {
    expectTypeOf<NonNullable<CustomerSessionResult['body']>>().toExtend<CustomerSession>();
  });
});
