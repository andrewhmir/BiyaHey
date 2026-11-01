import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    ...devices['Pixel 7'],
    // Pixel 7 emulation with the design's 390x844 layout viewport.
    viewport: { width: 390, height: 844 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev --workspace @biyahey/web',
    url: baseURL,
    cwd: '../..',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
