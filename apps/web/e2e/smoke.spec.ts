import { expect, test } from '@playwright/test';

test('home screen shows the search pill', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /saan ka pupunta/i })).toBeVisible();
});
