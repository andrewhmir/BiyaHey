/**
 * Offline runtime-caching rules for the Workbox service worker (plan Task 8).
 *
 * Kept as pure data so the rules can be unit-tested in jsdom without a browser
 * or a built service worker. `vite.config.ts` maps this list into
 * `VitePWA({ workbox: { runtimeCaching } })`; the build is the only place that
 * knows Workbox itself.
 *
 * The three service-worker rules (spec §11 performance/offline budgets):
 * 1. `GET /search` — NetworkFirst, 3 s network timeout, 20-entry/7-day expiry.
 * 2. OpenFreeMap tiles — CacheFirst, 7-day expiry, 40-entry cap.
 * 3. `GET /sources` — StaleWhileRevalidate, 24-hour expiry.
 *
 * **`POST /plan` is deliberately not a service-worker rule (R72).** The Cache
 * API cannot store a POST response, and Workbox's NetworkFirst timeout path
 * calls `cacheMatch(request)`, which rejects for a non-GET request: a
 * registered rule would turn a slow plan into a network error instead of the
 * mandated 3 s bound. The 3 s plan budget is enforced client-side by
 * `planTrip` in `lib/api.ts` (`PLAN_TIMEOUT_MS`, a per-request timeout that
 * rejects with a typed `ApiError`).
 *
 * **Every rule is anchored at index 0 of the full URL.** Workbox turns a
 * `urlPattern: RegExp` into a `RegExpRoute`, and for a cross-origin request it
 * only applies the route when the match starts at the first character of
 * `url.href` (`node_modules/workbox-routing/RegExpRoute.js`). The API is a
 * different origin from the app in the default deployment (R40), so patterns
 * such as `/\/search(?:\?.*)?$/` would match at index 21 and never fire.
 * `offlineCache.test.ts` proves each rule against the installed `RegExpRoute`
 * with a foreign-origin URL. The host is not pinned, so a same-origin
 * deployment matches too. Patterns assume the API base URL is an origin with no
 * path prefix (the R40 contract: `http://localhost:8787`); a path-prefixed
 * deployment would need its own anchored pattern and test.
 *
 * **The "40 tiles per viewport" cap is a cache-entry cap.** Workbox's
 * expiration plugin counts cached URLs, not viewports (it has no viewport
 * concept). A 40-entry cap is roughly one viewport of Liberty vector tiles at
 * the app's zoom range, so the service worker never hoards tiles from a long
 * panning session. The per-viewport rendering budget itself belongs to the
 * map layer; the SW expresses it as `expiration.maxEntries = 40`.
 */

export type OfflineCacheRuleId = 'search' | 'tiles' | 'sources';

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
  id: OfflineCacheRuleId;
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

/** Plan §Task 8: a search request must answer within 3 s or fall back. */
export const API_NETWORK_TIMEOUT_SECONDS = 3;

/** 7 days, in the seconds Workbox's expiration plugin expects. */
export const TILE_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The viewport budget expressed as a cache cap: one viewport's worth of tiles.
 * See the module note above for why Workbox cannot express this per viewport.
 */
export const TILE_CACHE_MAX_ENTRIES = 40;

/** Every distinct `/search?q=` URL is a cache entry; bound the cache (M11). */
export const SEARCH_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SEARCH_CACHE_MAX_ENTRIES = 20;

/** 24 hours, in seconds. */
export const SOURCES_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * `^https?://<host>/<path>` anchored at index 0 for `RegExpRoute`'s
 * cross-origin rule. See the module note; the host stays unpinned.
 */
export const OFFLINE_RUNTIME_CACHING_RULES: readonly OfflineCacheRule[] = [
  {
    id: 'search',
    // Full-URL, index-0 match: Workbox refuses a partial match for a
    // cross-origin request, and the API is a different origin by default.
    urlPattern: /^https?:\/\/[^/]+\/search(?:\?.*)?$/,
    method: 'GET',
    handler: 'NetworkFirst',
    options: {
      cacheName: API_CACHE_NAME,
      networkTimeoutSeconds: API_NETWORK_TIMEOUT_SECONDS,
      // Search URLs are query-specific, so the cache must be bounded or it
      // grows for the life of the install (one entry per query ever typed).
      expiration: {
        maxAgeSeconds: SEARCH_CACHE_MAX_AGE_SECONDS,
        maxEntries: SEARCH_CACHE_MAX_ENTRIES,
      },
    },
    note: 'GET /search falls back to the last successful response for the same URL for up to 7 days, capped at 20 query URLs; the search screen also has its own per-query cache and saved-places fallback.',
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
    urlPattern: /^https?:\/\/[^/]+\/sources(?:\?.*)?$/,
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
