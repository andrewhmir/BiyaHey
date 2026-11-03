import { expect, test } from '@playwright/test';
import {
  countPlanRequests,
  expectDetailActionUnderSelectedCard,
  expectHealthy,
  legStripSegments,
  openPlanWithMap,
  openSelectedTripDetail,
  readMap,
  readRouteMapState,
  requireMap,
  selectedCardFare,
  waitForMapSources,
  watchPageHealth,
} from './helpers/live';

/**
 * UX v2 product flows that are not the single acceptance path (design §2/§4):
 * home recents, the local filter re-rank, the leg-by-leg live walkthrough and
 * the saved-trip lifecycle.
 *
 * Every test is independent: a fresh browser context (empty device storage) and
 * its own live plan. Console errors and uncaught page errors are collected for
 * the whole flow and must be empty — the app may not ship a runtime error just
 * because the flow looked right.
 */

test('home lists the recent trip with its leg strip and re-opens it', async ({ page }) => {
  const health = watchPageHealth(page);

  const cards = await openPlanWithMap(page);
  const selected = page.locator('[data-testid="route-card"][data-selected="true"]');
  await expect(selected).toHaveCount(1);
  const legCount = (await legStripSegments(selected)).length;
  await expect(cards.first()).toBeVisible();

  await openSelectedTripDetail(page);
  await expect(page.getByTestId('leg-row')).toHaveCount(legCount);
  // Save so the reloaded Home row can reopen the trip from the stored snapshot.
  await page.getByTestId('save-trip').click();
  await expect(page.getByTestId('save-trip')).toHaveText('Nai-save');

  // Opening a trip from a fresh plan records it as recent; Home shows it after
  // a full reload (the recents store is device-local, not the plan cache).
  await page.goto('/');
  const recents = page.getByTestId('recent-trip');
  await expect(recents.first()).toBeVisible();
  const recentCount = await recents.count();
  expect(recentCount).toBeGreaterThanOrEqual(1);
  expect(recentCount).toBeLessThanOrEqual(3);

  const first = recents.first();
  // The honest summary lives on the row's select button (the row itself is the
  // list item, so the leg-strip list stays valid content, review I2).
  const label = (await first.getByRole('button').getAttribute('aria-label')) ?? '';
  expect(label).toContain('min');
  expect(label).toContain('₱');
  await expect(first.getByTestId('leg-strip')).toHaveCount(1);
  await expect(first.getByTestId('leg-strip-segment')).toHaveCount(legCount);

  await first.click();
  await expect(page).toHaveURL(/\/trip\/[^/]+$/);
  await expect(page.getByTestId('trip-header')).toBeVisible();
  // The re-open comes from the saved snapshot, so it is labelled honestly.
  await expect(page.getByTestId('saved-snapshot-note')).toBeVisible();

  expectHealthy(health);
});

