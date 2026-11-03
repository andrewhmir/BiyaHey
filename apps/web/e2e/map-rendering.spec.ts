import { expect, test, type Page } from '@playwright/test';
import {
  MODE_COLOURS,
  cameraKey,
  countPlanRequests,
  expectDetailActionUnderSelectedCard,
  expectHealthy,
  legStripSegments,
  normaliseHex,
  openPlanWithMap,
  openRouteOptions,
  openSelectedTripDetail,
  readMap,
  readRouteMapState,
  requireMap,
  waitForDetailMap,
  waitForMapSources,
  waitForRenderedSelection,
  watchPageHealth,
} from './helpers/live';

/**
 * The "different paths" proof (design §2 map, §4.1, §10 acceptance 1/3).
 *
 * Everything is asserted against the DEV `window.__biyaheyMap` handle: the
 * selected itinerary must be drawn leg-by-leg in mode colours (`route-selected`
 * one feature per leg over the walk/ride layers), every alternative must be its
 * own path (`route-alternatives` one feature per non-selected itinerary), and a
 * card tap must change the drawn selection and re-fit the camera without a
 * refetch. The trip-detail map must then emphasise the focused leg.
 *
 * All three tests use the shared live corridor deep link from `helpers/live.ts`
 * (`/plan?from=…&dest=…&via=…`), the same R89 URL the directions form produces.
 */

const PLAN_LAYERS = [
  'route-selected-casing',
  'route-walk',
  'route-ride',
  'route-alt-casing',
  'route-alt-line',
  'route-transfers',
  'route-alt-hit',
  'route-leg-hit',
  'route-focus-halo',
  'route-focus-line',
] as const;

const PLAN_SOURCES = ['route-selected', 'route-alternatives', 'route-transfers'] as const;

/** The single aria-pressed card and its leg segments. */
async function pressedCard(page: Page) {
  const pressed = page.locator('[data-testid="route-card"][data-selected="true"]');
  await expect(pressed).toHaveCount(1);
  return pressed;
}

test('every alternative is its own path and the selected route is drawn leg by leg', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  const cards = await openRouteOptions(page);
  const count = await cards.count();
  // The live corridor returns several options; the differing-paths claim is
  // only meaningful with alternatives, so require at least one.
  expect(count, 'the live plan must return at least one alternative').toBeGreaterThanOrEqual(2);

  await waitForMapSources(page, PLAN_SOURCES);
  const state = await readRouteMapState(page);
  expect(state.routeCount).toBe(String(count));
  // `alternativeCount` is the number of *drawn* unique paths (MOTIS fan-out
  // duplicates collapse), so it is at most one less than the card count.
  expect(Number(state.alternativeCount)).toBeLessThanOrEqual(count - 1);
  expect(state.activeLeg).toBe('');

  const pressed = await pressedCard(page);
  const selectedSegments = await legStripSegments(pressed);
  expect(selectedSegments.length).toBeGreaterThanOrEqual(2);

  const facts = requireMap(
    await readMap(page, { layers: [...PLAN_LAYERS], sources: [...PLAN_SOURCES] }),
  );

  // The corridor is served by routed shapes: no leg may be a fallback chord drawn
  // as the selected path (the "straight line through buildings" defect).
  expect(facts.state.approximateLegs).toBe('0');

  // The selected itinerary is the leg-coloured path: one feature per leg, in
  // the card's leg order, with the documented mode palette — not a single
  // one-colour chord.
  expect(facts.features['route-selected']).toHaveLength(selectedSegments.length);
  facts.features['route-selected'].forEach((feature, index) => {
    const mode = String(feature.properties.mode ?? '');
    expect(mode, `route-selected feature ${index}`).toBe(selectedSegments[index]?.mode);
    expect(normaliseHex(feature.properties.colour)).toBe(MODE_COLOURS[mode]);
    expect(feature.pointCount).toBeGreaterThanOrEqual(2);
  });
  expect(selectedSegments.some((segment) => segment.mode === 'walk')).toBe(true);
  expect(selectedSegments.some((segment) => segment.mode !== 'walk')).toBe(true);

  // The walk legs and ride legs render through separate mode layers over a
  // white casing, and the transfer dots sit where legs meet.
  expect(facts.layerIds['route-selected-casing']).toBe(true);
  expect(facts.layerIds['route-walk']).toBe(true);
  expect(facts.layerIds['route-ride']).toBe(true);
  expect(facts.layerIds['route-transfers']).toBe(true);
  expect(facts.features['route-transfers']).toHaveLength(selectedSegments.length - 1);

  // Every alternative path is drawn as its own faded line with a real itinerary
  // id and hue. RoutePathLayer collapses physically identical MOTIS fan-out
  // duplicates into one path (so numbered markers never stack), so the number of
  // drawn paths is 1..count-1 and every path is a unique, non-selected id.
  const altFeatures = facts.features['route-alternatives'];
  expect(altFeatures.length).toBe(Number(state.alternativeCount));
  expect(altFeatures.length).toBeLessThanOrEqual(count - 1);
  // A fan-out plan can consist entirely of duplicate paths; then dedupe leaves
  // zero drawn alternatives. The alternative layers still exist (they are added
  // once and fed by setData), but draw nothing when the collection is empty.
  expect(facts.layerIds['route-alt-casing']).toBe(true);
  expect(facts.layerIds['route-alt-line']).toBe(true);
  expect(facts.layerIds['route-alt-hit']).toBe(true);
  const alternativeIds = new Set<string>();
  const knownColours = new Set(Object.values(MODE_COLOURS));
  for (const feature of altFeatures) {
    const id = String(feature.properties.itineraryId ?? '');
    expect(id.length).toBeGreaterThan(0);
    alternativeIds.add(id);
    expect(knownColours.has(normaliseHex(feature.properties.colour))).toBe(true);
    expect(feature.pointCount).toBeGreaterThanOrEqual(2);
  }
  expect(alternativeIds.size).toBe(altFeatures.length);

  // The shortlist keeps the focus layers mounted but empty (a leg-focus layer is
  // a detail-screen behaviour), and the camera has fitted the selected route.
  expect(facts.layerIds['route-focus-halo']).toBe(true);
  expect(facts.layerIds['route-leg-hit']).toBe(false);
  expect([facts.center[0], facts.center[1], facts.zoom]).not.toEqual([120.9842, 14.5995, 11]);

  expectHealthy(health);
});

