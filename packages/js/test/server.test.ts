import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { CustomerSession } from '../src/index';
import {
  createCustomerSession,
  createSessionHandler,
  type CustomerSessionResult,
  type DoolaCustomer,
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

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(MINTED));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function handler(getCustomer: () => DoolaCustomer | null = () => CUSTOMER, apiKey = LIVE_KEY) {
  return createSessionHandler({ apiKey, getCustomer });
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
  };
}

describe('createSessionHandler', () => {
  describe('apiKey', () => {
    it.each([
      ['missing', undefined, /apiKey is missing/],
      ['empty', '', /apiKey is missing/],
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

  it.each([400, 403, 404, 409, 429, 500, 503])(
    "passes doola's %i through without its body",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ payload: null, error: { code: 'E', message: 'doola says' } }, { status }),
      );

      const response = await call();

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
    },
  );

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
  ])('answers 502 when a 2xx carries %s', async (_, response) => {
    fetchMock.mockResolvedValue(response());

    const answer = await call();

    expect(answer.status).toBe(502);
    expect(await answer.text()).toBe('');
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
    ["doola's 401", 502, () => fetchMock.mockResolvedValue(new Response(null, { status: 401 }))],
    ["doola's 409", 409, () => fetchMock.mockResolvedValue(new Response(null, { status: 409 }))],
    ['a network failure', 502, () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
    ['a non-JSON body', 502, () => fetchMock.mockResolvedValue(new Response('nope'))],
  ])('maps %s to %i with no body', async (_, status, arrange) => {
    arrange();

    await expect(createCustomerSession({ apiKey: LIVE_KEY, customer: CUSTOMER })).resolves.toEqual({
      status,
      body: null,
    });
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
