import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  MODE_COLOURS,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  cameraKey,
  completeDirectionsForm,
  countPlanRequests,
  expectDetailActionUnderSelectedCard,
  expectHealthy,
  legStripSegments,
  normaliseHex,
  openSelectedTripDetail,
  readMap,
  readRouteMapState,
  requireMap,
  selectedCardFare,
  waitForDetailMap,
  waitForMapSources,
  waitForRenderedSelection,
  watchPageHealth,
} from './helpers/live';

/**
 * The phase-2 acceptance flow (R89), updated for UX v2 — run against the real
 * local BFF, router and MapLibre basemap.
 *
 *   Home pill → `/search` directions form (To Cubao → From Guadalupe → via
 *   Ortigas) → `/plan` fare-forward cards + leg strips + drawn alternatives →
 *   `route-detail-action` → trip detail with its real map → leg focus changes
 *   the emphasised map leg → save → `/saved` (endpoint title, snapshot reopen)
 *   → `/sources`.
 *
 * Determinism: every wait is an assertion (Playwright auto-wait, `expect.poll`
 * or `waitForFunction` on `window.__biyaheyMap` state); there are no fixed
 * sleeps. The spec tolerates the live 1–5 returned options and never invents a
 * fare or attribution (R41/R45): fares, ETAs and effectivity dates are compared
 * against what the API sent and what the previous screen rendered.
 */

const PLAN_LAYERS = [
  'route-selected-casing',
  'route-walk',
  'route-ride',
  'route-alt-casing',
  'route-alt-line',
  'route-transfers',
  'route-alt-hit',
  // Shortlist (not detail) map: no leg hit lines and no leg-focus layers yet.
  'route-leg-hit',
  'route-focus-halo',
  'route-focus-line',
] as const;

const PLAN_SOURCES = ['route-selected', 'route-alternatives', 'route-transfers'] as const;

const DETAIL_LAYERS = [
  'route-selected-casing',
  'route-walk',
  'route-ride',
  'route-transfers',
  'route-leg-hit',
  'route-alt-line',
] as const;

const FOCUS_LAYERS = ['route-focus-halo', 'route-focus-line'] as const;

/** The single aria-pressed card — the itinerary the map is emphasising. */
async function selectedCard(page: Page): Promise<Locator> {
  const cards = page.locator('[data-testid="route-card"][data-selected="true"]');
  await expect(cards).toHaveCount(1);
  return cards;
}

