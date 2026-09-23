import type { Doola, loadDoola } from '@doola/js';
import { expect, test, type Page, type Route } from '@playwright/test';

import { navigatedFrame, startHarness, type Harness } from './harness';

let harness: Harness;

test.beforeAll(async () => {
  harness = await startHarness();
});

test.afterAll(async () => {
  await harness.close();
});

const LOADER_URL = 'https://js.doola.com/v1/doola.js';
const CSP_HINT = `Failed to load ${LOADER_URL}. Check your CSP allows script-src js.doola.com.`;

type Loaded = { loaded: true } | { loaded: false; message: string };

/** The shim page's globals: `__doola` from the harness page, the rest set by these tests. */
interface ShimWindow extends Window {
  __doola: { loadDoola: typeof loadDoola };
  __instance: Doola;
  __adoptedKey: string;
}

/** What js.doola.com serves in production: the built loader, readable from any origin. */
function edge(route: Route, headers = { 'access-control-allow-origin': '*' }): Promise<void> {
  return route.fulfill({ contentType: 'text/javascript', headers, body: harness.loaderBundle });
}

async function openShimPage(page: Page): Promise<void> {
  await page.goto(`${harness.partnerOrigin}/shim`);
}

function load(page: Page): Promise<Loaded> {
  return page.evaluate(async (sdkOrigin): Promise<Loaded> => {
    const w = window as unknown as ShimWindow;

    try {
      w.__instance = await w.__doola.loadDoola({
        publishableKey: 'pk_test_harness',
        origin: sdkOrigin,
        fetchAccessToken: () => Promise.resolve({ accessToken: 'cs_harness', expiresIn: 3600 }),
        onAuthError: () => {},
        onFormed: () => {},
      });

      return { loaded: true };
    } catch (error) {
      return { loaded: false, message: (error as Error).message };
    }
  }, harness.sdkOrigin);
}

function loaderTags(page: Page): Promise<{ async: boolean; crossOrigin: string | null }[]> {
  return page.evaluate(
    (src) =>
      [...document.querySelectorAll<HTMLScriptElement>(`script[src="${src}"]`)].map((script) => ({
        // The property is true for every injected script; only the attribute
        // says the shim asked for it.
        async: script.hasAttribute('async'),
        crossOrigin: script.crossOrigin,
      })),
    LOADER_URL,
  );
}

test('injects one async, anonymous-CORS tag, however many calls race it', async ({ page }) => {
  await page.route(LOADER_URL, (route) => edge(route));
  await openShimPage(page);

  // Concurrent, because that is what React StrictMode's double effect does:
  // neither call can see window.Doola yet, so only the shared promise stops a
  // second tag.
  const [first, second] = await Promise.all([load(page), load(page)]);
  expect([first, second]).toEqual([{ loaded: true }, { loaded: true }]);
  expect(await load(page)).toEqual({ loaded: true });

  expect(await loaderTags(page)).toEqual([{ async: true, crossOrigin: 'anonymous' }]);
});

test('resolves with the real loader, whose create() mounts the app frame', async ({ page }) => {
  await page.route(LOADER_URL, (route) => edge(route));
  await openShimPage(page);

  expect(await load(page)).toEqual({ loaded: true });

  await page.evaluate(() => {
    const w = window as unknown as ShimWindow;
    document.getElementById('mount')?.appendChild(w.__instance.create());
  });

  await expect(page.locator('#mount doola-embed iframe')).toHaveCount(1);
  await navigatedFrame(page, harness.sdkOrigin);
});

const failures = {
  '404s': (route: Route) => route.fulfill({ status: 404, body: 'nope' }),
  'is unreachable': (route: Route) => route.abort('connectionrefused'),
};

for (const [label, fail] of Object.entries(failures)) {
  test(`a loader that ${label} rejects, removes its tag, and a later call retries`, async ({
    page,
  }) => {
    await page.route(LOADER_URL, fail);
    await openShimPage(page);

    expect(await load(page)).toEqual({ loaded: false, message: CSP_HINT });
    expect(await loaderTags(page)).toHaveLength(0);

    await page.unroute(LOADER_URL);
    await page.route(LOADER_URL, (route) => edge(route));

    expect(await load(page), 'a failed load must not be cached').toEqual({ loaded: true });
    expect(await loaderTags(page)).toHaveLength(1);
  });
}

test('a script that loads without defining window.Doola rejects and removes its tag', async ({
  page,
}) => {
  await page.route(LOADER_URL, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: '/* not the loader */',
    }),
  );
  await openShimPage(page);

  expect(await load(page)).toEqual({
    loaded: false,
    message: 'The doola loader loaded but did not initialize.',
  });
  expect(await loaderTags(page)).toHaveLength(0);
});

test('an existing window.Doola is adopted and the loader is never fetched', async ({ page }) => {
  let fetched = 0;
  await page.route(LOADER_URL, (route) => {
    fetched += 1;
    return route.abort();
  });
  await openShimPage(page);

  await page.evaluate(() => {
    const w = window as unknown as ShimWindow;
    w.Doola = {
      init: (options) => {
        w.__adoptedKey = options.publishableKey;
        return {} as Doola;
      },
    };
  });

  expect(await load(page)).toEqual({ loaded: true });
  expect(await page.evaluate(() => (window as unknown as ShimWindow).__adoptedKey)).toBe(
    'pk_test_harness',
  );
  expect(await loaderTags(page)).toHaveLength(0);
  expect(fetched).toBe(0);
});

test('the loader does not run unless the edge allows this page to read it', async ({ page }) => {
  // An allowlist rather than an absent header, because Playwright's fulfill
  // adds a matching Access-Control-Allow-Origin to any response that has none
  // (microsoft/playwright#12929). An allowlist that omits the partner is the
  // narrowing the shim's crossorigin comment warns about anyway.
  await page.route(LOADER_URL, (route) =>
    edge(route, { 'access-control-allow-origin': 'https://another-partner.example' }),
  );
  await openShimPage(page);

  expect(await load(page)).toEqual({ loaded: false, message: CSP_HINT });
  expect(await loaderTags(page)).toHaveLength(0);
});
