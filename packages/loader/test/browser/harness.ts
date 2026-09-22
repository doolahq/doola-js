import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '../../dist/index.global.js');

/**
 * Two servers, because one is not a test.
 *
 * `localhost` and `127.0.0.1` resolve to the same machine and are different
 * origins, which is the whole point: `postMessage` enforces `targetOrigin`
 * against the serialized origin, so a harness on one origin exercises none of
 * the code under test. jsdom does not enforce the rule at all, which is why
 * these tests cannot live beside the vitest suite.
 */
export interface Harness {
  partnerOrigin: string;
  sdkOrigin: string;
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
 * Stands in for the embedded app. It records everything the loader posts and
 * exposes a sender, so a test drives the app half explicitly rather than
 * racing a real one. `?delay=` holds the response back to keep the frame on
 * `about:blank` for a known window — that is when the `post()` gate matters.
 */
const APP_PAGE = `<!doctype html>
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

/** Answers 404, so the frame loads an error document and never speaks. */
export const NEVER_LOADS_KEY = 'pk_test_never_loads';

/** `pk_test_slow_<ms>` holds the app document back for that many milliseconds. */
export const SLOW_KEY_PATTERN = /^pk_test_slow_(\d+)$/;

export const slowKey = (ms: number): string => `pk_test_slow_${ms}`;

export async function startHarness(): Promise<Harness> {
  const bundle = readFileSync(BUNDLE, 'utf8');

  const partner = createServer((req, res) => {
    if (req.url?.startsWith('/loader.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(bundle);
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PARTNER_PAGE);
  });

  // Behaviour is selected through the publishable key, because that is the only
  // thing a test controls that reaches this server: the loader builds the frame
  // URL itself as `<sdkOrigin>/?pk=<key>`, and `origin` is serialized to a bare
  // origin, so a query string cannot be smuggled in through the options.
  const sdk = createServer((req, res) => {
    const key = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('pk') ?? '';

    if (key === NEVER_LOADS_KEY) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>missing</title>');
      return;
    }

    const respond = (): void => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(APP_PAGE);
    };

    const slow = SLOW_KEY_PATTERN.exec(key);
    if (slow) setTimeout(respond, Number(slow[1]));
    else respond();
  });

  await Promise.all([listen(partner, 'localhost'), listen(sdk, '127.0.0.1')]);

  return {
    partnerOrigin: `http://localhost:${port(partner)}`,
    sdkOrigin: `http://127.0.0.1:${port(sdk)}`,
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