test('selecting an alternative changes the drawn selection and re-fits the camera without refetching', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  const planRequests = countPlanRequests(page);

  const cards = await openRouteOptions(page);
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await waitForMapSources(page, PLAN_SOURCES);
  const requestBaseline = planRequests();

  const pressedBefore = await pressedCard(page);
  const beforeSegments = await legStripSegments(pressedBefore);
  const previousId = (await readRouteMapState(page)).selectedId;
  expect(previousId).not.toBe('');
  const beforeCamera = cameraKey(await readMap(page, {}));

  // Press the last card: it is a different itinerary (different legs), so the
  // drawn selection and the camera fit must both follow it.
  const target = cards.last();
  const targetSegments = await legStripSegments(target);
  await target.click();
  await expect(page.locator('[data-testid="route-card"][data-selected="true"]')).toHaveCount(1);
  await expect(target).toHaveAttribute('data-selected', 'true');
  await waitForRenderedSelection(page, previousId, targetSegments.length);

  const afterState = await readRouteMapState(page);
  expect(afterState.selectedId).not.toBe(previousId);
  // Selecting does not change how many alternatives exist, only which one is
  // drawn as the selected route.
  expect(Number(afterState.alternativeCount)).toBeLessThanOrEqual(count - 1);

  const afterFacts = requireMap(
    await readMap(page, { sources: [...PLAN_SOURCES] }),
  );
  expect(afterFacts.features['route-selected']).toHaveLength(targetSegments.length);
  afterFacts.features['route-selected'].forEach((feature, index) => {
    expect(String(feature.properties.mode ?? '')).toBe(targetSegments[index]?.mode);
  });
  if (beforeSegments.length !== targetSegments.length) {
    expect(afterFacts.features['route-selected']).toHaveLength(targetSegments.length);
  }
  // Alternatives are still drawn (the previous selection becomes one of them);
  // the source keeps one feature per unique physical path.
  const afterAlternatives = afterFacts.features['route-alternatives'];
  expect(afterAlternatives.length).toBe(Number(afterState.alternativeCount));
  expect(afterAlternatives.length).toBeLessThanOrEqual(count - 1);

  // Camera re-fit: fitBounds to the newly selected itinerary — unless the last
  // card is a duplicate fan-out of the same physical route, where the fit is
  // legitimately unchanged.
  const sameLegSequence =
    beforeSegments.length === targetSegments.length &&
    targetSegments.every((segment, index) => segment.mode === beforeSegments[index]?.mode);
  if (!sameLegSequence) {
    await expect
      .poll(async () => cameraKey(await readMap(page, {})), { timeout: 10_000 })
      .not.toBe(beforeCamera);
  }

  // Exactly one detail action, and it moved under the selected card; the
  // interaction caused no new plan request.
  await expectDetailActionUnderSelectedCard(page);
  expect(planRequests()).toBe(requestBaseline);

  expectHealthy(health);
});