test('directions form → route options → trip detail map + leg focus → save → saved → sources', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  const planRequests = countPlanRequests(page);

  // 1. The directions form owns the trip and hands it to /plan through the URL
  //    contract (asserted inside the helper: /plan?from=…&dest=…&via=…).
  await completeDirectionsForm(page);

  // 2. Every returned card is the v2 anatomy: ETA, badge, fare, provenance
  //    date and a leg strip whose segments match the itinerary's legs.
  const cards = page.getByTestId('route-card');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(5);

  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    await expect(card.getByTestId('fare-amount')).toContainText('₱');
    // m9: match the ETA element itself, not any "min" substring in the card.
    await expect(card.getByTestId('route-eta')).toHaveText(/^\d+ min$/);
    // Every displayed fare carries its effectivity date (global constraint).
    await expect(card.getByTestId('fare-date')).toContainText(/effective \d{4}-\d{2}-\d{2}/);

    const strip = card.getByTestId('leg-strip');
    await expect(strip).toHaveCount(1);
    const legCount = Number(await strip.getAttribute('data-leg-count'));
    expect(legCount).toBeGreaterThanOrEqual(1);
    const segments = await legStripSegments(card);
    expect(segments).toHaveLength(legCount);
    segments.forEach((segment, segmentIndex) => {
      expect(MODE_COLOURS[segment.mode], `leg ${segmentIndex} mode "${segment.mode}"`).toBeDefined();
      expect(segment.minutes).toBeGreaterThan(0);
      expect(segment.index).toBe(segmentIndex);
    });
  }

  // 3. Selection is a single aria-pressed card, and the one detail action sits
  //    directly under it (v1's per-card `trip-open` is retired).
  await expect(page.locator('[data-testid="route-card"][data-selected="true"]')).toHaveCount(1);
  const leadCard = await selectedCard(page);
  await expectDetailActionUnderSelectedCard(page);

  // 4. The hidden mirror and the real MapLibre map agree with the cards.
  const initialState = await readRouteMapState(page);
  expect(initialState.routeCount).toBe(String(count));
  // Drawn alternatives are unique physical paths, so duplicate fan-out routes
  // collapse: at most one less than the card count.
  expect(Number(initialState.alternativeCount)).toBeLessThanOrEqual(Math.max(0, count - 1));
  expect(initialState.activeLeg).toBe('');
  expect(initialState.selectedId).not.toBe('');

  await waitForMapSources(page, PLAN_SOURCES);
  const planMap = requireMap(
    await readMap(page, {
      layers: [...PLAN_LAYERS],
      sources: [...PLAN_SOURCES],
    }),
  );
  expect(planMap.layerIds['route-selected-casing']).toBe(true);
  expect(planMap.layerIds['route-walk']).toBe(true);
  expect(planMap.layerIds['route-ride']).toBe(true);
  expect(planMap.layerIds['route-transfers']).toBe(true);
  expect(planMap.layerIds['route-leg-hit']).toBe(false);
  // Focus layers stay mounted on the shortlist but carry no feature until a leg
  // is focused (the detail screen owns that interaction).
  expect(planMap.layerIds['route-focus-halo']).toBe(true);
  expect(planMap.layerIds['route-focus-line']).toBe(true);
  if (count > 1) {
    // Alternatives are drawn one feature per *unique physical path*:
    // RoutePathLayer collapses MOTIS fan-out duplicates (the same corridor
    // returned under different itinerary ids) so numbered markers never stack.
    // The live corridor therefore draws fewer paths than cards while still
    // proving alternatives exist — every drawn path is a real non-selected id.
    const altFeatures = planMap.features['route-alternatives'];
    expect(altFeatures.length).toBe(Number(planMap.state.alternativeCount));
    expect(altFeatures.length).toBeLessThanOrEqual(count - 1);
    const alternativeIds = new Set(
      altFeatures.map((feature) => String(feature.properties.itineraryId ?? '')),
    );
    expect(alternativeIds.size).toBe(altFeatures.length);
    expect(planMap.layerIds['route-alt-casing']).toBe(true);
    expect(planMap.layerIds['route-alt-line']).toBe(true);
    expect(planMap.layerIds['route-alt-hit']).toBe(true);
  }

  // 5. The selected itinerary is drawn **leg by leg** in mode colours: one
  //    feature per leg, in card order, with the documented palette.
  const leadSegments = await legStripSegments(leadCard);
  expect(planMap.features['route-selected']).toHaveLength(leadSegments.length);
  expect(leadSegments.length).toBeGreaterThanOrEqual(2);
  planMap.features['route-selected'].forEach((feature, index) => {
    const mode = String(feature.properties.mode ?? '');
    expect(mode).toBe(leadSegments[index]?.mode);
    expect(normaliseHex(feature.properties.colour)).toBe(MODE_COLOURS[mode]);
  });
  expect(leadSegments.some((segment) => segment.mode === 'walk')).toBe(true);
  expect(leadSegments.some((segment) => segment.mode !== 'walk')).toBe(true);
  expect(planMap.features['route-transfers']).toHaveLength(leadSegments.length - 1);

  // The camera fitted the returned plan instead of leaving the app's default
  // Manila view.
  expect(
    planMap.center[0] !== MAP_DEFAULT_CENTER[0] ||
      planMap.center[1] !== MAP_DEFAULT_CENTER[1] ||
      planMap.zoom !== MAP_DEFAULT_ZOOM,
  ).toBe(true);

  // 6. Selecting another card re-emphasises the map and re-fits the camera —
  //    without a second /plan request (the filter/selection is local state).
  const requestBaseline = planRequests();
  if (count > 1) {
    const targetIndex = count - 1;
    const targetCard = cards.nth(targetIndex);
    const targetSegments = await legStripSegments(targetCard);
    const previousId = (await readRouteMapState(page)).selectedId;
    const beforeCamera = cameraKey(await readMap(page, {}));

    await targetCard.click();
    await expect(page.locator('[data-testid="route-card"][data-selected="true"]')).toHaveCount(1);
    await expect(targetCard).toHaveAttribute('data-selected', 'true');
    await waitForRenderedSelection(page, previousId, targetSegments.length);

    const selectedState = await readRouteMapState(page);
    expect(selectedState.selectedId).not.toBe(previousId);
    expect(Number(selectedState.alternativeCount)).toBeLessThanOrEqual(count - 1);

    // The map now draws the pressed card's legs, and the camera moved — unless
    // the second card is a duplicate fan-out of the same physical route, in
    // which case the geometry (and therefore the fit) is legitimately identical.
    const selectedMap = requireMap(await readMap(page, { sources: ['route-selected'] }));
    expect(selectedMap.features['route-selected']).toHaveLength(targetSegments.length);
    selectedMap.features['route-selected'].forEach((feature, index) => {
      expect(String(feature.properties.mode ?? '')).toBe(targetSegments[index]?.mode);
    });
    const sameLegSequence =
      leadSegments.length === targetSegments.length &&
      targetSegments.every(
        (segment, index) => segment.mode === leadSegments[index]?.mode,
      );
    if (!sameLegSequence) {
      await expect
        .poll(async () => cameraKey(await readMap(page, {})), { timeout: 10_000 })
        .not.toBe(beforeCamera);
    }

    // The detail action followed the selection, and no refetch happened.
    await expectDetailActionUnderSelectedCard(page);
    expect(planRequests()).toBe(requestBaseline);
  }

  // 7. Detail hand-off. The trip header, map header, summary and fare are all
  //    the selected itinerary the API returned.
  const selectedFare = (await selectedCardFare(page)).trim();
  await openSelectedTripDetail(page);
  await expect(page.getByTestId('trip-map').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('trip-summary')).toContainText(/\d+ min/);
  // UX v2 prints Philippine 12-hour clock times (`dating 5:39 PM`).
  await expect(page.getByTestId('trip-summary')).toContainText(/\d{1,2}:\d{2} (AM|PM)/);
  await expect(page.getByTestId('fare-total')).toHaveText(selectedFare);
  await expect(page.getByTestId('start-trip')).toHaveText('Simulan ang biyahe');

  await waitForDetailMap(page);
  const legs = page.getByTestId('leg-row');
  const legCount = await legs.count();
  expect(legCount).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('leg-strip-segment')).toHaveCount(legCount);

  const detailMap = requireMap(
    await readMap(page, {
      layers: [...DETAIL_LAYERS, ...FOCUS_LAYERS],
      sources: ['route-selected', 'route-transfers'],
      paint: ['route-ride/line-opacity'],
    }),
  );
  expect(detailMap.features['route-selected']).toHaveLength(legCount);
  expect(detailMap.layerIds['route-ride']).toBe(true);
  expect(detailMap.layerIds['route-walk']).toBe(true);
  // Detail draws one itinerary only: the alternative layers exist but their
  // source is empty.
  expect(detailMap.layerIds['route-alt-line']).toBe(true);
  expect(detailMap.features['route-transfers']).toHaveLength(legCount - 1);
  // Whole-route emphasis before a leg is focused.
  expect(detailMap.state.activeLeg).toBe('');
  expect(detailMap.layerIds['route-focus-halo']).toBe(true);
  expect(Number(detailMap.paint['route-ride/line-opacity'])).toBe(1);

  // 8. Signage is on the ride legs (v2 drops the invented landmark fallback).
  const signage = page.getByTestId('signage-plate').first();
  await expect(signage).toBeVisible();
  await expect(signage).toContainText('Hanapin');
  expect(((await signage.textContent()) ?? '').trim().length).toBeGreaterThan('Hanapin'.length);

  // 9. Leg focus: the timeline row, the strip rail and the map share one state.
  const focusButtons = page.getByTestId('leg-focus');
  await expect(focusButtons).toHaveCount(legCount);
  await focusButtons.nth(1).click();
  await expect(page.getByTestId('route-map-state')).toHaveAttribute('data-active-leg', '1');
  await expect(legs.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('leg-strip-segment').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus']
          .length,
      { timeout: 20_000 },
    )
    .toBe(1);
  const focusedMap = requireMap(
    await readMap(page, {
      layers: [...FOCUS_LAYERS],
      sources: ['route-focus'],
      paint: ['route-ride/line-opacity'],
    }),
  );
  expect(focusedMap.features['route-focus']).toHaveLength(1);
  expect(focusedMap.features['route-focus'][0]?.properties.legIndex).toBe(1);
  expect(focusedMap.features['route-focus'][0]?.pointCount).toBeGreaterThanOrEqual(2);
  expect(focusedMap.layerIds['route-focus-halo']).toBe(true);
  // The rest of the plan dims while one leg is emphasised.
  expect(Number(focusedMap.paint['route-ride/line-opacity'])).toBeLessThan(1);

  // The strip segment switches the focused leg too (map ↔ rail sync).
  await page.getByTestId('leg-strip-segment').first().click();
  await expect(page.getByTestId('route-map-state')).toHaveAttribute('data-active-leg', '0');
  await expect(legs.first()).toHaveAttribute('aria-current', 'step');
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus'][0]
          ?.properties.legIndex,
      { timeout: 10_000 },
    )
    .toBe(0);

  // 10. Stops expander (v2 copy) and the fare breakdown with its source rows.
  const showStops = page.getByRole('button', { name: /ipakita ang \d+ hintuan/i });
  await expect(showStops.first()).toBeVisible();
  await showStops.first().click();
  const hideStops = page.getByRole('button', { name: /itago ang \d+ hintuan/i });
  await expect(hideStops.first()).toBeVisible();
  await hideStops.first().click();
  await expect(showStops.first()).toBeVisible();

  await expect(page.getByTestId('fare-breakdown')).toBeVisible();
  await expect(page.getByTestId('fare-line').first()).toBeVisible();
  await expect(page.getByTestId('fare-breakdown-total')).toContainText('₱');
  await expect(page.getByTestId('fare-breakdown-total')).toContainText(
    selectedFare.replace('₱', ''),
  );
  await expect(page.getByTestId('fare-source-link').first()).toBeVisible();

  // 11. Save → the offline-first `/saved` list (reload: the plan cache is gone,
  // so the row proves the persisted snapshot).
  await expect(page.getByTestId('save-trip')).toHaveText('I-save');
  await page.getByTestId('save-trip').click();
  await expect(page.getByText('Nai-save ang biyahe.')).toBeVisible();
  await expect(page.getByTestId('save-trip')).toHaveText('Nai-save');

  await page.goto('/saved');
  const savedRows = page.getByTestId('saved-row');
  await expect(savedRows.first()).toBeVisible();
  await expect(savedRows.first().getByTestId('saved-title')).toContainText('→');
  await expect(savedRows.first().getByTestId('saved-fare')).toContainText('₱');
  await expect(savedRows.first().getByTestId('saved-fare')).toContainText(
    /effective \d{4}-\d{2}-\d{2}/,
  );
  await expect(savedRows.first().getByTestId('leg-strip')).toHaveCount(1);
  await expect(savedRows.first().getByTestId('leg-strip-segment').first()).toBeVisible();

  // Buksan reopens the stored itinerary: the detail says it is a saved snapshot
  // and the save CTA is honestly disabled (re-saving would re-date old data).
  await savedRows.first().getByRole('button', { name: 'Buksan' }).click();
  await expect(page).toHaveURL(/\/trip\/[^/]+$/);
  await expect(page.getByTestId('trip-header')).toBeVisible();
  await expect(page.getByTestId('saved-snapshot-note')).toBeVisible();
  await expect(page.getByTestId('save-trip')).toBeDisabled();

  // 12. About data renders the live provenance registry, including OSM.
  await page.goto('/sources');
  await expect(page.getByTestId('dataset-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/OpenStreetMap/i).first()).toBeVisible();

  expectHealthy(health);
});
