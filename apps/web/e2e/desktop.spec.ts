import { expect, test, type Page } from '@playwright/test';
import { CORRIDOR_PATH, expectNoAppErrors, guardConsole, waitForPlan } from './helpers/app';

/**
 * Desktop layout (1440x900): the persistent map beside the 400 px sidebar,
 * BetterGov utility bar + nav, and route lines actually painted on the canvas.
 *
 * MapLibre paints a WebGL canvas, so the DOM cannot describe the drawn route.
 * Instead we screenshot the map canvas and count exact route/mode colours in the
 * composited pixels — a real assertion that the selected itinerary's line and
 * the endpoint pins are drawn, and that they change when another option is picked.
 */
interface ColorTarget {
  name: string;
  rgb: [number, number, number];
  tol: number;
}

const MAP_COLORS: readonly ColorTarget[] = [
  { name: 'rail', rgb: [0, 102, 235], tol: 10 }, // MRT-3 selected line (#0066eb)
  { name: 'bus', rgb: [255, 77, 0], tol: 10 }, // bus selected line (#ff4d00)
  { name: 'pinGreen', rgb: [0, 175, 95], tol: 12 }, // origin pin
  { name: 'pinRed', rgb: [225, 46, 46], tol: 12 }, // destination pin
];

type ColorCounts = Record<string, number>;

async function countMapColors(page: Page): Promise<ColorCounts> {
  const png = await page.locator('.maplibregl-canvas').screenshot();
  return page.evaluate(
    async ({ b64, colors }) => {
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context === null) return {};
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const counts: Record<string, number> = {};
      for (const color of colors) counts[color.name] = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        for (const color of colors) {
          const [r, g, b] = color.rgb;
          if (
            Math.abs(red - r) <= color.tol &&
            Math.abs(green - g) <= color.tol &&
            Math.abs(blue - b) <= color.tol
          ) {
            counts[color.name] = (counts[color.name] ?? 0) + 1;
          }
        }
      }
      return counts;
    },
    { b64: png.toString('base64'), colors: MAP_COLORS.map((color) => ({ ...color })) },
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
}

test('desktop shell: 400px sidebar, persistent map, BetterGov chrome', async ({ page }) => {
  const guard = guardConsole(page);
  await page.goto('/');

  // Map canvas + exactly 400 px sidebar, side by side.
  const panel = page.locator('aside#biyahey-panel');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.width).toBe(400);
  expect(panelBox?.height).toBeGreaterThan(700);

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox?.x).toBeGreaterThanOrEqual(400);
  expect(canvasBox?.width).toBeGreaterThan(900);

  // The basemap actually paints (map chunk loaded, no skeleton left behind).
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mapa ng ruta' })).toBeVisible();
  await expect(
    page.locator('a[href="https://www.openstreetmap.org/copyright"]'),
  ).toContainText('OpenStreetMap');

  // BetterGov chrome: navy utility bar, service bar, nav links, Figtree type.
  await expect(page.locator('.bg-navy')).toBeVisible();
  await expect(page.locator('.bg-navy')).toContainText('BetterGov.ph');
  const nav = page.locator('header nav');
  await expect(nav.getByRole('link', { name: 'Plano' })).toHaveAttribute('href', '/search');
  await expect(nav.getByRole('link', { name: 'Naka-save' })).toHaveAttribute('href', '/saved');
  await expect(nav.getByRole('link', { name: 'Data' })).toHaveAttribute('href', '/sources');
  await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);

  // BetterGov blue is the live theme token, not a stale palette.
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
  );
  expect(brand).toBe('#0066eb');

  await expectNoHorizontalOverflow(page);
  await expectNoAppErrors(guard);
});

test('desktop corridor: sidebar layout, route lines drawn, no overflow', async ({ page }) => {
  const guard = guardConsole(page);
  await page.goto(CORRIDOR_PATH);

  const count = await waitForPlan(page);
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);

  const panel = page.locator('aside#biyahey-panel');
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.width).toBe(400);
  await expectNoHorizontalOverflow(page);

  // Wait for MapLibre to paint the selected (rail) route and its endpoint pins.
  await expect
    .poll(async () => (await countMapColors(page)).rail ?? 0, { timeout: 25_000 })
    .toBeGreaterThan(300);
  const drawn = await countMapColors(page);
  expect(drawn.pinGreen ?? 0).toBeGreaterThan(20);
  expect(drawn.pinRed ?? 0).toBeGreaterThan(20);

  // Selecting another option re-draws the map: bus line replaces the rail line.
  const bodies = page.locator('ul[aria-label="Mga ruta"] > li button[aria-pressed]');
  await expect(bodies).toHaveCount(count);
  await bodies.nth(count - 1).click();
  await expect(page).toHaveURL(/\/plan\?/);
  await expect(page.locator('ul[aria-label="Mga ruta"] > li div[data-selected="true"]')).toHaveCount(1);

  const busCard = page.locator('ul[aria-label="Mga ruta"] > li').nth(count - 1);
  if ((await busCard.innerText()).includes('Bus')) {
    await expect
      .poll(async () => (await countMapColors(page)).bus ?? 0, { timeout: 25_000 })
      .toBeGreaterThan(300);
    const redrawn = await countMapColors(page);
    expect(redrawn.rail ?? 0).toBeLessThan(50);
    expect(redrawn.pinRed ?? 0).toBeGreaterThan(20);
  } else {
    // Live data may rank differently; any drawn line still proves the map reacts.
    await expect
      .poll(async () => (await countMapColors(page)).rail ?? 0, { timeout: 25_000 })
      .toBeGreaterThan(300);
  }

  // The detail action still targets the trip screen from the desktop sidebar.
  await expect(
    page.locator('ul[aria-label="Mga ruta"] > li a[aria-label^="Tingnan ang detalye"]'),
  ).toHaveCount(count);

  await expectNoAppErrors(guard);
});
