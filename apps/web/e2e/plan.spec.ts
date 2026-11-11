import { expect, test } from '@playwright/test';
import {
  CORRIDOR_PATH,
  expectNoAppErrors,
  guardConsole,
  routeCards,
  waitForPlan,
} from './helpers/app';

/**
 * Mobile core loop against the live stack (Vite :5173 → BFF :8787 → MOTIS :8080).
 *
 * Plan → pick a card → trip detail (timeline + fare + human names) → save →
 * saved list → reopen → live walkthrough with its honest no-live-data banner.
 * The plan lives in memory only, so the trip is opened through the card's own
 * link (a cold `/trip/:id` URL is expected to fall back to a saved snapshot).
 */
test('corridor: cards → selection → detail → save → saved → live', async ({ page }) => {
  const guard = guardConsole(page);

  await page.goto(CORRIDOR_PATH);

  // 3–5 ranked alternatives, fare-first, each with a fare and its matrix date.
  const count = await waitForPlan(page);
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);

  const cards = routeCards(page);
  await expect(cards.first()).toContainText(/₱\d/);
  await expect(cards.first()).toContainText(/effective \d{4}-\d{2}-\d{2}/);
  await expect(cards.first()).toContainText('BEST');
  await expect(page.locator('p[role="status"]').first()).toContainText(/ruta · pinakamabilis/);

  // Card body selects the option on the map (aria-pressed moves, URL stays).
  const bodies = page.locator('ul[aria-label="Mga ruta"] > li button[aria-pressed]');
  await expect(bodies).toHaveCount(count);
  await expect(bodies.first()).toHaveAttribute('aria-pressed', 'true');
  await bodies.nth(1).click();
  await expect(page).toHaveURL(/\/plan\?/);
  await expect(bodies.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(bodies.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('ul[aria-label="Mga ruta"] > li div[data-selected="true"]')).toHaveCount(1);

  // The footer action opens the trip detail and keeps the rider's place names.
  const detailLink = page.locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]');
  await expect(detailLink).toHaveCount(count);
  await detailLink.first().click();
  await expect(page).toHaveURL(/\/trip\/it-[^/?]+\?/);
  const tripUrl = new URL(page.url());
  expect(tripUrl.searchParams.get('fromName')).toBe('Guadalupe, Makati');
  expect(tripUrl.searchParams.get('name')).toBe('Cubao, Quezon City');

  // Timeline: leg rows with rider-readable names, never router placeholders.
  const timeline = page.locator('ol[aria-label="Mga hakbang ng biyahe"]');
  await expect(timeline).toBeVisible();
  const timelineLegs = page.locator('ol[aria-label="Mga hakbang ng biyahe"] > li');
  const legCount = await timelineLegs.count();
  expect(legCount).toBeGreaterThanOrEqual(3);
  const timelineText = await timeline.innerText();
  expect(timelineText).toContain('Guadalupe');
  expect(timelineText).toContain('Cubao, Quezon City');
  expect(timelineText).not.toMatch(/\bEND\b/);
  expect(timelineText).not.toMatch(/\bSTART\b/);
  expect(timelineText).not.toContain('Platform 999');
  await expect(timelineLegs.first()).toContainText(/HAKBANG 1/i);

  // Fare breakdown: the itemised quote, total and effectivity date.
  const fare = page.locator('section[aria-labelledby="fare-heading"]');
  await expect(fare).toBeVisible();
  await expect(page.locator('#fare-heading')).toContainText(/bayad sa biyahe/i);
  await expect(fare).toContainText(/Total ₱\d/);
  const fareLines = fare.locator('ul[aria-label="Fare breakdown"] > li');
  expect(await fareLines.count()).toBeGreaterThanOrEqual(1);
  await expect(fare).toContainText(/Effective \d{4}-\d{2}-\d{2}/);

  // Save the trip snapshot.
  await page.getByRole('button', { name: 'I-save', exact: true }).click();
  const savedButton = page.getByRole('button', { name: /Alisin sa naka-save|Remove from saved/ });
  await expect(savedButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main p[role="status"]').first()).toContainText('Nai-save ang biyahe.');

  // The saved list shows the trip with its snapshot honesty labels.
  await page.goto('/saved');
  const savedList = page.locator('ul[aria-label="Mga naka-save na biyahe"]');
  await expect(page.locator('ul[aria-label="Mga naka-save na biyahe"] > li')).toHaveCount(1);
  await expect(savedList).toContainText('Cubao, Quezon City');
  await expect(savedList).toContainText(/Na-save noong/);
  await expect(savedList).toContainText('Saved snapshot (no live ETA)');
  await expect(savedList).toContainText(/fare effective \d{4}-\d{2}-\d{2}/);

  // Reopening from the list resolves the stored snapshot (no fresh plan cache).
  await savedList.locator('li a[href^="/trip/"]').first().click();
  await expect(page).toHaveURL(/\/trip\/it-/);
  await expect(page.getByText(/Saved route \(no live data\)/)).toBeVisible();

  // Live walkthrough: step through legs, with the honest no-live-data banner.
  await page.locator('main a[href*="/live"]').first().click();
  await expect(page).toHaveURL(/\/live/);
  await expect(page.locator('#live-banner-heading')).toContainText(/no live data/i);
  const banner = page.locator('section[aria-labelledby="live-banner-heading"]');
  await expect(banner).toContainText(/Walang real-time na datos/);
  await expect(banner).toContainText(/walang live tracking/);

  const progress = page.locator('#live-progress-heading');
  await expect(progress).toHaveText(/Hakbang 1 ng \d+/);
  await expect(page.getByRole('button', { name: 'Nakaraan' })).toBeDisabled();
  await expect(page.locator('#live-current-heading')).toContainText('Maglakad papunta sa Guadalupe');

  await page.getByRole('button', { name: 'Susunod' }).click();
  await expect(progress).toHaveText(/Hakbang 2 ng \d+/);
  await expect(page.getByRole('button', { name: 'Nakaraan' })).toBeEnabled();
  await page.getByRole('button', { name: 'Nakaraan' }).click();
  await expect(progress).toHaveText(/Hakbang 1 ng \d+/);

  await expectNoAppErrors(guard);
});

