import { expect, test } from '@playwright/test';

/**
 * Browser-level service-worker, offline and installability proof (Task 10 / I3).
 *
 * Runs only against the **built** app served by `vite preview` (the `preview`
 * project in `playwright.config.ts`): the Vite dev server does not register the
 * generated Workbox worker, so a dev-server test would prove nothing about
 * offline. `npm run test:e2e` builds first, so the server always describes the
 * current tree.
 *
 * Task 8 unit-tested the Workbox rules and the saved-store offline read; its
 * report handed the real-browser check to Task 10. This spec closes that gap:
 *
 * 1. the web app manifest is linked and served with installability fields;
 * 2. `navigator.serviceWorker.ready` resolves (install + precache + activate);
 * 3. a saved trip seeded into the real `biyahey:v1:saved-trips` envelope
 *    renders after an **offline reload** of `/saved`, with the offline badge,
 *    the "Saved route (no live data)" ETA label and the staleness stamp;
 * 4. the emitted MapLibre worker module is served as JavaScript from its
 *    hashed `/assets/` URL — asserted by content type and URL, not by status
 *    alone, because `vite preview` answers a missing asset with the SPA
 *    fallback (`200 text/html`) and would otherwise pass on the very failure
 *    the test exists to catch.
 *
 * The trip is seeded instead of driven through the live `/plan` + Save flow on
 * purpose: this project's preview build talks to the BFF on :8787, but the
 * offline claim must not depend on live feed data or a running API. The
 * seed uses the exact production row shape and envelope the trip-detail Save
 * writes (`lib/savedTripsStore.ts` / `lib/deviceStore.ts`).
 */

const SAVED_TRIPS_KEY = 'biyahey:v1:saved-trips';

const OSM_SOURCE = {
  id: 'osm',
  name: 'OpenStreetMap PH extract',
  publisher: 'OSM contributors / Geofabrik',
  url: 'https://download.geofabrik.de/asia/philippines.html',
  licence_spdx: 'ODbL-1.0',
  licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  coverage: 'Philippines — Geofabrik PH extract (NCR + belt for v1)',
  last_checked: '2026-11-01',
  attribution: '© OpenStreetMap contributors — data available under the ODbL 1.0',
  used_for: ['roads'],
};

const FARE_SNAPSHOT = {
  amount: 15,
  currency: 'PHP',
  confidence: 'official',
  effective_from: '2026-09-28',
  source_id: 'ltfrb-fares',
  breakdown: [{ label: 'Jeepney', amount: 15 }],
};

const SAVED_TRIP = {
  itinerary: {
    id: 'e2e-offline-trip',
    durationMin: 32,
    startTime: '2026-11-01T08:00:00+08:00',
    endTime: '2026-11-01T08:32:00+08:00',
    transfers: 0,
    walkDistanceM: 200,
    modes: ['walk', 'jeepney'],
    sources: ['osm'],
    fare: FARE_SNAPSHOT,
    legs: [
      {
        mode: 'walk',
        from: { name: 'Buendia', lat: 14.5547, lon: 121.0244 },
        to: { name: 'MRT Buendia', lat: 14.5549, lon: 121.0281 },
        startTime: '2026-11-01T08:00:00+08:00',
        endTime: '2026-11-01T08:05:00+08:00',
        durationMin: 5,
        distanceM: 200,
        landmarkHint: null,
        sourceIds: ['osm'],
      },
      {
        mode: 'jeepney',
        from: { name: 'MRT Buendia', lat: 14.5549, lon: 121.0281 },
        to: { name: 'Cubao', lat: 14.6194, lon: 121.0531 },
        startTime: '2026-11-01T08:05:00+08:00',
        endTime: '2026-11-01T08:32:00+08:00',
        durationMin: 27,
        distanceM: 1200,
        routeShortName: 'T320',
        landmarkHint: 'Look for: the MRT-3 Cubao station on EDSA.',
        sourceIds: ['osm'],
      },
    ],
  },
  sources: [OSM_SOURCE],
  fareSnapshot: FARE_SNAPSHOT,
  datasetVersion: '2026-11-01',
};

interface WebManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  icons?: { sizes?: string; type?: string; purpose?: string }[];
}

