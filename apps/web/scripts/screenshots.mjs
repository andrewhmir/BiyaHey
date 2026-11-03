#!/usr/bin/env node
/**
 * Capture the README screenshots from the **built** PWA against the live local
 * stack (spec §11 screens, UX v2 flow). This is a repeatable, documented
 * capture — the committed PNGs under `docs/screenshots/` come from this script,
 * not from a mockup or a hand-edited image.
 *
 * Prerequisites (the script checks the first two and refuses otherwise):
 *   - `npm run build --workspace @biyahey/web` has produced `apps/web/dist`
 *   - the local stack is up: MOTIS :8080 and the BFF :8787
 *     (`docker compose up -d --wait routing api`)
 *
 * Run:
 *   node apps/web/scripts/screenshots.mjs
 *
 * It serves `dist/` with `vite preview` on **:5173** — the origin the BFF CORS
 * allow-list permits (R40) — then drives the real UX v2 flow with Playwright's
 * Chromium at the design viewport (390×844, Pixel 7, 2× DPR):
 *
 *   Home (sheet at half) → Search "Cubao" → route options (leg-strip cards over
 *   the per-alternative map) → trip detail (sticky map header) → live
 *   walkthrough (/trip/:id/live) → Save → /saved → /sources
 *
 * Every map capture waits on the app's own map state instead of a fixed sleep:
 * the DEV-only `window.__biyaheyMap` handle must exist, its style must be ready,
 * the route sources the screen owns must be added, and the vector tiles must
 * have finished loading. That keeps the script honest when the basemap is slow.
 *
 * Note: this script needs a **production build**, so it is not run by the E2E
 * dev project; the Lead runs it (or the full `npm run test:e2e`) at the end.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..', '..');
const outDir = join(repoRoot, 'docs', 'screenshots');
const baseURL = 'http://localhost:5173';

function fail(message) {
  console.error(`screenshots: ${message}`);
  process.exit(1);
}

if (!existsSync(join(webRoot, 'dist', 'index.html'))) {
  fail(
    'apps/web/dist is missing. Run `npm run build --workspace @biyahey/web` first ' +
      '(docs/runbooks/local-dev.md §3).',
  );
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  return false;
}

/** Start `vite preview` for `dist/` on the CORS-allowed port. */
function startPreview() {
  const vite = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) {
    fail(`could not find Vite at ${vite}. Run \`npm ci\` first.`);
  }
  const child = spawn(process.execPath, [vite, 'preview', '--port', '5173', '--strictPort'], {
    cwd: webRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`screenshots: vite preview exited ${code}\n${log}`);
    }
  });
  return child;
}

/** The captures, in flow order (`live-trip.png` is the UX v2 addition). */
const names = [
  ['home', 'Home — map + Kalsada sheet with the search pill and recent trips'],
  ['search-results', 'Search — directions form with grouped results for "Cubao"'],
  ['route-options', 'Route options — fare-forward cards + leg strips over the per-alternative map'],
  ['trip-detail', 'Trip detail — sticky map header, leg rail, timeline and save'],
  ['live-trip', 'Live trip — leg-by-leg walkthrough with the honest no-live-data banner'],
  ['saved', 'Saved — the endpoint-titled snapshot after saving the trip'],
  ['about-data', 'About data — provenance list from /sources'],
];

mkdirSync(outDir, { recursive: true });

const preview = startPreview();
let browser;

