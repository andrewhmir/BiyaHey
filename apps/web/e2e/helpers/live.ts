import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared live-stack helpers for the UX v2 Playwright specs.
 *
 * Everything here is an assertion on real application state: the plan comes from
 * the running BFF (`:8787`), the map facts are read from the DEV-only
 * `window.__biyaheyMap` handle the app publishes, and the map source data is read
 * through MapLibre's own `serialize()` so the assertions describe what the app
 * actually drew rather than what a fixture claims.
 */

/** The live local BFF's plan endpoint prefix (`POST /plan`). */
const PLAN_PATH = '/plan';

/**
 * The corridor the whole UX v2 suite shares, expressed in the R89 URL contract:
 * Guadalupe, Makati → (via Ortigas, MRT-3 served stop) → Cubao, Quezon City.
 *
 * This is the exact hand-off `/search` produces for those three picks (captured
 * from a live form submission), which keeps the non-form specs fast and
 * deterministic while still being a real plan/deep-link a rider can share. The
 * directions form itself is exercised end-to-end by `plan-a-trip.spec.ts`.
 */
export const CORRIDOR_PLAN_PATH =
  '/plan?from=14.566719,121.04543799999999&fromName=Guadalupe%2C%20Makati' +
  '&dest=14.619477999999999,121.051057&name=Cubao%2C%20Quezon%20City' +
  '&via=%5B%7B%22lat%22%3A14.587340999999999%2C%22lon%22%3A121.05651900000001' +
  '%2C%22stopId%22%3A%22gtfs_rail-3%3Anode%3A5397307747%22%2C%22name%22%3A%22Ortigas%22%7D%5D';

/** `MapCanvas`'s initial camera before any route fit. */
export const MAP_DEFAULT_CENTER: readonly [number, number] = [120.9842, 14.5995];
export const MAP_DEFAULT_ZOOM = 11;

/**
 * The documented Kalsada mode palette (design §3.3 / `modeMeta.MODE_COLORS`).
 * The map feature assertions compare against this data contract, so a drift
 * between the ribbon, the timeline and the drawn line fails the spec.
 */
export const MODE_COLOURS: Readonly<Record<string, string>> = {
  walk: '#4c5b62',
  jeepney: '#0e7c7b',
  bus: '#b45309',
  mrt3: '#1f5fbf',
  lrt1: '#2e7d32',
  lrt2: '#7b1fa2',
  ferry: '#1565c0',
  'uv-express': '#c2410c',
  p2p: '#475569',
};

export interface PageHealth {
  consoleErrors: string[];
  pageErrors: string[];
}

/** Record browser console errors and uncaught page errors for the whole flow. */
export function watchPageHealth(page: Page): PageHealth {
  const health: PageHealth = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      health.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    health.pageErrors.push(String(error));
  });
  return health;
}

/** Fail the flow if the app logged a console error or threw an uncaught error. */
export function expectHealthy(health: PageHealth): void {
  expect(health.pageErrors, 'uncaught page errors').toEqual([]);
  expect(health.consoleErrors, 'browser console errors').toEqual([]);
}

/**
 * Count `POST /plan` requests. Returns a reader so a spec can snapshot the count
 * and prove a selection/filter interaction did not refetch.
 *
 * In dev, React StrictMode can issue two requests on first mount (the first
 * mount's query is torn down and re-run), so specs compare against the settled
 * baseline instead of hardcoding 1 — the production claim is "no request caused
 * by an interaction".
 */
export function countPlanRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes(PLAN_PATH)) {
      count += 1;
    }
  });
  return () => count;
}

/**
 * Drive the `/search` directions form exactly as a rider does: destination
 * first, then start, then an optional Ortigas via stop, then the CTA.
 */
