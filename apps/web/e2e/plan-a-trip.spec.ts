import { expect, test } from '@playwright/test';

/**
 * The phase-2 acceptance flow (plan Task 10, spec §13), run against the real
 * local BFF and router.
 *
 * R89: `/search` is now the directions form (approved Option A), so the rider
 * sets an explicit From and To instead of letting `/plan` read the device
 * origin:
 *
 *   Home pill → `/search` directions form → To "Cubao" (pick a Stops result) →
 *   From "Guadalupe" (pick a Stops result) → "Maghanap ng ruta" → `/plan`
 *   fare-forward cards → `Detalye` → trip detail signage/landmark + fare
 *   breakdown → Save → `/saved` shows the snapshot → `/sources` lists
 *   OpenStreetMap.
 *
 * Determinism: every wait is an assertion on app state (Playwright auto-waits);
 * there are no fixed sleeps. The spec tolerates the real 1–5 returned options
 * and never asserts an invented fare or attribution (R41/R45); it only requires
 * that at least one card carries the API's `₱` fare and ETA.
 */
test('directions form → route options → trip detail → save → saved → sources', async ({
  page,
}) => {
  await page.goto('/');

  // Home's primary action opens the directions form.
  await page.getByRole('button', { name: 'Saan ka pupunta?' }).click();
  await expect(page).toHaveURL(/\/search$/);

  // 1. To ("Papunta sa") — the destination is chosen first, on purpose.
  const toField = page.getByRole('searchbox', { name: /papunta sa/i });
  await expect(toField).toBeVisible();
  await toField.fill('Cubao');

  // Wait for the live /search response, then pick the first stop. The heading
  // only renders when the group has results.
  const toStops = page.getByTestId('search-group-stops');
  await expect(toStops).toBeVisible({ timeout: 30_000 });
  await toStops.getByRole('button').first().click();

  // 2. From ("Mula sa") — the start is explicit, never the device location.
  const fromField = page.getByRole('searchbox', { name: /mula sa/i });
  await fromField.fill('Guadalupe');
  const fromStops = page.getByTestId('search-group-stops');
  await expect(fromStops).toBeVisible({ timeout: 30_000 });
  await fromStops.getByRole('button').first().click();

  // 3. An optional stop between them (R89): the picker offers stops only, and
  // the live BFF maps its served id to the router's via parameter.
  await page.getByRole('button', { name: /magdagdag ng hintuan/i }).click();
  const stopField = page.getByRole('searchbox', { name: /hintuan 1/i });
  await expect(stopField).toBeVisible();
  await stopField.fill('Ortigas');
  const viaStops = page.getByTestId('search-group-stops');
  await expect(viaStops).toBeVisible({ timeout: 30_000 });
  await viaStops.getByRole('button').first().click();

  // 4. The CTA hands the whole trip to /plan through the URL contract.
  await page.getByRole('button', { name: 'Maghanap ng ruta' }).click();
  await expect(page).toHaveURL(/\/plan\?/);
  await expect(page).toHaveURL(/[?&]from=/);
  await expect(page).toHaveURL(/[?&]dest=/);
  await expect(page).toHaveURL(/[?&]via=/);

  // The route-card count is the API's, not a fixture's.
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
