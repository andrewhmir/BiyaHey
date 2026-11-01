#!/usr/bin/env node
/**
 * Capture the README screenshots from the **built** PWA against the live local
 * stack (spec §11 screens 1–6). This is a repeatable, documented capture — the
 * committed PNGs under `docs/screenshots/` come from this script, not from a
 * mockup or a hand-edited image.
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
 * allow-list permits (R40) — then drives the real flow with Playwright's
 * Chromium at the design viewport (390×844, Pixel 7, 2× DPR):
 *
 *   Home (sheet at half) → Search "Cubao" → route options → trip detail →
 *   Save → /saved → /sources
 *
 * The preview server is started and stopped by this script; it fails loudly if
 * port 5173 is already taken instead of screenshotting a different app.
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

const names = [
  ['home', 'Home — map + peek/half sheet with the search pill'],
  ['search-results', 'Search — grouped results for "Cubao"'],
  ['route-options', 'Route options — fare-forward cards over the map'],
  ['trip-detail', 'Trip detail — header, timeline, save'],
  ['saved', 'Saved — the snapshot after saving the trip'],
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

  async function capture(name) {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, type: 'png', animations: 'disabled' });
    const bytes = statSync(path).size;
    console.log(`screenshots: ${name}.png (${(bytes / 1024).toFixed(0)} KB)`);
  }

  // 1. Home — the map behind the standard bottom sheet. Expand from peek to half
  //    so the screenshot shows the brand, hint and the Saved/About-data entries
  //    as well as the search pill; the map is the real OpenFreeMap basemap.
  await page.goto(`${baseURL}/`);
  await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('map-credit').waitFor({ state: 'visible', timeout: 30_000 });
  const expand = page.getByRole('button', { name: 'Expand sheet' });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    await page.locator('[data-testid="sheet"][data-detent="half"]').waitFor({ timeout: 10_000 });
  }
  // Let the vector tiles and attribution settle before the still capture.
  await page.waitForTimeout(3_000);
  await capture('home');

  // 2. Search — the same live /search request the E2E flow exercises.
  await page.getByRole('button', { name: 'Saan ka pupunta?' }).click();
  await page.waitForURL(/\/search$/);
  await page.getByRole('searchbox').fill('Cubao');
  await page.getByTestId('search-group-stops').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await capture('search-results');

  // 3. Route options — select the first live stop, wait for the real plan.
  await page.getByTestId('search-group-stops').getByRole('button').first().click();
  await page.waitForURL(/\/plan\?/);
  await page.getByTestId('route-card').first().waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByTestId('fare-amount').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(3_000);
  await capture('route-options');

  // 4. Trip detail — the first real itinerary, with its timeline and Save CTA.
  await page.getByTestId('trip-open').first().click();
  await page.waitForURL(/\/trip\/[^/]+$/);
  await page.getByTestId('trip-header').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('save-trip').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await capture('trip-detail');

  // 5. Saved — save via the real CTA, then reload /saved so the row comes from
  //    the localStorage snapshot (not the in-memory plan cache).
  await page.getByTestId('save-trip').click();
  await page.getByText('Nai-save ang biyahe.').waitFor({ state: 'visible', timeout: 10_000 });
  await page.goto(`${baseURL}/saved`);
  await page.getByTestId('saved-row').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  await capture('saved');

  // 6. About data — the live provenance registry.
  await page.goto(`${baseURL}/sources`);
  await page.getByTestId('dataset-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
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
