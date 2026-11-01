import { expect, test } from '@playwright/test';

/**
 * The phase-2 acceptance flow (plan Task 10, spec §13), run against the real
 * local BFF and router:
 *
 *   search "Cubao" → select suggestion → `/plan` fare-forward cards →
 *   `Detalye` → trip detail signage/landmark + fare breakdown → Save →
 *   `/saved` shows the snapshot → `/sources` lists OpenStreetMap.
 *
 * Determinism: every wait is an assertion on app state (Playwright auto-waits);
 * there are no fixed sleeps. The spec tolerates the real 1–5 returned options
 * and never asserts an invented fare or attribution (R41/R45); it only requires
 * that at least one card carries the API's `₱` fare and ETA.
 */
test('search → route options → trip detail → save → saved → sources', async ({ page }) => {
  await page.goto('/');

  // Home's primary action opens the search screen.
  await page.getByRole('button', { name: 'Saan ka pupunta?' }).click();
  await expect(page).toHaveURL(/\/search$/);

  const search = page.getByRole('searchbox');
  await expect(search).toBeVisible();
  await search.fill('Cubao');

  // Wait for the live /search response, then pick the first stop. The heading
  // only renders when the group has results.
  const stopGroup = page.getByTestId('search-group-stops');
  await expect(stopGroup).toBeVisible({ timeout: 30_000 });
  await stopGroup.getByRole('button').first().click();

  // /plan requests a device origin (granted in playwright.config.ts) and then
  // POSTs the real plan. The route-card count is the API's, not a fixture's.
  await expect(page).toHaveURL(/\/plan\?/);
  const cards = page.getByTestId('route-card');
  await expect(cards.first()).toBeVisible({ timeout: 45_000 });

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
  }

  await page.getByTestId('trip-open').first().click();
  await expect(page).toHaveURL(/\/trip\/[^/]+$/);
  await expect(page.getByTestId('trip-header')).toBeVisible();

  // Trip detail renders the API's wayfinding copy: signage on ride legs and a
  // landmark line for every leg, plus the itemised fare with its source rows.
  await expect(page.getByTestId('landmark-line').first()).toBeVisible();
  await expect(page.getByText(/Look for:/).first()).toBeVisible();
  await expect(page.getByTestId('fare-breakdown')).toBeVisible();
  await expect(page.getByTestId('fare-line').first()).toBeVisible();
  await expect(page.getByTestId('fare-breakdown-total')).toContainText('₱');

  await page.getByTestId('save-trip').click();
  await expect(page.getByText('Nai-save ang biyahe.')).toBeVisible();
  await expect(page.getByTestId('save-trip')).toHaveText('Nai-save');

  // Reload the app and read the persisted snapshot. `/saved` is offline-first,
  // so its list must not depend on the plan cache that the reload dropped.
  await page.goto('/saved');
  const savedRows = page.getByTestId('saved-row');
  await expect(savedRows.first()).toBeVisible();
  await expect(savedRows.first().getByTestId('saved-fare')).toContainText('₱');

  // About data renders the live provenance registry, including the OSM row.
  await page.goto('/sources');
  await expect(page.getByTestId('dataset-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/OpenStreetMap/i).first()).toBeVisible();
});
