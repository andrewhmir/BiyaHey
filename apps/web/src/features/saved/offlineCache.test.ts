import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  API_NETWORK_TIMEOUT_SECONDS,
  OFFLINE_RUNTIME_CACHING_RULES,
  SOURCES_CACHE_MAX_AGE_SECONDS,
  TILE_CACHE_MAX_AGE_SECONDS,
  TILE_CACHE_MAX_ENTRIES,
  workboxRuntimeCaching,
  type OfflineCacheRule,
} from './offlineCache';

const DAY = 24 * 60 * 60;

function rule(id: OfflineCacheRule['id']): OfflineCacheRule {
  const found = OFFLINE_RUNTIME_CACHING_RULES.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`missing ${id} rule`);
  }
  return found;
}

describe('offline runtime-caching rules', () => {
  it('defines exactly the four plan rules, most specific first', () => {
    expect(OFFLINE_RUNTIME_CACHING_RULES.map((entry) => entry.id)).toEqual([
      'plan',
      'search',
      'tiles',
      'sources',
    ]);
  });

  it('rule 1: POST /plan is NetworkFirst with a 3 s network timeout', () => {
    const plan = rule('plan');
    expect(plan.urlPattern.test('http://localhost:8787/plan')).toBe(true);
    expect(plan.method).toBe('POST');
    expect(plan.handler).toBe('NetworkFirst');
    expect(plan.options.networkTimeoutSeconds).toBe(API_NETWORK_TIMEOUT_SECONDS);
    // Workbox cannot store a POST body; the rule documents the honest fallback.
    expect(plan.note).toMatch(/cache api/i);
  });

  it('rule 2: GET /search is NetworkFirst with a 3 s network timeout', () => {
    const search = rule('search');
    expect(search.urlPattern.test('http://localhost:8787/search?q=ayala')).toBe(true);
    expect(search.method).toBe('GET');
    expect(search.handler).toBe('NetworkFirst');
    expect(search.options.networkTimeoutSeconds).toBe(3);
  });

  it('rule 3: OpenFreeMap tiles are CacheFirst for 7 days with a 40-entry cap', () => {
    const tiles = rule('tiles');
    expect(tiles.urlPattern.test('https://tiles.openfreemap.org/styles/liberty')).toBe(true);
    expect(tiles.urlPattern.test('https://tiles.openfreemap.org/planet/2026/tile.pbf')).toBe(true);
    expect(tiles.urlPattern.test('https://example.test/tile.pbf')).toBe(false);
    expect(tiles.handler).toBe('CacheFirst');
    expect(tiles.options.expiration?.maxAgeSeconds).toBe(7 * DAY);
    expect(TILE_CACHE_MAX_AGE_SECONDS).toBe(7 * DAY);
    // The viewport budget is expressed as a cache-entry cap; Workbox counts
    // URLs, not viewports (see the module note).
    expect(tiles.options.expiration?.maxEntries).toBe(40);
    expect(TILE_CACHE_MAX_ENTRIES).toBe(40);
    expect(tiles.note).toMatch(/viewport/i);
  });

  it('rule 4: /sources is StaleWhileRevalidate with a 24 h expiry', () => {
    const sources = rule('sources');
    expect(sources.urlPattern.test('http://localhost:8787/sources')).toBe(true);
    expect(sources.handler).toBe('StaleWhileRevalidate');
    expect(sources.options.expiration?.maxAgeSeconds).toBe(SOURCES_CACHE_MAX_AGE_SECONDS);
    expect(SOURCES_CACHE_MAX_AGE_SECONDS).toBe(DAY);
  });

  it('maps the pure rules to Workbox entries without test-only fields', () => {
    const entries = workboxRuntimeCaching();
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('id');
      expect(entry).not.toHaveProperty('note');
      expect(entry.urlPattern).toBeInstanceOf(RegExp);
      expect(typeof entry.handler).toBe('string');
    }
  });
});

/**
 * Installability assets (spec §11 / plan Task 8).
 *
 * The manifest in `vite.config.ts` points at these files; Chrome's install
 * prompt rejects an SVG-only icon set, so the checked-in PNGs must really be
 * PNGs of the declared sizes. (The built `manifest.webmanifest` itself is
 * verified by `npm run build`, which is where vite-plugin-pwa generates it.)
 */
function pngDimensions(relativePath: string): { width: number; height: number } {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const bytes = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('PWA icons', () => {
  it('ships the 192 and 512 install icons at their declared sizes', () => {
    expect(pngDimensions('../../../public/icons/icon-192.png')).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngDimensions('../../../public/icons/icon-512.png')).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('ships a 512 maskable icon for the Android mask', () => {
    expect(pngDimensions('../../../public/icons/maskable-512.png')).toEqual({
      width: 512,
      height: 512,
    });
  });
});