export async function completeDirectionsForm(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Saan ka pupunta?' }).click();
  await expect(page).toHaveURL(/\/search$/);

  const toField = page.getByRole('searchbox', { name: /papunta sa/i });
  await expect(toField).toBeVisible();
  await toField.fill('Cubao');
  const toStops = page.getByTestId('search-group-stops');
  await expect(toStops).toBeVisible({ timeout: 30_000 });
  await toStops.getByRole('button').first().click();

  const fromField = page.getByRole('searchbox', { name: /mula sa/i });
  await fromField.fill('Guadalupe');
  const fromStops = page.getByTestId('search-group-stops');
  await expect(fromStops).toBeVisible({ timeout: 30_000 });
  await fromStops.getByRole('button').first().click();

  await page.getByRole('button', { name: /magdagdag ng hintuan/i }).click();
  const stopField = page.getByRole('searchbox', { name: /hintuan 1/i });
  await expect(stopField).toBeVisible();
  await stopField.fill('Ortigas');
  const viaStops = page.getByTestId('search-group-stops');
  await expect(viaStops).toBeVisible({ timeout: 30_000 });
  await viaStops.getByRole('button').first().click();

  await page.getByRole('button', { name: 'Maghanap ng ruta' }).click();
  await expect(page).toHaveURL(/\/plan\?/);
  await expect(page).toHaveURL(/[?&]from=/);
  await expect(page).toHaveURL(/[?&]dest=/);
  await expect(page).toHaveURL(/[?&]via=/);
  await expect(page.getByTestId('route-card').first()).toBeVisible({ timeout: 45_000 });
}

/** Open `/plan` through the shared corridor deep link (a real R89 URL). */
export async function openRouteOptions(page: Page): Promise<Locator> {
  await page.goto(CORRIDOR_PLAN_PATH);
  await expect(page).toHaveURL(/\/plan\?/);
  const cards = page.getByTestId('route-card');
  await expect(cards.first()).toBeVisible({ timeout: 45_000 });
  return cards;
}

/**
 * Open `/plan` through the corridor deep link and wait for its map before a
 * spec navigates on to the trip detail. Letting the shortlist's MapLibre
 * instance finish its style load first mirrors what a rider does and avoids
 * tearing an instance down mid-load right before the detail map mounts.
 */
export async function openPlanWithMap(page: Page): Promise<Locator> {
  const cards = await openRouteOptions(page);
  await waitForMapSources(page, ['route-selected', 'route-transfers']);
  return cards;
}

/**
 * The single v2 detail action must live in the list item of the pressed card:
 * the DOM is `li > [RouteCard div + button[route-detail-action]]`, so the action
 * is the card wrapper's sibling, not its descendant.
 */
export async function expectDetailActionUnderSelectedCard(page: Page): Promise<void> {
  await expect(page.getByTestId('route-detail-action')).toHaveCount(1);
  const item = page
    .locator('li')
    .filter({ has: page.locator('[data-testid="route-card"][data-selected="true"]') });
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('route-detail-action')).toHaveCount(1);
}

export interface LegSegmentFact {
  mode: string;
  minutes: number;
  index: number;
}

/** Read one leg strip's segments (mode / minutes / DOM order). */
export async function legStripSegments(card: Locator): Promise<LegSegmentFact[]> {
  return card.getByTestId('leg-strip-segment').evaluateAll((nodes) =>
    nodes.map((node) => ({
      mode: node.getAttribute('data-mode') ?? '',
      minutes: Number(node.getAttribute('data-minutes')),
      index: Number(node.getAttribute('data-index')),
    })),
  );
}

export interface MapFeatureFact {
  properties: Record<string, unknown>;
  pointCount: number;
  firstCoordinate: [number, number] | null;
}

export interface MapFacts {
  layerIds: Record<string, boolean>;
  sourceIds: Record<string, boolean>;
  features: Record<string, MapFeatureFact[]>;
  center: [number, number];
  zoom: number;
  paint: Record<string, unknown>;
  state: {
    selectedId: string;
    activeLeg: string;
    alternativeCount: string;
    routeCount: string;
  };
}

interface ReadMapOptions {
  layers?: readonly string[];
  sources?: readonly string[];
  /** `<layer>/<paintProperty>` pairs to read back (e.g. dim opacity). */
  paint?: readonly string[];
}

