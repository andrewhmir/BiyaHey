import type { SearchResponse } from '@biyahey/shared';

/**
 * Namespaced localStorage key for the typeahead cache. It shares the
 * `biyahey:v1:*` namespace Task 8's device store uses (R50/plan Task 8).
 */
export const SEARCH_CACHE_KEY = 'biyahey:v1:search-cache';

/** The 20-query cap the Task 4 contract requires. */
export const SEARCH_CACHE_LIMIT = 20;

/** How many recent queries the idle search screen offers as chips. */
export const RECENT_SEARCH_LIMIT = 5;

export interface CachedSearch {
  /** The query as the rider typed it (trimmed), for the recents list. */
  query: string;
  response: SearchResponse;
  /** Epoch milliseconds, used only to keep the newest entries. */
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isResultArray(value: unknown): boolean {
  return Array.isArray(value);
}

function isSearchResponse(value: unknown): value is SearchResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { partial?: unknown; groups?: unknown };
  if (typeof candidate.partial !== 'boolean') {
    return false;
  }
  if (typeof candidate.groups !== 'object' || candidate.groups === null) {
    return false;
  }
  const groups = candidate.groups as Record<string, unknown>;
  return (['stops', 'landmarks', 'routes', 'saved'] as const).every((key) =>
    isResultArray(groups[key]),
  );
}

function isCachedSearch(value: unknown): value is CachedSearch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<CachedSearch>;
  return (
    typeof entry.query === 'string' &&
    entry.query.trim().length > 0 &&
    typeof entry.savedAt === 'number' &&
    isSearchResponse(entry.response)
  );
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function writeEntries(entries: CachedSearch[]): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or private mode: the cache is an optimisation, never a
    // correctness requirement, so a failed write must not break searching.
  }
}

/** All cached queries, newest first, or `[]` when storage is absent/corrupt. */
export function readSearchCache(): CachedSearch[] {
  const store = storage();
  if (store === null) {
    return [];
  }
  try {
    const raw = store.getItem(SEARCH_CACHE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isCachedSearch).slice(0, SEARCH_CACHE_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Remember a successful query. Repeating a query moves it to the front rather
 * than duplicating it, and the list never exceeds {@link SEARCH_CACHE_LIMIT}.
 */
export function writeSearchCache(query: string, response: SearchResponse): void {
  const display = query.trim();
  if (display.length === 0) {
    return;
  }
  const key = normalizeQuery(display);
  const rest = readSearchCache().filter((entry) => normalizeQuery(entry.query) !== key);
  const entry: CachedSearch = { query: display, response, savedAt: Date.now() };
  writeEntries([entry, ...rest].slice(0, SEARCH_CACHE_LIMIT));
}

/** The cached response for an exact (case-insensitive) query, if any. */
export function cachedSearchResponse(query: string): SearchResponse | undefined {
  const key = normalizeQuery(query);
  return readSearchCache().find((entry) => normalizeQuery(entry.query) === key)?.response;
}

/** Recent queries, newest first, for the idle state. */
export function readRecentQueries(limit = RECENT_SEARCH_LIMIT): string[] {
  return readSearchCache()
    .slice(0, limit)
    .map((entry) => entry.query);
}