test('the Cheapest chip re-ranks locally and keeps the selected itinerary', async ({ page }) => {
  const health = watchPageHealth(page);
  const planRequests = countPlanRequests(page);

  const cards = await openPlanWithMap(page);
  await waitForMapSources(page, ['route-selected', 'route-alternatives']);
  const requestBaseline = planRequests();

  const chips = page.getByTestId('filter-chips');
  await expect(chips).toBeVisible();
  const recommendedChip = chips.getByRole('button', { name: 'Recommended' });
  await expect(recommendedChip).toHaveAttribute('aria-pressed', 'true');
  // Recommended leads with its consensus BEST card.
  await expect(cards.first().getByTestId('route-badge')).toHaveText('BEST');

  const cardCount = await cards.count();
  const selectedBefore = (await readRouteMapState(page)).selectedId;
  const fareBefore = (await selectedCardFare(page)).trim();
  const pressedCard = page.locator('[data-testid="route-card"][data-selected="true"]');
  const etaBefore = await pressedCard.getByTestId('route-eta').textContent();
  expect(etaBefore).not.toBeNull();

  await chips.getByRole('button', { name: 'Cheapest' }).click();
  await expect(chips.getByRole('button', { name: 'Cheapest' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(recommendedChip).toHaveAttribute('aria-pressed', 'false');

  // A real local re-rank: the CHEAPEST badge now leads and fares are ascending.
  await expect(cards.first().getByTestId('route-badge')).toHaveText('CHEAPEST');
  await expect(cards).toHaveCount(cardCount);
  const fares = await cards.getByTestId('fare-amount').evaluateAll((nodes) =>
    nodes.map((node) => Number((node.textContent ?? '').replace(/[^\d.]/g, ''))),
  );
  expect(fares).toHaveLength(cardCount);
  for (let index = 1; index < fares.length; index += 1) {
    expect(fares[index]).toBeGreaterThanOrEqual(fares[index - 1] ?? Number.NaN);
  }

  // The selected itinerary is kept by id: same map selection, same card pressed.
  expect((await readRouteMapState(page)).selectedId).toBe(selectedBefore);
  await expect(page.locator('[data-testid="route-card"][data-selected="true"]')).toHaveCount(1);
  await expect(pressedCard.getByTestId('route-eta')).toHaveText(etaBefore ?? '');
  await expect(pressedCard.getByTestId('fare-amount')).toHaveText(fareBefore);
  // The single detail action stays attached to the selected card.
  await expectDetailActionUnderSelectedCard(page);

  // The re-rank is client state: no new plan request.
  expect(planRequests()).toBe(requestBaseline);

  expectHealthy(health);
});

test('the live walkthrough steps through legs, goes back, finishes and restarts', async ({
  page,
}) => {
  const health = watchPageHealth(page);

  await openPlanWithMap(page);
  await openSelectedTripDetail(page);
  const legCount = await page.getByTestId('leg-row').count();
  expect(legCount).toBeGreaterThanOrEqual(2);

  await page.getByTestId('start-trip').click();
  await expect(page).toHaveURL(/\/live$/);

  // Honest banner: mandated English sentence + the Taglish honesty line.
  const banner = page.getByTestId('live-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('no live data — expected wait');
  await expect(banner).toContainText('walang live tracking');

  const progress = page.getByTestId('live-progress');
  await expect(progress).toContainText(`Hakbang 1 ng ${legCount}`);
  await expect(page.getByTestId('live-current-leg')).toBeVisible();
  await expect(page.getByTestId('live-instruction')).not.toBeEmpty();
  await expect(page.getByTestId('live-announce')).toContainText(
    `Hakbang 1 ng ${legCount}`,
  );

  // The live map draws the whole route plus the current leg's focus.
  await waitForMapSources(page, ['route-selected', 'route-focus']);
  const liveMap = requireMap(
    await readMap(page, { sources: ['route-selected', 'route-focus'] }),
  );
  expect(liveMap.features['route-selected']).toHaveLength(legCount);
  expect(liveMap.features['route-focus']).toHaveLength(1);
  expect(liveMap.features['route-focus'][0]?.properties.legIndex).toBe(0);

  await expect(page.getByTestId('live-prev')).toBeDisabled();
  await page.getByTestId('live-next').click();
  await expect(progress).toContainText(`Hakbang 2 ng ${legCount}`);
  await expect(page.getByTestId('live-prev')).toBeEnabled();
  await expect(page.getByTestId('live-announce')).toContainText(`Hakbang 2 ng ${legCount}`);
  // The map emphasis follows the walkthrough step.
  await expect
    .poll(
      async () =>
        requireMap(await readMap(page, { sources: ['route-focus'] })).features['route-focus'][0]
          ?.properties.legIndex,
      { timeout: 10_000 },
    )
    .toBe(1);

  await page.getByTestId('live-prev').click();
  await expect(progress).toContainText(`Hakbang 1 ng ${legCount}`);
  await expect(page.getByTestId('live-prev')).toBeDisabled();

  // Walk to the last step: the finished state is only after the last "Susunod".
  for (let step = 2; step <= legCount; step += 1) {
    await page.getByTestId('live-next').click();
    await expect(progress).toContainText(`Hakbang ${step} ng ${legCount}`);
  }
  await expect(page.getByTestId('live-finish')).toHaveCount(0);
  await expect(page.getByTestId('live-current-leg')).toBeVisible();

  await page.getByTestId('live-next').click();
  const finish = page.getByTestId('live-finish');
  await expect(finish).toBeVisible();
  await expect(finish).toContainText('Tapos ang biyahe');
  await expect(page.getByTestId('live-current-leg')).toHaveCount(0);

  // "Ulitin mula sa simula" resets the walkthrough to step 1.
  await page.getByTestId('live-start-over').click();
  await expect(progress).toContainText(`Hakbang 1 ng ${legCount}`);
  await expect(page.getByTestId('live-finish')).toHaveCount(0);
  await expect(page.getByTestId('live-prev')).toBeDisabled();

  expectHealthy(health);
});

test('a saved trip is titled by its endpoints, renamed, deleted+undone and reopened', async ({
  page,
}) => {
  const health = watchPageHealth(page);

  await openPlanWithMap(page);
  await openSelectedTripDetail(page);
  const tripFare = ((await page.getByTestId('fare-total').textContent()) ?? '').trim();
  expect(tripFare).toContain('₱');
  await page.getByTestId('save-trip').click();
  await expect(page.getByTestId('save-trip')).toHaveText('Nai-save');

  await page.goto('/saved');
  const savedRows = page.getByTestId('saved-row');
  await expect(savedRows).toHaveCount(1);
  const row = savedRows.first();
  const title = row.getByTestId('saved-title');
  // Endpoint title: `From → To` (or the rider's nickname after a rename).
  await expect(title).toContainText('→');
  expect(((await title.textContent()) ?? '').trim().length).toBeGreaterThan(2);
  // The stored fare is the API's amount plus its own effectivity date.
  await expect(row.getByTestId('saved-fare')).toContainText(tripFare);
  await expect(row.getByTestId('saved-fare')).toContainText(/effective \d{4}-\d{2}-\d{2}/);
  await expect(row.getByTestId('leg-strip-segment').first()).toBeVisible();

  // Rename: the rider's nickname wins over the endpoint title.
  await row.getByRole('button', { name: /palitan ang pangalan/i }).click();
  const nameField = page.getByLabel('Pangalan ng biyahe');
  await expect(nameField).toBeVisible();
  await nameField.fill('Paborito ko');
  await page.getByRole('button', { name: 'I-save ang pangalan' }).click();
  await expect(title).toHaveText('Paborito ko');

  // Delete offers undo, and undo restores the same snapshot (not a new one).
  await page.getByTestId('delete-saved').click();
  await expect(page.getByTestId('saved-row')).toHaveCount(0);
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('saved-row')).toHaveCount(1);
  await expect(page.getByTestId('saved-row').first().getByTestId('saved-title')).toHaveText(
    'Paborito ko',
  );

  // Buksan opens the stored snapshot: detail + the honest saved-snapshot label.
  await page
    .getByTestId('saved-row')
    .first()
    .getByRole('button', { name: 'Buksan' })
    .click();
  await expect(page).toHaveURL(/\/trip\/[^/]+$/);
  await expect(page.getByTestId('trip-header')).toBeVisible();
  await expect(page.getByTestId('saved-snapshot-note')).toBeVisible();
  await expect(page.getByTestId('save-trip')).toBeDisabled();

  expectHealthy(health);
});
