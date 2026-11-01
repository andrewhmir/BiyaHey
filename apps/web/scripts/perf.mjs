#!/usr/bin/env node
/**
 * `npm run perf:web` — build the PWA and run Lighthouse CI against the built
 * preview app (plan Task 10).
 *
 * Why a wrapper instead of a plain `lhci autorun`:
 * - The repo has no system Chrome guarantee. Lighthouse is pointed at the
 *   Chromium binary Playwright already installed via `CHROME_PATH`.
 * - `vite preview` serves the real production build, including the
 *   `vite-plugin-pwa` service worker and manifest, on the port the BFF CORS
 *   allow-list expects (5173, R40).
 * - The build always precedes collection so the assertions describe the current
 *   tree, never a stale `dist/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..', '..');
const configPath = join(webRoot, 'lighthouserc.json');

function fail(message) {
  console.error(`perf:web: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error !== undefined) {
    fail(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log('perf:web: building apps/web (production)');
run(npm, ['run', 'build'], { cwd: webRoot, shell: process.platform === 'win32' });

// Lighthouse collects from `vite preview`, which serves `dist/` exactly as the
// deployment would. Assert the build actually emitted the Workbox service
// worker and manifest, so a green perf run cannot describe a build without the
// PWA/offline shell (R72).
for (const expected of ['sw.js', 'manifest.webmanifest']) {
  const path = join(webRoot, 'dist', expected);
  if (!existsSync(path)) {
    fail(`the production build did not emit dist/${expected}; the PWA shell is missing`);
  }
}
console.log('perf:web: dist/sw.js + manifest.webmanifest present (served by vite preview)');

const require = createRequire(import.meta.url);

let chromePath;
try {
  const { chromium } = require('@playwright/test');
  chromePath = chromium.executablePath();
} catch (error) {
  fail(
    `could not resolve Playwright's Chromium (${error instanceof Error ? error.message : String(error)}). ` +
      'Run `npx playwright install chromium` first.',
  );
}
if (typeof chromePath !== 'string' || !existsSync(chromePath)) {
  fail(
    `Playwright Chromium is not installed at ${String(chromePath)}. ` +
      'Run `npx playwright install chromium` first.',
  );
}

let lhciCli;
try {
  const packagePath = require.resolve('@lhci/cli/package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.lhci;
  if (typeof bin !== 'string') fail('@lhci/cli does not declare an `lhci` binary');
  lhciCli = join(dirname(packagePath), bin);
} catch (error) {
  fail(
    `@lhci/cli is not installed (${error instanceof Error ? error.message : String(error)}). ` +
      'Run `npm install` first.',
  );
}

console.log(`perf:web: CHROME_PATH=${chromePath}`);
console.log('perf:web: collecting Lighthouse (mobile, 4x CPU throttle) against vite preview');
run(process.execPath, [lhciCli, 'autorun', '--config', configPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CHROME_PATH: chromePath,
  },
});
