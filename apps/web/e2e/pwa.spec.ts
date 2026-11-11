import { expect, test } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CORRIDOR_PATH, waitForPlan } from './helpers/app';

/**
 * PWA verification against a real production build.
 *
 * The spec rebuilds `apps/web/dist` and serves it with `vite preview` on :4173
 * (the required child process), then proves:
 *   - the manifest link and service-worker registration exist in the built app;
 *   - a trip can be saved online (the same flow a rider uses);
 *   - with the browser offline, a reload still boots the app shell and the trip
 *     renders from its stored snapshot with the honesty labels, and `/saved`
 *     lists it offline.
 *
 * The built app points at a throwaway BFF child on :8788 (PORT=8788,
 * CORS_ORIGINS=http://localhost:4173). The shared :8787 BFF only allows the dev
 * origin :5173, and a deployment configures CORS for its real web origin — so
 * this is the production-correct setup, not a mock: it is the real BFF code
 * talking to the real MOTIS.
 */
const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = dirname(E2E_DIR);
const REPO_ROOT = dirname(dirname(APP_ROOT));
const VITE_BIN = `${REPO_ROOT}/node_modules/vite/bin/vite.js`;
const APP_PORT = 4173;
const API_PORT = 8788;
const APP_URL = `http://localhost:${APP_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

const run = promisify(execFile);

let apiServer: ChildProcess | undefined;
let previewServer: ChildProcess | undefined;
let apiLog = '';
let previewLog = '';

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function portIsBusy(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch {
    return false;
  }
}

function killGroup(child: ChildProcess | undefined): void {
  if (child?.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

test.describe('PWA offline after a real production build', () => {
  test.beforeAll(async () => {
    if (await portIsBusy(APP_URL)) {
      throw new Error(`Port ${APP_PORT} is already in use; stop the stale preview server`);
    }
    if (await portIsBusy(API_URL)) {
      throw new Error(`Port ${API_PORT} is already in use; stop the stale BFF server`);
    }

    // 1. Build the real dist, configured for the preview origin's BFF.
    await run(process.execPath, [VITE_BIN, 'build'], {
      cwd: APP_ROOT,
      env: { ...process.env, VITE_API_URL: API_URL },
    });

    // 2. A BFF that allows the preview origin (real data, real MOTIS).
    apiServer = spawn(process.execPath, ['--import', 'tsx', 'services/api/src/server.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        CORS_ORIGINS: APP_URL,
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiServer.stdout?.on('data', (chunk: Buffer) => (apiLog += chunk.toString()));
    apiServer.stderr?.on('data', (chunk: Buffer) => (apiLog += chunk.toString()));

    // 3. Serve the built dist exactly as the task requires.
    previewServer = spawn(
      process.execPath,
      [VITE_BIN, 'preview', '--port', String(APP_PORT), '--strictPort'],
      {
        cwd: APP_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    previewServer.stdout?.on('data', (chunk: Buffer) => (previewLog += chunk.toString()));
    previewServer.stderr?.on('data', (chunk: Buffer) => (previewLog += chunk.toString()));

    await waitForHttp(`${API_URL}/health`);
    await waitForHttp(`${APP_URL}/`);
  }, 180_000);

  test.afterAll(() => {
    killGroup(previewServer);
    killGroup(apiServer);
    previewServer = undefined;
    apiServer = undefined;
  });

  test('built app boots and saved trips open offline', async ({ page }) => {
    test.setTimeout(180_000);

    // --- Online: the production build loads, registers its SW, saves a trip.
    await page.goto(`${APP_URL}${CORRIDOR_PATH}`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('script[src*="registerSW"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0066eb');

    const count = await waitForPlan(page);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);

    // `navigator.serviceWorker.ready` can resolve while the worker is still
    // finishing activation; poll for the activated state and controller.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return registration.active?.state ?? null;
          }),
        { timeout: 15_000 },
      )
      .toBe('activated');
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        scope: registration.scope,
        state: registration.active?.state ?? null,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      };
    });
    expect(worker.state).toBe('activated');
    expect(worker.scope).toBe(`${APP_URL}/`);
    expect(worker.controller).toContain('/sw.js');

    // The precache holds the app shell so an offline reload can boot.
    const caches = await page.evaluate(() => caches.keys());
    expect(caches.length).toBeGreaterThan(0);

    await page
      .locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/trip\/it-/);
    await page.getByRole('button', { name: 'I-save', exact: true }).click();
    await expect(page.getByRole('button', { name: /Alisin sa naka-save|Remove from saved/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Reload online once so the page is definitely served by the service worker.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Saved route \(no live data\)/)).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    // --- Offline: reload the trip URL; the app shell + snapshot still render.
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cubao, Quezon City');
    await expect(page.getByText(/Saved route \(no live data\)/)).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // --- Offline: /saved lists the trip saved online, labelled honestly.
    await page.goto(`${APP_URL}/saved`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Mga naka-save at kamakailan' })).toBeVisible();
    await expect(page.getByText('Offline — saved routes only')).toBeVisible();

    const savedList = page.locator('ul[aria-label="Mga naka-save na biyahe"]');
    await expect(page.locator('ul[aria-label="Mga naka-save na biyahe"] > li')).toHaveCount(1);
    await expect(savedList).toContainText('Cubao, Quezon City');
    await expect(savedList).toContainText('Saved snapshot (no live ETA)');
    await expect(savedList).toContainText(/Na-save noong/);

    // The design tokens survive the production build.
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
    );
    expect(brand).toBe('#0066eb');
  });
});

// Make sure a crashed spec run cannot orphan the child servers.
process.on('exit', () => {
  killGroup(previewServer);
  killGroup(apiServer);
});
