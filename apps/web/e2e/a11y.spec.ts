import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CORRIDOR_PATH, guardConsole, waitForPlan } from './helpers/app';

/**
 * Accessibility audit with the real axe-core engine, against the running app.
 *
 * Each route is scanned on the mobile viewport. Findings are reported per route
 * (impact, help text, affected nodes) and written to an aggregate JSON report;
 * only `critical` violations fail the suite, because the known `serious`
 * colour-contrast findings are defects to be fixed in `src/` by the Lead and
 * this verification pass does not change shipped source.
 *
 * Report path defaults to /tmp/verify/a11y-report.json (override with
 * BIYAHEY_A11Y_REPORT).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

interface RouteReport {
  route: string;
  url: string;
  violations: Array<{
    id: string;
    impact: string | null;
    help: string;
    nodes: number;
    targets: string[];
  }>;
}

const reports: RouteReport[] = [];

async function scanRoute(page: Page, route: string, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 6).map((node) => node.target.join(' ')),
  }));
  const entry: RouteReport = { route, url: page.url(), violations };
  reports.push(entry);

  const summary = violations
    .map(
      (violation) =>
        `[${violation.impact ?? 'unknown'}] ${violation.id} — ${violation.help} (${violation.nodes} node(s))`,
    )
    .join('\n');
  await testInfo.attach(`axe-${route}`, {
    body: JSON.stringify(entry, null, 2),
    contentType: 'application/json',
  });
  console.log(`axe %s: %d violation(s)\n%s`, route, violations.length, summary || 'clean');

  const critical = violations.filter((violation) => violation.impact === 'critical');
  expect(critical, `critical axe violations on ${route}`).toEqual([]);
}

test.describe('accessibility (axe-core, WCAG 2.2 AA tags)', () => {
  test.afterAll(() => {
    const output = process.env.BIYAHEY_A11Y_REPORT ?? '/tmp/verify/a11y-report.json';
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(reports, null, 2));
  });

  test('/ home', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('BiyaHey!');
    await scanRoute(page, 'home', testInfo);
  });

  test('/search directions form', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto('/search');
    await expect(page.locator('form[role="search"]')).toBeVisible();
    await scanRoute(page, 'search', testInfo);
  });

  test('/plan route options', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto(CORRIDOR_PATH);
    await waitForPlan(page);
    await scanRoute(page, 'plan', testInfo);
  });

  test('/trip/:id detail', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto(CORRIDOR_PATH);
    await waitForPlan(page);
    await page
      .locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]')
      .first()
      .click();
    await expect(page.locator('ol[aria-label="Mga hakbang ng biyahe"]')).toBeVisible();
    await scanRoute(page, 'trip', testInfo);
  });

  test('/saved with a stored trip', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto(CORRIDOR_PATH);
    await waitForPlan(page);
    await page
      .locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]')
      .first()
      .click();
    await page.getByRole('button', { name: 'I-save', exact: true }).click();
    await expect(page.getByRole('button', { name: /Alisin sa naka-save|Remove from saved/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goto('/saved');
    await expect(page.locator('ul[aria-label="Mga naka-save na biyahe"] > li')).toHaveCount(1);
    await scanRoute(page, 'saved', testInfo);
  });

  test('/trip/:id/live walkthrough', async ({ page }, testInfo) => {
    guardConsole(page);
    await page.goto(CORRIDOR_PATH);
    await waitForPlan(page);
    const detail = page.locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]');
    await detail.first().click();
    await page.locator('main a[href*="/live"]').first().click();
    await expect(page.locator('#live-banner-heading')).toContainText(/no live data/i);
    await scanRoute(page, 'live', testInfo);
  });
});