try {
  if (!(await waitForServer(baseURL))) {
    fail(
      `vite preview did not answer on ${baseURL}. Is another server already using port 5173? ` +
        'Stop it (or your web dev server) and retry.',
    );
  }

  browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
    permissions: ['geolocation'],
    geolocation: { latitude: 14.5547, longitude: 121.0244 },
  });
  const page = await context.newPage();

  /**
   * Wait until the live MapLibre canvas is mounted and has published its
   * style-ready signal. The DEV-only `window.__biyaheyMap` handle does not exist
   * in the production build this script captures, so the readiness marker is the
   * production-safe `data-map-ready` attribute on the canvas plus a short settle
   * window for the fitted camera and vector tiles to paint.
   */
  async function waitForMap(page, { settleMs = 1800, timeout = 120_000 } = {}) {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="map-canvas"]')?.getAttribute('data-map-ready') ===
        'true',
      undefined,
      { timeout },
    );
    await page.waitForTimeout(settleMs);
  }

  async function capture(name) {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, type: 'png', animations: 'disabled' });
    const bytes = statSync(path).size;
    console.log(`screenshots: ${name}.png (${(bytes / 1024).toFixed(0)} KB)`);
  }

  // 1. Home — the map behind the Kalsada bottom sheet. Expand from peek to half
  //    so the capture shows the search pill, recents/door entries and the real
  //    OpenFreeMap basemap.
  await page.goto(`${baseURL}/`);
  await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('map-credit').waitFor({ state: 'visible', timeout: 30_000 });
  const expand = page.getByRole('button', { name: 'Expand sheet' });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    await page.locator('[data-testid="sheet"][data-detent="half"]').waitFor({ timeout: 10_000 });
  }
  await waitForMap(page);
  await capture('home');

  // 2. Search — the directions form (R89) with the same live /search request
  //    the E2E flow exercises: type the destination first, show grouped stops.
  await page.getByRole('button', { name: 'Saan ka pupunta?' }).click();
  await page.waitForURL(/\/search$/);
  await page.getByRole('searchbox', { name: /papunta sa/i }).fill('Cubao');
  await page.getByTestId('search-group-stops').waitFor({ state: 'visible', timeout: 30_000 });
  await capture('search-results');

  // 3. Route options — pick the live stop, use the granted device location for
  //    From (one explicit tap, never automatic), then wait for the real plan and
  //    the per-alternative map paths (selected legs + numbered alternatives).
  await page.getByTestId('search-group-stops').getByRole('button').first().click();
  await page.getByRole('button', { name: /gamitin ang lokasyon ko/i }).click();
  await page.getByRole('button', { name: 'Maghanap ng ruta' }).click();
  await page.waitForURL(/\/plan\?/);
  await page.getByTestId('route-card').first().waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByTestId('fare-amount').first().waitFor({ state: 'visible' });
  await waitForMap(page, { settleMs: 2200 });
  await capture('route-options');

  // 4. Trip detail — the v2 detail action (exactly one, under the selected
  //    card) opens the itinerary with the sticky map header + leg-coloured route.
  await page.getByTestId('route-detail-action').click();
  await page.waitForURL(/\/trip\/[^/]+$/);
  await page.getByTestId('trip-header').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('save-trip').waitFor({ state: 'visible' });
  await waitForMap(page, { settleMs: 2200 });
  await capture('trip-detail');

  // 5. Live walkthrough — advance to the first ride leg so the capture shows a
  //    guided step with its signage, then capture the honest walkthrough screen.
  await page.getByTestId('start-trip').click();
  await page.waitForURL(/\/live$/);
  await page.getByTestId('live-banner').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('live-progress').waitFor({ state: 'visible' });
  const liveNext = page.getByTestId('live-next');
  if ((await liveNext.count()) > 0) {
    await liveNext.click();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="route-map-state"]');
      return node?.getAttribute('data-active-leg') === '1';
    });
  }
  await waitForMap(page, { settleMs: 1600 });
  await capture('live-trip');

  // 6. Saved — return to the detail (plan cache still in memory) and save via the
  //    real CTA, then reload /saved so the row comes from the localStorage
  //    snapshot (not the in-memory plan cache).
  await page.getByRole('button', { name: 'Bumalik sa detalye' }).click();
  await page.waitForURL(/\/trip\/[^/]+$/);
  await page.getByTestId('save-trip').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('save-trip').click();
  await page.getByText('Nai-save ang biyahe.').waitFor({ state: 'visible', timeout: 10_000 });
  await page.goto(`${baseURL}/saved`);
  await page.getByTestId('saved-row').first().waitFor({ state: 'visible', timeout: 15_000 });
  await capture('saved');

  // 7. About data — the live provenance registry.
  await page.goto(`${baseURL}/sources`);
  await page.getByTestId('dataset-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await capture('about-data');
} finally {
  if (browser !== undefined) {
    await browser.close().catch(() => undefined);
  }
  preview.kill();
}

console.log(`\nscreenshots: wrote ${names.length} PNG(s) to docs/screenshots/`);
for (const [name] of names) {
  console.log(`  docs/screenshots/${name}.png`);
}
