import type { Doola, DoolaOptions } from '@doola/js';
import { expect, test, type ConsoleMessage, type Frame, type Page } from '@playwright/test';

import { slowKey, startHarness, type Harness } from './harness';

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
 * What the harness's partner page exposes, on top of the `window.Doola` the
 * contract already declares. Typed from the contract so a change to it is a
 * compile error here rather than a test that drives a shape nobody ships.
 */
interface PartnerWindow extends Window {
  __events: PartnerEvent[];
  __instance: Doola;
  __element: HTMLElement;
}

/** What the harness's app page exposes. */
interface AppWindow extends Window {
  __received: Wire[];
  __send: (message: unknown, targetOrigin?: string) => void;
}

const ready = { v: 1, type: 'ready', payload: { protocolMax: 1 } };

interface MountOptions {
  key?: string;
  presentation?: { mode: 'auto' | 'fullScreen' };
  viewport?: { width: number; height: number };
}

/** Errors the browser itself raises, which is how a refused postMessage would show up. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return errors;
}

async function mount(page: Page, options: MountOptions = {}): Promise<void> {
  const { key = 'pk_test_harness', presentation, viewport = WIDE } = options;

  await page.setViewportSize(viewport);
  await page.goto(harness.partnerOrigin);

  await page.evaluate(
    ({ key, sdkOrigin, presentation }) => {
      const w = window as unknown as PartnerWindow;
      w.__events = [];

      w.__instance = w.Doola!.init({
        publishableKey: key,
        origin: sdkOrigin,
        fetchAccessToken: () => Promise.resolve({ accessToken: 'cs_harness', expiresIn: 3600 }),
        onAuthError: (error: unknown) => w.__events.push({ handler: 'onAuthError', error }),
        onFormed: (event: unknown) => w.__events.push({ handler: 'onFormed', event }),
        onLoadError: (error: unknown) => w.__events.push({ handler: 'onLoadError', error }),
        onLoaderStart: () => w.__events.push({ handler: 'onLoaderStart' }),
        ...(presentation ? { presentation } : {}),
      } as unknown as DoolaOptions);

      w.__element = w.__instance.create();
      document.getElementById('mount')?.appendChild(w.__element);
    },
    { key, sdkOrigin: harness.sdkOrigin, presentation },
  );
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

async function handshake(page: Page): Promise<Frame> {
  const frame = await appFrame(page);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);

  return frame;
}

function partnerEvents(page: Page): Promise<PartnerEvent[]> {
  return page.evaluate(() => (window as unknown as PartnerWindow).__events);
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

  const types = (await received(frame)).map((m) => m.data.type);
  expect(types[0], 'init is the first thing the app ever receives').toBe('init');
  expect(types).not.toContain('update');
});

test('a post the browser would refuse stays silent in the partner console', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // Held back, so the frame is provably still on about:blank when the loader
  // is asked to send.
  await mount(page, { key: slowKey(1000) });
  await updateLocale(page, 'fr');

  const frame = await handshake(page);

  expect(errors.join('\n')).not.toMatch(/postMessage/i);
  expect((await received(frame)).map((m) => m.data.type)).toEqual(['init']);
});

test('init carries the negotiated protocol and the presentation mode', async ({ page }) => {
  await mount(page);
  const frame = await handshake(page);

  const init = (await received(frame)).find((m) => m.data.type === 'init');
  const payload = init?.data.payload as Record<string, unknown>;

  expect(init?.data.v).toBe(1);
  expect(payload.protocol).toBe(1);
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

  await sendFromApp(frame, { v: 1, type: 'resize', payload: { height: 512 } });
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
  await expect.poll(() => frameHeight(page)).toBe('160px');
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

  const frame = await handshake(page);
  const types = (await received(frame)).map((m) => m.data.type);

  expect(types[0], 'the new frame is handshaked, not resumed').toBe('init');
  expect(types).not.toContain('update');
});

test('a version above the loader maximum is dropped, and is not fatal', async ({ page }) => {
  await mount(page);
  const frame = await appFrame(page);

  await sendFromApp(frame, { v: 2, type: 'ready', payload: { protocolMax: 1 } });
  await page.waitForTimeout(250);
  expect(await received(frame)).toHaveLength(0);

  await sendFromApp(frame, ready);
  await expect.poll(() => countOfType(frame, 'init')).toBe(1);
});

test('checkout-request reaches the same onFormed, with the company id alone', async ({ page }) => {
  await mount(page);
  const frame = await handshake(page);

  await sendFromApp(frame, {
    v: 1,
    type: 'checkout-request',
    payload: { companyId: 'cmp_88', price: 19900, internal: 'must not leak' },
  });

  await expect
    .poll(async () => (await partnerEvents(page)).filter((e) => e.handler === 'onFormed').length)
    .toBe(1);

  const [request] = (await partnerEvents(page)).filter((e) => e.handler === 'onFormed');
  expect(request?.event).toEqual({ companyId: 'cmp_88' });
});

test('a malformed checkout-request is dropped, not thrown on', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await mount(page);
  const frame = await handshake(page);

  await sendFromApp(frame, { v: 1, type: 'checkout-request', payload: { companyId: '' } });
  await sendFromApp(frame, { v: 1, type: 'checkout-request', payload: {} });
  await page.waitForTimeout(250);

  expect(await partnerEvents(page)).not.toContainEqual(
    expect.objectContaining({ handler: 'onFormed' }),
  );
  expect(errors.join('\n')).toBe('');

  // Still healthy: a dropped payload is not fatal to the frame.
  await sendFromApp(frame, { v: 1, type: 'checkout-request', payload: { companyId: 'cmp_9' } });
  await expect
    .poll(async () => (await partnerEvents(page)).filter((e) => e.handler === 'onFormed').length)
    .toBe(1);
});

test('formed reaches onFormed with the company id and nothing else', async ({ page }) => {
  await mount(page);
  const frame = await handshake(page);

  await sendFromApp(frame, {
    v: 1,
    type: 'formed',
    payload: { companyId: 'cmp_88', amountDue: 4200, internal: 'must not leak' },
  });

  await expect
    .poll(async () => (await partnerEvents(page)).filter((e) => e.handler === 'onFormed').length)
    .toBe(1);

  const [formed] = (await partnerEvents(page)).filter((e) => e.handler === 'onFormed');
  expect(formed?.event).toEqual({ companyId: 'cmp_88' });
});