test('built app serves the manifest and renders a saved trip after an offline reload', async ({
  page,
  context,
}) => {
  // Seed the real device record before any app code runs, and before the first
  // navigation. The store's own read path validates this row; a malformed seed
  // would render an empty list instead of the assertions below.
  const savedAt = new Date().toISOString();
  await context.addInitScript(
    ({ key, value }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value);
      }
    },
    {
      key: SAVED_TRIPS_KEY,
      value: JSON.stringify({ v: 1, data: [{ ...SAVED_TRIP, savedAt }] }),
    },
  );

  await page.goto('/saved');
  await expect(page.getByTestId('saved-row').first()).toBeVisible();
  await expect(page.getByTestId('saved-fare').first()).toContainText('₱');

  // Installability evidence: the built HTML links a manifest that the preview
  // server actually serves, with the fields Chrome's install criteria read.
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  if (manifestHref === null) {
    throw new Error('the built app does not link a web app manifest');
  }
  expect(manifestHref).toMatch(/manifest\.webmanifest$/);
  const manifestResponse = await page.request.get(new URL(manifestHref, page.url()).href);
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as WebManifest;
  expect(manifest.name).toBe('BiyaHey! — Philippine commute planner');
  expect(manifest.short_name).toBe('BiyaHey!');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons?.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  // `ready` resolves only after the Workbox install has precached the shell and
  // the worker is active. The reload then makes this document controlled (the
  // first load that registers a worker is not controlled by it).
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page.getByTestId('saved-row').first()).toBeVisible();

  // The actual offline claim: reload `/saved` with the network cut. The shell
  // is served from precache; the saved row and its honest offline labels come
  // from localStorage, not from a cached API response.
  await context.setOffline(true);
  try {
    await page.reload();

    await expect(page.getByTestId('offline-badge')).toBeVisible();
    const row = page.getByTestId('saved-row').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('saved-fare')).toContainText('₱');
    // The ETA must be labelled as a saved snapshot, never as live data.
    await expect(row.getByTestId('saved-eta')).toContainText('Saved route (no live data)');
    // Offline the matrix date is unknown, so the row must say the fare may have
    // changed rather than certify it fresh.
    await expect(row.getByTestId('fare-staleness')).toHaveText(
      /Fare may have changed since you saved this\./,
    );
  } finally {
    await context.setOffline(false);
  }
});

interface WorkerResponse {
  status: number;
  contentType: string;
  url: string;
}

/** The emitted hashed module, e.g. `/assets/maplibre-gl-worker-CMkqA50c.mjs`. */
const EMITTED_WORKER_URL = /\/assets\/maplibre-gl-worker-[\w-]+\.mjs$/;

/** A JavaScript content type; `text/javascript` in the served preview build. */
const JAVASCRIPT_CONTENT_TYPE = /^(?:text|application)\/javascript\b/;

test('the built app serves the MapLibre worker asset', async ({ page }) => {
  // Regression guard for a production-only failure found while measuring the
  // tile budget: MapLibre v6 builds its worker URL with a runtime `new URL()`
  // that Vite cannot statically follow. The build emitted no
  // `assets/maplibre-gl-worker-*.mjs` and `vite preview` answered the request
  // with index.html, so the built map fetched zero tiles while the dev server
  // worked. `MapCanvas` now imports the packaged worker with `?url` and calls
  // `setWorkerUrl()`; this test proves the emitted asset is actually served.
  //
  // Status alone is not enough: the preview server's SPA fallback answers a
  // *missing* `.mjs` with `200 text/html`, which is exactly the original
  // defect. The response must therefore be JavaScript from the emitted,
  // hashed `/assets/` path — and the body is fetched independently to prove
  // it is the module, not the HTML shell.
  const workerResponses: WorkerResponse[] = [];
  page.on('response', (response) => {
    if (/maplibre-gl-worker[^/]*\.mjs/.test(response.url())) {
      workerResponses.push({
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        url: response.url(),
      });
    }
  });

  await page.goto('/');
  // The canvas only mounts after the lazy MapLibre chunk resolves; the worker
  // is requested at that point even if the external tile host is slow.
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  await expect.poll(() => workerResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);

  for (const response of workerResponses) {
    expect(response.status).toBe(200);
    expect(response.contentType).toMatch(JAVASCRIPT_CONTENT_TYPE);
    expect(response.url).toMatch(EMITTED_WORKER_URL);
  }

  const workerUrl = workerResponses.find((response) => EMITTED_WORKER_URL.test(response.url))?.url;
  if (workerUrl === undefined) {
    throw new Error(
      `the page never requested an emitted MapLibre worker module: ${workerResponses
        .map((response) => response.url)
        .join(', ')}`,
    );
  }

  // Independent fetch of the same URL: the SPA fallback answers 200 here too,
  // so the body is what separates the worker module from `index.html`.
  const workerResponse = await page.request.get(workerUrl);
  expect(workerResponse.status()).toBe(200);
  expect(workerResponse.headers()['content-type']).toMatch(JAVASCRIPT_CONTENT_TYPE);
  const workerBody = await workerResponse.text();
  expect(workerBody).not.toMatch(/^\s*<!doctype html/i);
  expect(workerBody).toMatch(/maplibre/i);
});
