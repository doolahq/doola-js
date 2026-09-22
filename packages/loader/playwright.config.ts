import { defineConfig } from '@playwright/test';

/**
 * The browser suite for `FrameController`, which the vitest suite cannot reach:
 * it needs two real origins, a `postMessage` that enforces `targetOrigin`, and
 * a real `about:blank` -> navigated transition. jsdom enforces none of those,
 * so a jsdom test here would pass against the very bugs it is meant to catch.
 *
 * Chromium only. This is testing the loader's own wiring against browser rules
 * that are specified, not vendor behaviour, and a matrix would buy coverage of
 * postMessage and iframe navigation rather than of this code.
 */
export default defineConfig({
  testDir: './test/browser',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    // The suite drives both sides itself, so nothing here waits on the network.
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