interface MapLike {
  isStyleLoaded(): boolean;
  getSource(id: string): { serialize?: () => unknown } | undefined;
  getLayer(id: string): unknown;
  getCenter(): { toArray(): number[] };
  getZoom(): number;
  getPaintProperty(layer: string, property: string): unknown;
}

/** Wait until the live map is style-ready and owns every requested source. */
export async function waitForMapSources(
  page: Page,
  sourceIds: readonly string[],
  timeout = 60_000,
): Promise<void> {
  await page.waitForFunction(
    (ids) => {
      const map = (window as unknown as { __biyaheyMap?: MapLike }).__biyaheyMap;
      return Boolean(
        map && ids.every((id) => Boolean(map.getSource(id))),
      );
    },
    [...sourceIds],
    { timeout },
  );
}

/** True when the live map currently owns the source (a real layer teardown check). */
export async function mapHasSource(page: Page, sourceId: string): Promise<boolean> {
  const facts = await readMap(page, { sources: [sourceId] });
  return facts?.sourceIds[sourceId] === true;
}

/**
 * Read the live map's layers, sources, selected/alternative GeoJSON payloads,
 * camera and paint properties in a single browser round-trip.
 */
export async function readMap(page: Page, options: ReadMapOptions = {}): Promise<MapFacts | null> {
  const layers = [...(options.layers ?? [])];
  const sources = [...(options.sources ?? [])];
  const paint = [...(options.paint ?? [])];
  return page.evaluate(
    ({ layerIds, sourceIds, paintKeys }) => {
      const map = (window as unknown as { __biyaheyMap?: MapLike }).__biyaheyMap;
      if (!map) return null;

      const featuresOf = (sourceId: string) => {
        const source = map.getSource(sourceId);
        const serialized = source?.serialize?.();
        if (serialized === null || serialized === undefined || typeof serialized !== 'object') {
          return [];
        }
        const candidate = serialized as { data?: unknown; features?: unknown };
        const data = candidate.data !== undefined ? candidate.data : candidate;
        const features = (data as { features?: unknown }).features;
        if (!Array.isArray(features)) return [];
        return features.map((feature) => {
          const typed = feature as {
            properties?: Record<string, unknown>;
            geometry?: { coordinates?: unknown };
          };
          const geometry = typed.geometry;
          const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
          const first = coordinates.length > 0 ? coordinates[0] : null;
          return {
            properties: typed.properties ?? {},
            pointCount: coordinates.length,
            firstCoordinate:
              Array.isArray(first) && first.length >= 2
                ? ([Number(first[0]), Number(first[1])] as [number, number])
                : null,
          };
        });
      };

      const layerPresence: Record<string, boolean> = {};
      for (const id of layerIds) layerPresence[id] = Boolean(map.getLayer(id));
      const sourcePresence: Record<string, boolean> = {};
      const featurePayloads: Record<string, MapFeatureFact[]> = {};
      for (const id of sourceIds) {
        sourcePresence[id] = Boolean(map.getSource(id));
        featurePayloads[id] = featuresOf(id);
      }
      const center = map.getCenter().toArray();
      const paintValues: Record<string, unknown> = {};
      for (const key of paintKeys) {
        const separator = key.indexOf('/');
        const layer = key.slice(0, separator);
        const property = key.slice(separator + 1);
        paintValues[key] = map.getPaintProperty(layer, property);
      }
      const stateNode = document.querySelector('[data-testid="route-map-state"]');
      return {
        layerIds: layerPresence,
        sourceIds: sourcePresence,
        features: featurePayloads,
        center: [Number(center[0]?.toFixed(5)), Number(center[1]?.toFixed(5))] as [number, number],
        zoom: Number(map.getZoom().toFixed(4)),
        paint: paintValues,
        state: {
          selectedId: stateNode?.getAttribute('data-selected-id') ?? '',
          activeLeg: stateNode?.getAttribute('data-active-leg') ?? '',
          alternativeCount: stateNode?.getAttribute('data-alternative-count') ?? '',
          routeCount: stateNode?.getAttribute('data-route-count') ?? '',
        },
      };
    },
    { layerIds: layers, sourceIds: sources, paintKeys: paint },
  );
}

