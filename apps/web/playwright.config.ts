import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level verification against the real local stack (Task 10, R72/R73).
 *
 * Two projects, because the two claims need different servers:
 *
 * - `dev` — the live trip flow and the Home smoke test. Vite dev pins
 *   `VITE_API_URL` to the local BFF (:8787) so the spec exercises the real
 *   `/search`, `/plan` and `/sources` responses, not MSW.
 * - `preview` — the built app served by `vite preview` (:4173). This is the
 *   only place the generated service worker registers, so this project is what
 *   proves `navigator.serviceWorker`, the offline `/saved` reload and the web
 *   app manifest (Task 8 deferred its browser-level SW/installability check to
 *   Task 10). The root `test:e2e` script builds first, so the preview server
 *   always describes the current tree; running `npm run e2e` inside
 *   `apps/web` without that build will fail the preview server on purpose.
 *
 * Geolocation stays granted at the Buendia end of the MRT-3 corridor
 * (14.5547, 121.0244) for the legacy `/plan?dest=…` deep-link path, but the
 * acceptance flow no longer depends on it: R89 makes `/search` a directions
 * form whose explicit From/To are carried in the URL (Guadalupe → Cubao). The
 * permission is kept so a device-origin fallback test cannot turn into a
 * permission prompt. The original choice is recorded in
 * `.superpowers/sdd/2026-11-01-biyahey-pwa-mvp/task-10-report.md`.
 */
const devURL = 'http://localhost:5173';
const previewURL = 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI === 'true' ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    // Pixel 7 emulation with the design's 390x844 layout viewport.
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 14.5547, longitude: 121.0244 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'dev',
      testIgnore: /service-worker\.spec\.ts$/,
      use: { baseURL: devURL },
    },
    {
      name: 'preview',
      testMatch: /service-worker\.spec\.ts$/,
      use: { baseURL: previewURL },
    },
  ],
  webServer: [
    {
      // Dev (not preview) keeps the live flow independent of a prior build; the
      // BFF CORS allow-list from R40 includes localhost:5173.
      command: 'npm run dev --workspace @biyahey/web',
      url: devURL,
      cwd: '../..',
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 120_000,
      env: {
        VITE_API_URL: process.env.VITE_API_URL ?? 'http://localhost:8787',
      },
    },
    {
      // The built app, which is the only app that registers the Workbox service
      // worker. `npm run test:e2e` builds before Playwright starts. Never reuse
      // an existing listener: a stale `dist/` would make the offline proof lie.
      command: 'npm run preview --workspace @biyahey/web -- --port 4173 --strictPort',
      url: previewURL,
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