/**
 * `/search` directions form: the live MOTIS typeahead fills From and To, then
 * submitting lands on `/plan` with a real plan and the labels in the URL.
 */
test('search: typeahead From/To round-trips to /plan', async ({ page }) => {
  const guard = guardConsole(page);

  await page.goto('/search');
  const inputs = page.locator('form[role="search"] input');
  await expect(inputs).toHaveCount(2);

  const results = page.locator('section[aria-label="Maghanap ng lugar"] li button[aria-label]');
  const status = page.locator('section[aria-label="Maghanap ng lugar"] p[role="status"]');

  // From: Guadalupe (live geocode, no mocks).
  await inputs.nth(0).click();
  await inputs.nth(0).fill('Guadalupe');
  await expect(status).toContainText(/resulta/, { timeout: 25_000 });
  await expect(results.first()).toBeVisible();
  expect(await results.count()).toBeGreaterThan(0);
  await results.first().click();
  await expect(inputs.nth(0)).toHaveValue(/Guadalupe/);

  // The form moves focus to To after a From pick.
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).fill('Cubao');
  await expect(status).toContainText(/resulta/, { timeout: 25_000 });
  await expect(results.first()).toBeVisible();
  await results.first().click();
  await expect(inputs.nth(1)).toHaveValue(/Cubao/);

  const submit = page.getByRole('button', { name: 'Maghanap ng ruta' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/plan\?/);

  const url = new URL(page.url());
  expect(url.searchParams.get('fromName')).toMatch(/Guadalupe/);
  expect(url.searchParams.get('name')).toMatch(/Cubao/);

  const count = await waitForPlan(page);
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);

  await expectNoAppErrors(guard);
});
