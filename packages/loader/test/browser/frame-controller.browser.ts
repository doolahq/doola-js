import type { Doola, DoolaOptions } from '@doola/js';
import { expect, test, type Frame, type Page, type Route } from '@playwright/test';

import {
  LOAD_BACKSTOP_MS,
  PLACEHOLDER_FRAME_HEIGHT_PX,
  READY_AFTER_LOAD_MS,
} from '../../src/policy';
import { MIN_SUPPORTED_VERSION, PROTOCOL_VERSION } from '../../src/protocol';
import { startHarness, type Harness } from './harness';

let harness: Harness;

test.beforeAll(async () => {
  harness = await startHarness();
});

test.afterAll(async () => {
  await harness.close();
});

const WIDE = { width: 1000, height: 800 };
/** Under the loader's 640px `auto` breakpoint, so `auto` resolves to full screen. */
const NARROW = { width: 400, height: 800 };

type Wire = { origin: string; data: { v?: unknown; type?: unknown; payload?: unknown } };
type PartnerEvent = { handler: string; event?: unknown; error?: unknown };

/**
 * The harness pages' globals. These name what the harness installs; they are
 * not a claim that the compiler is checking the page, which it cannot do from
 * inside `page.evaluate`.
 */
interface PartnerWindow extends Window {
  __events: PartnerEvent[];
  __instance: Doola;
  __element: HTMLElement;
}

interface AppWindow extends Window {
  __received: Wire[];
  __send: (message: unknown, targetOrigin?: string) => void;
}

const ready = { v: PROTOCOL_VERSION, type: 'ready', payload: { protocolMax: PROTOCOL_VERSION } };

/** Past whichever deadline is armed, driven through the clock so the suite stays in seconds. */
const PAST_GRACE_MS = READY_AFTER_LOAD_MS + 1_000;
const PAST_BACKSTOP_MS = LOAD_BACKSTOP_MS + 1_000;

async function mount(
  page: Page,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<void> {
  await page.setViewportSize(options.viewport ?? WIDE);
  await page.goto(harness.partnerOrigin);

  await page.evaluate((sdkOrigin) => {
    const w = window as unknown as PartnerWindow;
    w.__events = [];

    const options: DoolaOptions = {
      publishableKey: 'pk_test_harness',
      origin: sdkOrigin,
      fetchAccessToken: () => Promise.resolve({ accessToken: 'cs_harness', expiresIn: 3600 }),
      onAuthError: (error) => w.__events.push({ handler: 'onAuthError', error }),
      onFormed: (event) => w.__events.push({ handler: 'onFormed', event }),
      onLoadError: (error) => w.__events.push({ handler: 'onLoadError', error }),
      onLoaderStart: () => w.__events.push({ handler: 'onLoaderStart' }),
    };

    w.__instance = w.Doola!.init(options);
    w.__element = w.__instance.create();
    document.getElementById('mount')?.appendChild(w.__element);
  }, harness.sdkOrigin);
}

/** Intercepts the frame document, so a test states its own failure mode. */
async function interceptFrame(page: Page, handler: (route: Route) => unknown): Promise<void> {
  await page.route(`${harness.sdkOrigin}/**`, handler);
}

/**
 * The app half, once it exists. The `src` attribute is set the moment the
 * element is created, so it proves nothing — only the frame's own URL says the
 * navigation has happened, which is the about:blank window the `post()` gate
 * is about.
 */
async function appFrame(page: Page): Promise<Frame> {
  const find = (): Frame | undefined =>
    page.frames().find((candidate) => candidate.url().startsWith(harness.sdkOrigin + '/'));

  await expect
    .poll(() => find() !== undefined, {
      message: 'the app frame should navigate to the sdk origin',
    })
    .toBe(true);

  const frame = find() as Frame;
  await frame.waitForFunction(() => Array.isArray((window as unknown as AppWindow).__received));

  return frame;
}

function received(frame: Frame): Promise<Wire[]> {
  return frame.evaluate(() => (window as unknown as AppWindow).__received);
}

function sendFromApp(frame: Frame, message: unknown): Promise<void> {
  return frame.evaluate((m) => {
    (window as unknown as AppWindow).__send(m, '*');
  }, message);
}

function countOfType(frame: Frame, type: string): Promise<number> {
  return frame.evaluate(
    (t) => (window as unknown as AppWindow).__received.filter((m) => m.data?.type === t).length,
    type,
  );
}

async function eventsOf(page: Page, handler: string): Promise<PartnerEvent[]> {
  const events = await page.evaluate(() => (window as unknown as PartnerWindow).__events);

  return events.filter((event) => event.handler === handler);
}

async function handshake(page: Page): Promise<Frame> {
  const frame = await appFrame(page);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);

  return frame;
}

/** The whole of what a fresh frame should have been told, and nothing carried over. */
async function expectFreshHandshake(frame: Frame): Promise<void> {
  const types = (await received(frame)).map((m) => m.data.type);

  expect(types[0], 'init is the first thing the app ever receives').toBe('init');
  expect(types).not.toContain('update');
}

