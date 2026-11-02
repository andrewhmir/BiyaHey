import type { SearchGroup, SearchResponse, SearchResultDto } from '@biyahey/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, searchPlaces, type NearPoint } from '../../lib/api';
import { readSavedPlaces } from './savedPlaces';
import { cachedSearchResponse, readRecentQueries, writeSearchCache } from './searchCache';

/** The Task 4 contract's debounce window. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Below this many characters the screen stays on recents/saved places. */
export const MIN_SEARCH_LENGTH = 2;

export const EMPTY_GROUPS: SearchGroup = Object.freeze({
  stops: [],
  landmarks: [],
  routes: [],
  saved: [],
});

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error' | 'offline';

export interface UseSearchOptions {
  /**
   * Caller's origin. The API only returns `distanceM` when it is supplied, so
   * later screens (route options, "near me") pass the stored origin here.
   */
  near?: NearPoint;
  /**
   * Resetting the typeahead between picking sessions (trip-planner R89).
   *
   * The directions form owns one query at a time: the active field's session.
   * When that session changes (the rider moves to another field), the debounced
   * query must be cleared immediately, otherwise the previous field's results
   * stay rendered under the new field for the whole 250 ms debounce window and
   * can be selected as if they belonged to it — observed live as a To stop
   * ("Cubao") being picked into the From field.
   */
  resetToken?: string;
}

export interface SearchOutcome {
  status: SearchStatus;
  /** Trimmed, debounced query the current results belong to. */
  query: string;
  groups: SearchGroup;
  /** Total results across the four groups. */
  count: number;
  /** The API could not answer completely (R41 honesty). */
  partial: boolean;
  /** Results are the saved-places fallback, not live API results. */
  offline: boolean;
  error: ApiError | null;
  recents: string[];
  savedPlaces: SearchResultDto[];
  retry: () => void;
}

/**
 * Debounced, cancellable typeahead search (Task 4).
 *
 * - 250 ms debounce before a query is issued (`enabled` also requires two
 *   characters, matching the API's usefulness floor).
 * - A new keystroke aborts the in-flight request immediately, so a slow older
 *   response can never replace the newer one.
 * - Successful responses are cached (20 queries) in localStorage; a matching
 *   cached response is used as `placeholderData` while the live query runs.
 * - When the browser reports offline, or the request fails at the network
 *   level, the hook returns the device's saved places with `offline: true`
 *   instead of an error or a blank screen.
 */
export function useSearch(term: string, options: UseSearchOptions = {}): SearchOutcome {
  const normalized = term.trim();
  const near = options.near;

  const [debounced, setDebounced] = useState(normalized);
  // Reset the query synchronously during render when the caller's session token
  // changes. This is React's documented "adjust state when a prop changes"
  // pattern: the render immediately re-runs with the cleared query, so the old
  // session's results are gone before the browser paints or the next click can
  // land (an effect would leave a window where they are still clickable).
  const [trackedResetToken, setTrackedResetToken] = useState(options.resetToken);
  if (trackedResetToken !== options.resetToken) {
    setTrackedResetToken(options.resetToken);
    setDebounced('');
  }
  const [savedPlaces] = useState(readSavedPlaces);
  const [recents, setRecents] = useState(() => readRecentQueries());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(normalized), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [normalized]);

  // A keystroke (or unmount) cancels the request for the previous term.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [normalized, near?.lat, near?.lon]);

  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const enabled = debounced.length >= MIN_SEARCH_LENGTH && !browserOffline;

  const query = useQuery({
    queryKey: ['search', debounced, near?.lat ?? null, near?.lon ?? null],
    enabled,
    placeholderData: () =>
      debounced.length >= MIN_SEARCH_LENGTH ? cachedSearchResponse(debounced) : undefined,
    // A network failure means the device is offline: retrying cannot help and
    // would delay the saved-places fallback by the retry delay.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.code === 'network') && failureCount < 1,
    queryFn: async (): Promise<SearchResponse> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const response = await searchPlaces(debounced, near, { signal: controller.signal });
        writeSearchCache(debounced, response);
        return response;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
  });

  useEffect(() => {
    if (query.data !== undefined) {
      setRecents(readRecentQueries());
    }
  }, [query.data]);

  const error = query.error instanceof ApiError ? query.error : null;
  const connectivityLost = error !== null && error.code === 'network';
  const offline =
    normalized.length >= MIN_SEARCH_LENGTH && (browserOffline || connectivityLost);

  let status: SearchStatus;
  if (normalized.length < MIN_SEARCH_LENGTH) {
    status = 'idle';
  } else if (offline) {
    status = 'offline';
  } else if (query.isError) {
    status = 'error';
  } else if (query.data !== undefined) {
    status = 'success';
  } else {
    // Debounce window or request in flight.
    status = 'loading';
  }

  const offlineGroups = useMemo<SearchGroup>(
    () => ({ stops: [], landmarks: [], routes: [], saved: savedPlaces }),
    [savedPlaces],
  );
  const groups = status === 'offline' ? offlineGroups : (query.data?.groups ?? EMPTY_GROUPS);
  const count =
    groups.stops.length + groups.landmarks.length + groups.routes.length + groups.saved.length;
  // The API's `partial` is an honesty flag, not a results modifier: it covers a
  // geocoder that returned nothing (shared `SearchResponse` contract), so it is
  // surfaced even when the count is zero. The screen pairs it with a
  // partial-aware no-results claim instead of a definite absence.
  const partial = status === 'success' && query.data?.partial === true;

  return {
    status,
    query: debounced,
    groups,
    count,
    partial,
    offline: status === 'offline',
    error,
    recents,
    savedPlaces,
    retry: () => {
      void query.refetch();
    },
  };
}
