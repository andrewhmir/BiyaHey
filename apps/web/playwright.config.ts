import { defineConfig } from '@playwright/test';

/**
 * Browser-driven verification for the BiyaHey! rehaul.
 *
 * The stack must already be up (this config deliberately has no `webServer`):
 *   - Vite dev server  http://localhost:5173  (the `mobile`/`desktop` projects)
 *   - BFF              http://localhost:8787  (live MOTIS on :8080)
 *   - `pwa.spec.ts` builds `dist/` and boots its own `vite preview` (:4173) and
 *     a CORS-configured BFF child (:8788), so it never depends on :5173.
 *
 * The Chromium binary is pre-installed in the dev image; pinning it here stops
 * Playwright from attempting a browser download.
 */
const CHROME = '/home/sysadmin/.cache/ms-playwright/chromium-1187/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // External basemap style/tiles come from a CDN; retry a transient CDN blip.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: { executablePath: CHROME },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile',
      testMatch: /(plan|a11y|pwa)\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      testMatch: /desktop\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