function updateLocale(page: Page, locale: string): Promise<void> {
  return page.evaluate((l) => {
    (window as unknown as PartnerWindow).__instance.update({ locale: l });
  }, locale);
}

function frameHeight(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('iframe')?.style.height ?? '');
}

test('posts nothing before ready, even once the frame could receive it', async ({ page }) => {
  await mount(page);

  // The window that matters, and the only one that can prove the gate: the
  // frame has navigated and is listening, so the browser would deliver a post
  // — but `ready` has not arrived, so there is no negotiated version to stamp.
  // On about:blank the browser refuses the send whether the gate is there or
  // not, so that window proves nothing.
  const frame = await appFrame(page);
  await updateLocale(page, 'fr');
  await page.waitForTimeout(250);

  expect(await received(frame), 'nothing reaches the app before it says ready').toHaveLength(0);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);
  await expectFreshHandshake(frame);
});

test('init carries the negotiated protocol and the presentation mode', async ({ page }) => {
  await mount(page);
  const frame = await handshake(page);

  const init = (await received(frame)).find((m) => m.data.type === 'init');
  const payload = init?.data.payload as Record<string, unknown>;

  expect(init?.data.v).toBe(PROTOCOL_VERSION);
  expect(payload.protocol).toBe(PROTOCOL_VERSION);
  expect(payload.presentation).toBe('inline');
  expect((payload.session as Record<string, unknown>).accessToken).toBe('cs_harness');
});

test('a viewport crossing the breakpoint sends the presentation transition', async ({ page }) => {
  await mount(page, { viewport: WIDE });
  const frame = await handshake(page);

  await page.setViewportSize(NARROW);
  await expect.poll(() => countOfType(frame, 'presentation')).toBe(1);

  await page.setViewportSize(WIDE);
  await expect.poll(() => countOfType(frame, 'presentation')).toBe(2);

  const modes = (await received(frame))
    .filter((m) => m.data.type === 'presentation')
    .map((m) => (m.data.payload as { mode: string }).mode);
  expect(modes).toEqual(['fullScreen', 'inline']);
});

test('a height negotiated inline survives a full-screen round trip', async ({ page }) => {
  await mount(page, { viewport: WIDE });
  const frame = await handshake(page);

  await sendFromApp(frame, { v: PROTOCOL_VERSION, type: 'resize', payload: { height: 512 } });
  await expect.poll(() => frameHeight(page)).toBe('512px');

  await page.setViewportSize(NARROW);
  await expect.poll(() => frameHeight(page)).toBe('100%');

  await page.setViewportSize(WIDE);
  await expect
    .poll(() => frameHeight(page), { message: 'the inline height is restored, not rebuilt' })
    .toBe('512px');
});

test('a frame mounted under the breakpoint returns to the placeholder, not to zero', async ({
  page,
}) => {
  // It goes full screen before the app has negotiated anything, so the height
  // it captures is the placeholder. Asserted rather than left to be "fixed":
  // the last full-screen height was measured against the wrong viewport, and
  // the loader never knew an inline one. See applyPresentation.
  await mount(page, { viewport: NARROW });
  await handshake(page);
  await expect.poll(() => frameHeight(page)).toBe('100%');

  await page.setViewportSize(WIDE);
  await expect.poll(() => frameHeight(page)).toBe(`${PLACEHOLDER_FRAME_HEIGHT_PX}px`);
});

test('a remount handshakes from scratch and posts nothing to the fresh frame', async ({ page }) => {
  await mount(page);
  await handshake(page);

  await page.evaluate(() => {
    (window as unknown as PartnerWindow).__element.remove();
  });
  await updateLocale(page, 'de');
  await page.evaluate(() => {
    document.getElementById('mount')?.appendChild((window as unknown as PartnerWindow).__element);
  });

  await expectFreshHandshake(await handshake(page));
});

test('a version outside the supported window is dropped, and is not fatal', async ({ page }) => {
  await mount(page);
  const frame = await appFrame(page);

  for (const v of [PROTOCOL_VERSION + 1, MIN_SUPPORTED_VERSION - 1]) {
    await sendFromApp(frame, { v, type: 'ready', payload: { protocolMax: PROTOCOL_VERSION } });
  }
  await page.waitForTimeout(250);
  expect(await received(frame)).toHaveLength(0);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);
});

// One body, both labels: that these two land in the same place with the same
// projection is the whole of PENG-6682, so the loop is the assertion.
for (const type of ['formed', 'checkout-request'] as const) {
  test(`${type} reaches onFormed with the company id and nothing else`, async ({ page }) => {
    await mount(page);
    const frame = await handshake(page);

    await sendFromApp(frame, {
      v: PROTOCOL_VERSION,
      type,
      payload: { companyId: 'cmp_88', amountDue: 4200, internal: 'must not leak' },
    });

    await expect.poll(async () => (await eventsOf(page, 'onFormed')).length).toBe(1);
    expect((await eventsOf(page, 'onFormed'))[0]?.event).toEqual({ companyId: 'cmp_88' });
  });
}

