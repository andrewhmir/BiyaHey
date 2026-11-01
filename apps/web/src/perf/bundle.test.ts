import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * First route-screen bundle budget (spec §11, plan Task 10).
 *
 * The budget is the gzip size of everything the browser must download before
 * the initial `/` screen can render: the `index.html` entry chunk, its **static**
 * import graph (React, the router, the query client, the Home screen and the
 * app's shared modules) and their CSS. Dynamic imports are intentionally not
 * counted: `/search`, `/plan`, `/trip`, `/saved` and `/sources` are separate
 * lazily loaded chunks, and MapLibre lives behind `MapView`'s dynamic import.
 *
 * This is an honest measurement, not an exclusion: a static regression (e.g.
 * importing `MapCanvas` from `home.tsx` again) pulls MapLibre into the entry
 * graph and fails the budget, and a separate assertion below checks that the
 * map chunk is not in the initial graph at all.
 *
 * `dist/` is gitignored, so a fresh clone has no manifest. In that case the
 * suite skips with an explicit console warning instead of failing plain
 * `npm test`; run `npm run build --workspace @biyahey/web` to exercise it. When
 * a build exists the test fails loudly if it is older than its sources, so a
 * green result cannot describe a stale bundle.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = join(WEB_ROOT, 'dist');
const MANIFEST_PATH = join(DIST_DIR, '.vite', 'manifest.json');
const BUDGET_GZIP_BYTES = 250 * 1024;

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
}

type Manifest = Record<string, ManifestChunk>;

const BUILD_EXISTS = existsSync(MANIFEST_PATH);

if (!BUILD_EXISTS) {
  console.warn(
    '[bundle-budget] skipping: apps/web/dist/.vite/manifest.json does not exist. ' +
      'Run `npm run build --workspace @biyahey/web` to measure the initial ' +
      'route-screen payload (the budget is enforced in CI after the build).',
  );
}

/** Build inputs whose changes must invalidate a previous measurement. */
function buildInputs(): string[] {
  const roots = [
    join(WEB_ROOT, 'src'),
    join(WEB_ROOT, '..', '..', 'packages', 'shared', 'src'),
  ].map((path) => resolve(path));

  const singleFiles = [
    join(WEB_ROOT, 'index.html'),
    join(WEB_ROOT, 'vite.config.ts'),
    join(WEB_ROOT, 'package.json'),
    join(WEB_ROOT, 'tailwind.config.js'),
    join(WEB_ROOT, 'tailwind.config.ts'),
    join(WEB_ROOT, 'postcss.config.js'),
    join(WEB_ROOT, 'postcss.config.cjs'),
  ].filter((path) => existsSync(path));

  const found: string[] = [...singleFiles];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Tests and their harness are not bundled into the app.
        if (entry.name === 'test' || entry.name === '__tests__') continue;
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      found.push(path);
    }
  }

  for (const root of roots) {
    if (existsSync(root)) walk(root);
  }
  return found;
}

interface NewestInput {
  path: string;
  mtimeMs: number;
}

function newestBuildInput(): NewestInput {
  let newest: NewestInput = { path: join(WEB_ROOT, 'package.json'), mtimeMs: 0 };
  for (const path of buildInputs()) {
    const mtimeMs = statSync(path).mtimeMs;
    if (mtimeMs > newest.mtimeMs) {
      newest = { path, mtimeMs };
    }
  }
  return newest;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

/**
 * Every chunk the entry loads statically, walking the manifest's `imports`
 * edges. `dynamicImports` is deliberately not traversed: those chunks are
 * fetched only when their route (or the map) is rendered.
 */
function initialChunks(manifest: Manifest): Map<string, ManifestChunk> {
  const chunks = new Map<string, ManifestChunk>();
  const visit = (key: string): void => {
    if (chunks.has(key)) return;
    const chunk = manifest[key];
    if (chunk === undefined) {
      throw new Error(`manifest references missing chunk ${key}`);
    }
    chunks.set(key, chunk);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit('index.html');
  return chunks;
}

function gzipBytes(relativePath: string): number {
  const absolute = join(DIST_DIR, ...relativePath.split('/'));
  return gzipSync(readFileSync(absolute), { level: 9 }).length;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

describe('initial route-screen payload', () => {
  it.skipIf(!BUILD_EXISTS)(
    'stays at or under 250 KB gzip and keeps MapLibre out of the entry graph',
    () => {
      const manifest = readManifest();
      const entry = manifest['index.html'];
      if (entry === undefined) {
        throw new Error('build manifest has no `index.html` entry; cannot measure the budget');
      }

      // A stale build is worse than no build: it would report a number for code
      // that is no longer in the tree. Fail with the exact newer source file.
      const newest = newestBuildInput();
      const manifestMtime = statSync(MANIFEST_PATH).mtimeMs;
      const newestRelative = relative(WEB_ROOT, newest.path).replaceAll('\\', '/');
      expect(
        manifestMtime,
        `apps/web/dist is older than ${newestRelative}. The budget would measure a ` +
          'stale bundle; run `npm run build --workspace @biyahey/web` first.',
      ).toBeGreaterThanOrEqual(newest.mtimeMs);

      const chunks = initialChunks(manifest);

      // The map must be a dynamic import, not an entry dependency.
      const mapKey = Object.keys(manifest).find((key) =>
        key.endsWith('src/components/map/MapCanvas.tsx'),
      );
      expect(mapKey, 'manifest has no MapCanvas chunk — the map boundary is missing').toBeDefined();
      expect(
        chunks.has(mapKey ?? ''),
        `MapCanvas is in the initial import graph (${mapKey}); it must load via MapView's dynamic import`,
      ).toBe(false);

      const files = new Set<string>();
      for (const chunk of chunks.values()) {
        files.add(chunk.file);
        for (const css of chunk.css ?? []) files.add(css);
      }

      // VitePWA injects `registerSW.js` into index.html outside the module
      // graph; it is part of the same first load, so count any JS/CSS the HTML
      // references too.
      const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
      for (const match of html.matchAll(/(?:src|href)="\/([^"]+\.(?:js|css))"/g)) {
        if (match[1] !== undefined) files.add(match[1]);
      }

      const sizes = [...files]
        .map((file) => ({ file, gzip: gzipBytes(file) }))
        .sort((a, b) => b.gzip - a.gzip);
      const total = sizes.reduce((sum, entrySize) => sum + entrySize.gzip, 0);
      const breakdown = sizes
        .map(({ file, gzip }) => `  ${formatKb(gzip).padStart(9)}  ${file}`)
        .join('\n');

      console.log(
        `[bundle-budget] initial payload: ${formatKb(total)} gzip across ${sizes.length} file(s)\n${breakdown}`,
      );

      expect(
        total,
        `Initial route-screen payload is ${formatKb(total)} gzip, over the ` +
          `${formatKb(BUDGET_GZIP_BYTES)} budget.\n${breakdown}\n` +
          'Move a dependency behind a dynamic import or trim it; do not raise the budget ' +
          'without a recorded spec change.',
      ).toBeLessThanOrEqual(BUDGET_GZIP_BYTES);
    },
  );
});
