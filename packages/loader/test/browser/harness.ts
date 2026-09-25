import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { expect, type Frame, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '../../dist/index.global.js');
const SHIM = join(here, '../../../js/dist/index.js');

/**
 * Two servers, because one is not a test.
 *
 * `localhost` and `127.0.0.1` resolve to the same machine and are different
 * origins, which is the whole point: `postMessage` enforces `targetOrigin`
 * against the serialized origin, so a harness on one origin exercises none of
 * the code under test. jsdom does not enforce the rule at all, which is why
 * these tests cannot live beside the vitest suite.
 *
 * Failure modes are not served from here. A test that needs a 404, a stall or
 * a slow response intercepts the frame request with `page.route`, so the
 * behaviour sits on the line of the test that wants it rather than in a flag
 * this file has to interpret.
 *
 * A page's Content-Security-Policy is the exception: `?csp=` on any URL sends
 * it as a response header. Fulfilling the page from `page.route` instead makes
 * Chromium treat the document as public, and Local Network Access then blocks
 * its frame to 127.0.0.1 before CSP is ever consulted.
 */
export interface Harness {
  partnerOrigin: string;
  sdkOrigin: string;
  /** The built loader, for a test that serves it as js.doola.com. */
  loaderBundle: string;
  close: () => Promise<void>;
}

const PARTNER_PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>partner</title>
<style>body{margin:0}</style>
<div id="mount"></div>
<script src="/loader.js"></script>
`;

/**
 * A partner that installed `@doola/js`: the built shim, which injects the
 * loader from js.doola.com itself. Nothing here serves that URL, so each test
 * intercepts it and states what the edge returns.
 *
 * The page's module is a file, not inline, so a test can serve this page under
 * a partner's CSP as it is, without an `'unsafe-inline'` the partner would not
 * send.
 */
const SHIM_PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>partner</title>
<style>body{margin:0}</style>
<div id="mount"></div>
<script type="module" src="/shim-page.js"></script>
`;

const SHIM_PAGE_MODULE = `import { loadDoola } from '/shim.js';
window.__doola = { loadDoola };
`;

/**
 * Stands in for the embedded app. It records everything the loader posts and
 * exposes a sender, so a test drives the app half explicitly rather than
 * racing a real one. Deliberately silent until told: the real app announces
 * `ready` from a script in its head, and a harness that did the same would
 * leave no window in which to observe the handshake.
 */
export const APP_PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>app</title>
<script>
  window.__received = [];
  addEventListener('message', (event) => {
    window.__received.push({ origin: event.origin, data: event.data });
  });
  window.__send = (message, targetOrigin) =>
    parent.postMessage(message, targetOrigin || '*');
</script>
`;

export async function startHarness(): Promise<Harness> {
  // The suite drives the built artifacts — the IIFE and the shim partners
  // ship, not the sources — so `test:browser` builds both first. Named here
  // anyway, because a bare ENOENT from a fixture is a poor way to learn that.
  for (const artifact of [BUNDLE, SHIM]) {
    if (!existsSync(artifact)) {
      throw new Error(
        `doola: ${artifact} is missing. Run \`pnpm --filter @doola/loader test:browser\`, which builds it first.`,
      );
    }
  }

  const bundle = readFileSync(BUNDLE, 'utf8');
  const assets: Record<string, [type: string, body: string]> = {
    '/loader.js': ['text/javascript', bundle],
    '/shim.js': ['text/javascript', readFileSync(SHIM, 'utf8')],
    '/shim': ['text/html', SHIM_PAGE],
    '/shim-page.js': ['text/javascript', SHIM_PAGE_MODULE],
  };

  const partner = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://partner');
    const [type, body] = assets[url.pathname] ?? ['text/html', PARTNER_PAGE];
    const csp = url.searchParams.get('csp');

    res.writeHead(200, {
      'content-type': `${type}; charset=utf-8`,
      ...(csp && { 'content-security-policy': csp }),
    });
    res.end(body);
  });

  const sdk = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(APP_PAGE);
  });

  await Promise.all([listen(partner, 'localhost'), listen(sdk, '127.0.0.1')]);

  return {
    partnerOrigin: `http://localhost:${port(partner)}`,
    sdkOrigin: `http://127.0.0.1:${port(sdk)}`,
    loaderBundle: bundle,
    close: async () => {
      await Promise.all([closed(partner), closed(sdk)]);
    },
  };
}

function listen(server: Server, host: string): Promise<void> {
  return new Promise((resolve) => server.listen(0, host, resolve));
}

function port(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function closed(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Waits for the frame the loader mounted to navigate to the SDK origin, and returns it. */
export async function navigatedFrame(page: Page, sdkOrigin: string): Promise<Frame> {
  const find = (): Frame | undefined =>
    page.frames().find((candidate) => candidate.url().startsWith(sdkOrigin + '/'));

  await expect
    .poll(() => find() !== undefined, {
      message: 'the app frame should navigate to the sdk origin',
    })
    .toBe(true);

  return find() as Frame;
}