test('a malformed checkout-request is dropped, not thrown on', async ({ page }) => {
  await mount(page);
  const frame = await handshake(page);

  await sendFromApp(frame, {
    v: PROTOCOL_VERSION,
    type: 'checkout-request',
    payload: { companyId: '' },
  });
  await sendFromApp(frame, { v: PROTOCOL_VERSION, type: 'checkout-request', payload: {} });
  await page.waitForTimeout(250);

  expect(await eventsOf(page, 'onFormed')).toHaveLength(0);

  // Still healthy: a dropped payload is not fatal to the frame.
  await sendFromApp(frame, {
    v: PROTOCOL_VERSION,
    type: 'checkout-request',
    payload: { companyId: 'cmp_9' },
  });
  await expect.poll(async () => (await eventsOf(page, 'onFormed')).length).toBe(1);
});

test('a frame that loads but never says ready is reported after the grace', async ({ page }) => {
  await page.clock.install();
  await mount(page);
  await appFrame(page);

  expect(
    await eventsOf(page, 'onLoadError'),
    'nothing is reported while it may still start',
  ).toHaveLength(0);

  // The short grace, not the backstop: `load` has fired, so the loader knows
  // the document arrived and only the handshake is missing.
  await page.clock.fastForward(PAST_GRACE_MS);
  await expect.poll(async () => (await eventsOf(page, 'onLoadError')).length).toBe(1);
  expect((await eventsOf(page, 'onLoadError'))[0]?.error).toMatchObject({ type: 'render_error' });
});

test('a document that 404s is reported on the same grace', async ({ page }) => {
  await page.clock.install();
  await interceptFrame(page, (route) => route.fulfill({ status: 404, body: 'nope' }));
  await mount(page);

  await page.clock.fastForward(PAST_GRACE_MS);
  await expect.poll(async () => (await eventsOf(page, 'onLoadError')).length).toBe(1);
});

test('a document that never arrives is reported by the backstop', async ({ page }) => {
  await page.clock.install();
  // Never fulfilled, so `load` never fires and the grace is never armed.
  await interceptFrame(page, () => {});
  await mount(page);

  await page.clock.fastForward(PAST_GRACE_MS);
  await page.waitForTimeout(250);
  expect(await eventsOf(page, 'onLoadError'), 'the grace cannot have been armed').toHaveLength(0);

  await page.clock.fastForward(PAST_BACKSTOP_MS);
  await expect.poll(async () => (await eventsOf(page, 'onLoadError')).length).toBe(1);
});

test('a frame that hands shake in time is never reported', async ({ page }) => {
  await page.clock.install();
  await mount(page);
  await handshake(page);

  await page.clock.fastForward(PAST_BACKSTOP_MS);
  await page.waitForTimeout(250);

  expect(await eventsOf(page, 'onLoadError')).toHaveLength(0);
});

test('a ready that lands before load does not re-arm the deadline', async ({ page }) => {
  await page.clock.install();

  // Production's ordering, which the harness page deliberately does not have:
  // the real app announces `ready` from a script in the document head, while
  // the document parses, so it lands *before* the frame's `load` event. Without
  // the guard in armReadyDeadline, that `load` re-arms the timer on a frame
  // that has already handshaked and the partner is told a healthy embed failed.
  await interceptFrame(page, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>
        window.__received = [];
        addEventListener('message', (e) =>
          window.__received.push({ origin: e.origin, data: e.data }));
        parent.postMessage(
          { v: ${PROTOCOL_VERSION}, type: 'ready', payload: { protocolMax: ${PROTOCOL_VERSION} } },
          '*'
        );
      </script>`,
    }),
  );

  await mount(page);
  const frame = await appFrame(page);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);

  await page.clock.fastForward(PAST_BACKSTOP_MS);
  await page.waitForTimeout(250);

  expect(await eventsOf(page, 'onLoadError'), 'a handshaked frame is never reported').toHaveLength(
    0,
  );
});

test('a late ready is not a retraction, and the frame still works', async ({ page }) => {
  await page.clock.install();
  await mount(page);
  const frame = await appFrame(page);

  await page.clock.fastForward(PAST_GRACE_MS);
  await expect.poll(async () => (await eventsOf(page, 'onLoadError')).length).toBe(1);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);
  expect(await eventsOf(page, 'onLoadError'), 'the callback does not un-fire').toHaveLength(1);
});

test('a frame unmounted before the deadline is never reported', async ({ page }) => {
  await page.clock.install();
  await mount(page);
  await appFrame(page);

  await page.evaluate(() => {
    (window as unknown as PartnerWindow).__element.remove();
  });

  await page.clock.fastForward(PAST_BACKSTOP_MS);
  await page.waitForTimeout(250);

  expect(await eventsOf(page, 'onLoadError')).toHaveLength(0);
});
