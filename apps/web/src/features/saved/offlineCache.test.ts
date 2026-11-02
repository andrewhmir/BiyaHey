import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RegExpRoute } from 'workbox-routing';
import {
  API_NETWORK_TIMEOUT_SECONDS,
  OFFLINE_RUNTIME_CACHING_RULES,
  SEARCH_CACHE_MAX_AGE_SECONDS,
  SEARCH_CACHE_MAX_ENTRIES,
  SOURCES_CACHE_MAX_AGE_SECONDS,
  TILE_CACHE_MAX_AGE_SECONDS,
  TILE_CACHE_MAX_ENTRIES,
  workboxRuntimeCaching,
  type OfflineCacheRule,
  type OfflineCacheRuleId,
} from './offlineCache';

const DAY = 24 * 60 * 60;

// Workbox's dev logger would print the expected "partial match" warning for the
// unanchored-pattern regression probe below; keep the test output clean.
Object.assign(globalThis, { __WB_DISABLE_DEV_LOGS: true });

/** The configured BFF origin (R40), a different origin from the jsdom app. */
const API_ORIGIN = 'http://localhost:8787';
const FOREIGN_API_ORIGIN = 'https://api.biyahey.example';

function rule(id: OfflineCacheRuleId): OfflineCacheRule {
  const found = OFFLINE_RUNTIME_CACHING_RULES.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`missing ${id} rule`);
  }
  return found;
}

/**
 * Ask the installed Workbox `RegExpRoute` whether it matches, which is exactly
 * what `vite-plugin-pwa` builds from each `urlPattern: RegExp`.
 *
 * `RegExpRoute` only needs `url`; the other callback options are supplied to
 * satisfy the Workbox type and are never read by its match function.
 */
function workboxMatches(pattern: RegExp, href: string): boolean {
  const route = new RegExpRoute(pattern, async () => new Response('ok'));
  return (
    route.match({ url: new URL(href) } as Parameters<typeof route.match>[0]) !== undefined
  );
}

describe('offline runtime-caching rules', () => {
  it('defines exactly the three GET rules, most specific first', () => {
    expect(OFFLINE_RUNTIME_CACHING_RULES.map((entry) => entry.id)).toEqual([
      'search',
      'tiles',
      'sources',
    ]);
  });

  it('registers no /plan service-worker rule (a POST cannot be cached)', () => {
    expect(OFFLINE_RUNTIME_CACHING_RULES.every((entry) => entry.method === 'GET')).toBe(true);
    // R72: the 3 s plan bound is client-side (`planTrip`), so no rule here may
    // claim a plan request.
    for (const entry of OFFLINE_RUNTIME_CACHING_RULES) {
      expect(workboxMatches(entry.urlPattern, `${API_ORIGIN}/plan`)).toBe(false);
    }
  });

  it('rule 1: GET /search is NetworkFirst, 3 s, bounded by 20 entries/7 days', () => {
    const search = rule('search');
    expect(search.method).toBe('GET');
    expect(search.handler).toBe('NetworkFirst');
    expect(search.options.networkTimeoutSeconds).toBe(API_NETWORK_TIMEOUT_SECONDS);
    expect(search.options.networkTimeoutSeconds).toBe(3);
    expect(search.options.expiration?.maxAgeSeconds).toBe(SEARCH_CACHE_MAX_AGE_SECONDS);
    expect(search.options.expiration?.maxAgeSeconds).toBe(7 * DAY);
    expect(search.options.expiration?.maxEntries).toBe(SEARCH_CACHE_MAX_ENTRIES);
    expect(search.options.expiration?.maxEntries).toBe(20);
  });

  it('rule 2: OpenFreeMap tiles are CacheFirst for 7 days with a 40-entry cap', () => {
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

  it('rule 3: /sources is StaleWhileRevalidate with a 24 h expiry', () => {
    const sources = rule('sources');
    expect(sources.handler).toBe('StaleWhileRevalidate');
    expect(sources.options.expiration?.maxAgeSeconds).toBe(SOURCES_CACHE_MAX_AGE_SECONDS);
    expect(SOURCES_CACHE_MAX_AGE_SECONDS).toBe(DAY);
  });

  /**
   * C1 regression: this is Workbox's own cross-origin rule, not `regex.test()`.
   * `RegExpRoute.match()` requires a match at index 0 whenever the request
   * origin differs from `location.origin`.
   */
  it('matches every rule at index 0 for a foreign-origin URL via RegExpRoute', () => {
    const foreignUrls: Record<OfflineCacheRuleId, string> = {
      search: `${FOREIGN_API_ORIGIN}/search?q=ayala`,
      tiles: 'https://tiles.openfreemap.org/styles/liberty',
      sources: `${FOREIGN_API_ORIGIN}/sources`,
    };
    for (const entry of OFFLINE_RUNTIME_CACHING_RULES) {
      expect(workboxMatches(entry.urlPattern, foreignUrls[entry.id])).toBe(true);
    }

    // The old unanchored shapes matched at index 21, which RegExpRoute rejects
    // for a cross-origin request. This proves the assertion above is meaningful.
    expect(workboxMatches(/\/search(?:\?.*)?$/, `${API_ORIGIN}/search?q=ayala`)).toBe(false);
    expect(workboxMatches(/\/sources(?:\?.*)?$/, `${API_ORIGIN}/sources`)).toBe(false);
  });

  it('keeps the API rules origin-agnostic so a same-origin deployment matches too', () => {
    expect(workboxMatches(rule('search').urlPattern, `${window.location.origin}/search?q=ayala`)).toBe(
      true,
    );
    expect(workboxMatches(rule('sources').urlPattern, `${window.location.origin}/sources`)).toBe(
      true,
    );
  });

  it('maps the pure rules to Workbox entries without test-only fields', () => {
    const entries = workboxRuntimeCaching();
    expect(entries).toHaveLength(3);
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
