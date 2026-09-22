import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * The browser suite belongs to Playwright (playwright.config.ts). Vitest's
     * default include matches `**` + `.spec.ts`, so without this it collects
     * those files, fails on the `@playwright/test` import, and takes `pnpm
     * test` down with it.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'test/browser/**'],
  },
});
