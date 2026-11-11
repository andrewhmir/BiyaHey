import { expect, type Page } from '@playwright/test';

/** The Metro Manila corridor every core-flow spec plans (Guadalupe → Cubao). */
export const CORRIDOR_PATH =
  '/plan?from=14.566719,121.045438&fromName=Guadalupe%2C%20Makati&dest=14.619478,121.051057&name=Cubao%2C%20Quezon%20City';

export const DEV_ORIGIN = 'http://localhost:5173';
export const BFF_ORIGIN = 'http://localhost:8787';

const ROUTE_LIST = 'ul[aria-label="Mga ruta"]';

/** Route-option cards rendered for a plan (each `<li>` holds one itinerary). */
export function routeCards(page: Page) {
  return page.locator(`${ROUTE_LIST} > li`);
}

/** Waits out the live `POST /plan` and returns the rendered card count. */
export async function waitForPlan(page: Page): Promise<number> {
  await expect(routeCards(page).first()).toBeVisible({ timeout: 30_000 });
  return routeCards(page).count();
}

export interface ConsoleGuard {
  pageErrors: string[];
  appErrors: string[];
}

/**
 * Records uncaught page errors and console errors raised by the app or BFF.
 * Third-party requests (map tiles, Google Fonts) are excluded so a flaky CDN
 * that is not app code does not fail the run — app code failures still do.
 */
const EXTERNAL_HOSTS = /tiles\.openfreemap\.org|fonts\.(googleapis|gstatic)\.com/;
export function guardConsole(page: Page): ConsoleGuard {
  const guard: ConsoleGuard = { pageErrors: [], appErrors: [] };
  page.on('pageerror', (error) => guard.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    const text = message.text();
    // A failed basemap-style/tile or webfont request is reported from the
    // library's module URL; it is a CDN problem, not an app-code error.
    if (EXTERNAL_HOSTS.test(text) || EXTERNAL_HOSTS.test(location)) return;
    if (location.startsWith(DEV_ORIGIN) || location.startsWith(BFF_ORIGIN)) {
      guard.appErrors.push(`${location} — ${text}`);
    }
  });
  return guard;
}

export async function expectNoAppErrors(guard: ConsoleGuard): Promise<void> {
  expect(guard.pageErrors, 'uncaught page errors').toEqual([]);
  expect(guard.appErrors, 'app-origin console errors').toEqual([]);
}
