/**
 * Regenerate the README screenshots from the running app.
 *
 * Usage (repo root, with the dev stack up on :5173 + BFF :8787):
 *
 *   node apps/web/e2e/screenshots.mjs
 *
 * Writes real captures (no mocks) into `docs/screenshots/`:
 *   mobile 390x844 @2x — home, search-results, route-options, trip-detail,
 *                        live-trip, saved, about-data
 *   desktop 1440x900   — home-desktop, route-options-desktop
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME =
  process.env.BIYAHEY_CHROMIUM ??
  '/home/sysadmin/.cache/ms-playwright/chromium-1187/chrome-linux/chrome';
const BASE = process.env.BIYAHEY_BASE_URL ?? 'http://localhost:5173';
const CORRIDOR =
  '/plan?from=14.566719,121.045438&fromName=Guadalupe%2C%20Makati&dest=14.619478,121.051057&name=Cubao%2C%20Quezon%20City';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots');

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const written = [];

async function capture(context, page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  written.push(name);
  console.log(`wrote docs/screenshots/${name}.png`);
}

/** Let fonts, webfonts and MapLibre tiles/fits settle before the capture. */
async function settle(page, ms = 2_500) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** Panel detent helper: expand/collapse the mobile bottom sheet. */
async function setPanelDetent(page, target) {
  const handle = page.locator('#biyahey-panel > button');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await page.locator('#biyahey-panel').boundingBox();
    const ratio = box === null ? 1 : box.height / 844;
    const current = ratio > 0.85 ? 'full' : ratio > 0.45 ? 'half' : 'peek';
    if (current === target) return;
    await handle.click();
    await page.waitForTimeout(450);
  }
}

// ---------------------------------------------------------------- mobile ----
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  timezoneId: 'Asia/Manila',
});
const page = await mobile.newPage();

// home.png — map-first home with the sheet at the half detent.
await page.goto(`${BASE}/`);
await settle(page, 4_000);
await setPanelDetent(page, 'half');
await page.waitForTimeout(500);
await capture(mobile, page, 'home');

// search-results.png — live MOTIS typeahead results for "Guadalupe".
await page.goto(`${BASE}/search`);
await settle(page, 1_200);
const placeInputs = page.locator('form[role="search"] input');
await placeInputs.nth(0).click();
await placeInputs.nth(0).fill('Guadalupe');
await page.waitForSelector('section[aria-label="Maghanap ng lugar"] li button', {
  timeout: 25_000,
});
await page.waitForTimeout(1_200);
await capture(mobile, page, 'search-results');

// route-options.png — the corridor's ranked cards over the route line.
await page.goto(`${BASE}${CORRIDOR}`);
await page.waitForSelector('ul[aria-label="Mga ruta"] li', { timeout: 30_000 });
await settle(page, 3_500);
await setPanelDetent(page, 'half');
await page.waitForTimeout(500);
await capture(mobile, page, 'route-options');

// trip-detail.png — open the trip from its card link (keeps the plan in cache).
await page.locator('ul[aria-label="Mga ruta"] li a[aria-label^="Tingnan ang detalye"]').first().click();
await page.waitForURL(/\/trip\/it-/, { timeout: 15_000 });
await settle(page, 2_500);
await setPanelDetent(page, 'full');
await page.waitForTimeout(500);
await capture(mobile, page, 'trip-detail');

// live-trip.png — the walkthrough with its honest no-live-data banner.
await page.locator('main a[href*="/live"]').first().click();
await page.waitForURL(/\/live/, { timeout: 15_000 });
await settle(page, 2_000);
await setPanelDetent(page, 'full');
await page.waitForTimeout(500);
await capture(mobile, page, 'live-trip');

// saved.png — save the trip, then list it under Saved.
await page.locator('main a[href*="/trip/"]').first().click();
await page.waitForURL(/\/trip\/it-[^/?]+/, { timeout: 15_000 });
await settle(page, 1_200);
await page.getByRole('button', { name: 'I-save', exact: true }).click();
await page.waitForTimeout(500);
await page.goto(`${BASE}/saved`);
await settle(page, 2_000);
await capture(mobile, page, 'saved');

// about-data.png — provenance from the live BFF /sources.
await page.goto(`${BASE}/sources`);
await settle(page, 2_500);
await capture(mobile, page, 'about-data');

await mobile.close();

// --------------------------------------------------------------- desktop ----
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  timezoneId: 'Asia/Manila',
});
const wide = await desktop.newPage();

await wide.goto(`${BASE}/`);
await settle(wide, 4_500);
await capture(desktop, wide, 'home-desktop');

await wide.goto(`${BASE}${CORRIDOR}`);
await wide.waitForSelector('ul[aria-label="Mga ruta"] li', { timeout: 30_000 });
await settle(wide, 4_000);
await capture(desktop, wide, 'route-options-desktop');

await desktop.close();
await browser.close();

console.log(`\n${written.length} screenshots written to ${OUT}`);