/** The `route-map-state` mirror the map layer renders for testability. */
export async function readRouteMapState(page: Page): Promise<{
  selectedId: string;
  activeLeg: string;
  alternativeCount: string;
  routeCount: string;
}> {
  const node = page.getByTestId('route-map-state');
  await expect(node).toBeAttached();
  return {
    selectedId: (await node.getAttribute('data-selected-id')) ?? '',
    activeLeg: (await node.getAttribute('data-active-leg')) ?? '',
    alternativeCount: (await node.getAttribute('data-alternative-count')) ?? '',
    routeCount: (await node.getAttribute('data-route-count')) ?? '',
  };
}

/**
 * Wait until the map has re-rendered the selected itinerary with exactly
 * `expectedFeatureCount` leg features *and* the selected id changed.
 */
export async function waitForRenderedSelection(
  page: Page,
  previousSelectedId: string,
  expectedFeatureCount: number,
): Promise<void> {
  await page.waitForFunction(
    ({ previousId, expectedCount }) => {
      const map = (window as unknown as { __biyaheyMap?: MapLike }).__biyaheyMap;
      const stateNode = document.querySelector('[data-testid="route-map-state"]');
      const selectedId = stateNode?.getAttribute('data-selected-id') ?? '';
      if (!map || selectedId.length === 0 || selectedId === previousId) return false;
      const source = map.getSource('route-selected');
      const serialized = source?.serialize?.();
      if (serialized === null || serialized === undefined || typeof serialized !== 'object') {
        return false;
      }
      const candidate = serialized as { data?: unknown; features?: unknown };
      const data = candidate.data !== undefined ? candidate.data : candidate;
      const features = (data as { features?: unknown }).features;
      return Array.isArray(features) && features.length === expectedCount;
    },
    { previousId: previousSelectedId, expectedCount: expectedFeatureCount },
    { timeout: 20_000 },
  );
}

/** Camera identity used to prove a selection re-fit the map. */
export function cameraKey(facts: MapFacts | null): string {
  return facts === null ? 'no-map' : `${facts.center[0]},${facts.center[1]}@${facts.zoom}`;
}

/** Assert the DEV map handle is mounted and return its facts. */
export function requireMap(facts: MapFacts | null): MapFacts {
  if (facts === null) {
    throw new Error('the DEV MapLibre handle (window.__biyaheyMap) is not mounted');
  }
  return facts;
}

/** The active itinerary card's fare text (asserted against the trip detail). */
export async function selectedCardFare(page: Page): Promise<string> {
  const card = page.locator('[data-testid="route-card"][data-selected="true"]');
  await expect(card).toHaveCount(1);
  return (await card.getByTestId('fare-amount').textContent()) ?? '';
}

/** Open the selected itinerary's detail screen through the single v2 action. */
export async function openSelectedTripDetail(page: Page): Promise<void> {
  await expect(page.getByTestId('route-detail-action')).toHaveCount(1);
  await page.getByTestId('route-detail-action').click();
  await expect(page).toHaveURL(/\/trip\/[^/]+$/);
  await expect(page.getByTestId('trip-header')).toBeVisible();
  await expect(page.getByTestId('trip-map')).toBeVisible();
}

/**
 * Wait for the trip-detail map. The detail screen mounts a second MapLibre
 * instance, so its style fetch can be slower than the shortlist's; allow more
 * than the default before failing.
 */
export async function waitForDetailMap(page: Page): Promise<void> {
  // Sources are `route-selected` / `route-transfers`; `route-leg-hit` is a
  // LAYER on the selected source (it was previously polled as a source, so the
  // wait could never satisfy).
  await waitForMapSources(page, ['route-selected', 'route-transfers'], 120_000);
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __biyaheyMap?: MapLike }).__biyaheyMap;
      return Boolean(map && map.getLayer('route-leg-hit'));
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Scale a CSS colour to lower-case hex for palette comparisons. */
export function normaliseHex(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