test('trip detail emphasises the focused leg on the map and follows the strip rail', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  await openPlanWithMap(page);
  await openSelectedTripDetail(page);
  await waitForDetailMap(page);

  const legs = page.getByTestId('leg-row');
  const legCount = await legs.count();
  expect(legCount).toBeGreaterThanOrEqual(2);
  const segments = page.getByTestId('leg-strip-segment');
  await expect(segments).toHaveCount(legCount);

  // Whole route initially: every leg visible at full strength, no focus source.
  const initial = requireMap(
    await readMap(page, {
      layers: ['route-focus-halo', 'route-focus-line'],
      sources: ['route-focus'],
      paint: ['route-ride/line-opacity'],
    }),
  );
  expect(initial.state.activeLeg).toBe('');
  expect(initial.sourceIds['route-focus']).toBe(true);
  expect(initial.features['route-focus']).toHaveLength(0);
  expect(initial.layerIds['route-focus-halo']).toBe(true);
  expect(Number(initial.paint['route-ride/line-opacity'])).toBe(1);

  // Press the 2nd timeline row: it becomes the active step and the map isolates
  // its geometry, dimming the rest of the plan.
  await page.getByTestId('leg-focus').nth(1).click();
  await expect(page.getByTestId('route-map-state')).toHaveAttribute('data-active-leg', '1');
  await expect(legs.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(legs.nth(1)).toHaveAttribute('data-active', 'true');
  await expect(segments.nth(1)).toHaveAttribute('aria-pressed', 'true');
  // The focus source always exists; wait for the leg feature it now carries.
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus']
          .length,
      { timeout: 20_000 },
    )
    .toBe(1);

  const focused = requireMap(
    await readMap(page, {
      layers: ['route-focus-halo', 'route-focus-line'],
      sources: ['route-focus'],
      paint: ['route-ride/line-opacity'],
    }),
  );
  expect(focused.features['route-focus']).toHaveLength(1);
  expect(focused.features['route-focus'][0]?.properties.legIndex).toBe(1);
  expect(focused.features['route-focus'][0]?.pointCount).toBeGreaterThanOrEqual(2);
  expect(focused.layerIds['route-focus-halo']).toBe(true);
  expect(focused.layerIds['route-focus-line']).toBe(true);
  expect(Number(focused.paint['route-ride/line-opacity'])).toBeLessThan(1);

  // The strip rail is the same state: pressing segment 1 focuses the first leg.
  await segments.first().click();
  await expect(page.getByTestId('route-map-state')).toHaveAttribute('data-active-leg', '0');
  await expect(legs.first()).toHaveAttribute('aria-current', 'step');
  await expect(segments.first()).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus'][0]
          ?.properties.legIndex,
      { timeout: 10_000 },
    )
    .toBe(0);

  // Pressing the focused row again clears the focus: whole route, full opacity.
  await page.getByTestId('leg-focus').first().click();
  await expect(page.getByTestId('route-map-state')).toHaveAttribute('data-active-leg', '');
  await expect(legs.first()).not.toHaveAttribute('aria-current', 'step');
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus']
          .length,
      { timeout: 10_000 },
    )
    .toBe(0);
  const cleared = requireMap(
    await readMap(page, { paint: ['route-ride/line-opacity'] }),
  );
  expect(Number(cleared.paint['route-ride/line-opacity'])).toBe(1);

  expectHealthy(health);
});
