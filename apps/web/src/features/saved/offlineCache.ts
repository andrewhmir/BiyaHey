/**
 * Offline runtime-caching rules for the Workbox service worker (plan Task 8).
 *
 * Kept as pure data so the four rules can be unit-tested in jsdom without a
 * browser or a built service worker. `vite.config.ts` maps this list into
 * `VitePWA({ workbox: { runtimeCaching } })`; the build is the only place that
 * knows Workbox itself.
 *
 * The four rules (spec §11 performance/offline budgets):
 * 1. `POST /plan` — NetworkFirst shape with a 3 s network timeout.
 * 2. `GET /search` — NetworkFirst with the same 3 s timeout.
 * 3. OpenFreeMap tiles — CacheFirst, 7-day expiry, 40-entry cap.
 * 4. `GET /sources` — StaleWhileRevalidate, 24-hour expiry.
 *
 * Two honest limits are documented here rather than hidden in the config:
 *
 * - **`/plan` is a POST.** The Cache API can only store GET responses, so
 *   Workbox's NetworkFirst cannot serve a cached plan body. The rule is still
 *   registered for the POST method because it buys the 3 s network bound and
 *   makes an offline plan fail fast; the offline trip path is the saved-trips
 *   store (R62/R63), never a cached plan repainted as current.
 * - **The "40 tiles per viewport" cap is a cache-entry cap.** Workbox's
 *   expiration plugin counts cached URLs, not viewports (it has no viewport
 *   concept). A 40-entry cap is roughly one viewport of Liberty vector tiles at
 *   the app's zoom range, so the service worker never hoards tiles from a long
 *   panning session. The per-viewport rendering budget itself belongs to the
 *   map layer; the SW expresses it as `expiration.maxEntries = 40`.
 */

export type OfflineCacheHandler = 'NetworkFirst' | 'CacheFirst' | 'StaleWhileRevalidate';

export type OfflineCacheMethod = 'GET' | 'POST';

export interface OfflineCacheExpiration {
  maxAgeSeconds?: number;
  maxEntries?: number;
}

export interface OfflineCacheOptions {
  cacheName: string;
  networkTimeoutSeconds?: number;
  expiration?: OfflineCacheExpiration;
}

/** A stable, renderer-free description of one Workbox runtime route. */
export interface OfflineCacheRule {
  id: 'plan' | 'search' | 'tiles' | 'sources';
  urlPattern: RegExp;
  method: OfflineCacheMethod;
  handler: OfflineCacheHandler;
  options: OfflineCacheOptions;
  /** Maintainers' note: why the rule looks the way it does. */
  note: string;
}

export const API_CACHE_NAME = 'biyahey-api-v1';
export const TILE_CACHE_NAME = 'biyahey-tiles-v1';
export const SOURCES_CACHE_NAME = 'biyahey-sources-v1';

/** Plan §Task 8: a plan/search request must answer within 3 s or fall back. */
export const API_NETWORK_TIMEOUT_SECONDS = 3;

/** 7 days, in the seconds Workbox's expiration plugin expects. */
export const TILE_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The viewport budget expressed as a cache cap: one viewport's worth of tiles.
 * See the module note above for why Workbox cannot express this per viewport.
 */
export const TILE_CACHE_MAX_ENTRIES = 40;

/** 24 hours, in seconds. */
export const SOURCES_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;

export const OFFLINE_RUNTIME_CACHING_RULES: readonly OfflineCacheRule[] = [
  {
    id: 'plan',
    // BFF path `/plan`; the API base host is runtime-configurable (R40), so the
    // rule matches the path, not the host.
    urlPattern: /\/plan(?:\?.*)?$/,
    method: 'POST',
    handler: 'NetworkFirst',
    options: {
      cacheName: API_CACHE_NAME,
      networkTimeoutSeconds: API_NETWORK_TIMEOUT_SECONDS,
    },
    note: 'POST /plan cannot be stored by the Cache API; this rule bounds the request to 3 s and fails fast offline. The offline trip path is the saved store (R62/R63).',
  },
  {
    id: 'search',
    urlPattern: /\/search(?:\?.*)?$/,
    method: 'GET',
    handler: 'NetworkFirst',
    options: {
      cacheName: API_CACHE_NAME,
      networkTimeoutSeconds: API_NETWORK_TIMEOUT_SECONDS,
    },
    note: 'GET /search falls back to the last successful response for the same URL; the search screen also has its own per-query cache and saved-places fallback.',
  },
  {
    id: 'tiles',
    urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
    method: 'GET',
    handler: 'CacheFirst',
    options: {
      cacheName: TILE_CACHE_NAME,
      expiration: {
        maxAgeSeconds: TILE_CACHE_MAX_AGE_SECONDS,
        maxEntries: TILE_CACHE_MAX_ENTRIES,
      },
    },
    note: 'Tiles and the Liberty style/JSON on the OpenFreeMap host are cached for 7 days; maxEntries: 40 is the cache expression of the 40-tiles-per-viewport budget.',
  },
  {
    id: 'sources',
    urlPattern: /\/sources(?:\?.*)?$/,
    method: 'GET',
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: SOURCES_CACHE_NAME,
      expiration: { maxAgeSeconds: SOURCES_CACHE_MAX_AGE_SECONDS },
    },
    note: 'The provenance registry changes rarely; serve the cached rows immediately and refresh for the next open, expiring after 24 h.',
  },
];

/** The shape `vite-plugin-pwa` forwards to Workbox's `runtimeCaching`. */
export interface WorkboxRuntimeCachingEntry {
  urlPattern: RegExp;
  method: OfflineCacheMethod;
  handler: OfflineCacheHandler;
  options: OfflineCacheOptions;
}

/**
 * The rules as Workbox entries. Exported separately so the pure-data list can
 * carry notes/ids that Workbox would ignore or reject.
 */
export function workboxRuntimeCaching(): WorkboxRuntimeCachingEntry[] {
  return OFFLINE_RUNTIME_CACHING_RULES.map(({ urlPattern, method, handler, options }) => ({
    urlPattern,
    method,
    handler,
    options,
  }));
}
