import { defineConfig } from '@playwright/test';

/**
 * The browser suite for `FrameController`, which the vitest suite cannot reach:
 * it needs two real origins, a `postMessage` that enforces `targetOrigin`, and
 * a real `about:blank` -> navigated transition. jsdom enforces none of those,
 * so a jsdom test here would pass against the very bugs it is meant to catch.
 *
 * Chromium only, which is the default: this tests the loader's own wiring
 * against browser rules that are specified, so a matrix would buy coverage of
 * the browsers rather than of this code.
 *
 * `.browser.ts`, not `.spec.ts`, so vitest's default include does not collect
 * these files — the repo's one naming convention instead of two configs that
 * have to agree.
 */
export default defineConfig({
  testDir: './test/browser',
  testMatch: /.*\.browser\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
});
