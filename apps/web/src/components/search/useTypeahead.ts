import type { SearchGroup, SearchResponse } from '@biyahey/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, searchPlaces, type NearPoint } from '../../lib/api';

/** Typeahead debounce window. */
export const SEARCH_DEBOUNCE_MS = 250;
/** Below this many characters the screen stays on recents. */
export const MIN_SEARCH_LENGTH = 2;

export const EMPTY_GROUPS: SearchGroup = {
  stops: [],
  landmarks: [],
  routes: [],
  saved: [],
};

export type TypeaheadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface TypeaheadOutcome {
  status: TypeaheadStatus;
  /** The trimmed query the current status belongs to. */
  query: string;
  groups: SearchGroup;
  count: number;
  /** The API could not answer completely (honesty flag, not a modifier). */
  partial: boolean;
  error: ApiError | null;
  retry: () => void;
}

interface Settled {
  status: 'loading' | 'success' | 'error';
  query: string;
  groups: SearchGroup;
  partial: boolean;
  error: ApiError | null;
}

export function countGroups(groups: SearchGroup): number {
  return (
    groups.stops.length + groups.landmarks.length + groups.routes.length + groups.saved.length
  );
}

/** A stop picker only offers served stops: `via` needs a stop id, not a landmark. */
export function onlyStops(groups: SearchGroup): SearchGroup {
  return {
    stops: groups.stops.filter((result) => result.type === 'stop'),
    landmarks: [],
    routes: [],
    saved: groups.saved.filter((result) => result.type === 'stop'),
  };
}

/**
 * Debounced, cancellable place typeahead (250 ms). A newer keystroke aborts the
 * in-flight request, and the status reports `loading` for the typed term before
 * the debounce has even fired, so the result count never describes a stale query.
 */
export function useTypeahead(term: string, near: NearPoint | undefined): TypeaheadOutcome {
  const trimmed = term.trim();
  const [debounced, setDebounced] = useState(trimmed);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled>({
    status: 'loading',
    query: '',
    groups: EMPTY_GROUPS,
    partial: false,
    error: null,
  });

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [trimmed]);

  const lat = near?.lat;
  const lon = near?.lon;

  useEffect(() => {
    const query = debounced.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      setSettled({ status: 'success', query: '', groups: EMPTY_GROUPS, partial: false, error: null });
      return;
    }
    const controller = new AbortController();
    setSettled({ status: 'loading', query, groups: EMPTY_GROUPS, partial: false, error: null });
    searchPlaces(query, {
      signal: controller.signal,
      ...(lat !== undefined && lon !== undefined ? { near: { lat, lon } } : {}),
    }).then(
      (response: SearchResponse) => {
        if (controller.signal.aborted) return;
        setSettled({
          status: 'success',
          query,
          groups: response.groups,
          partial: response.partial,
          error: null,
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          status: 'error',
          query,
          groups: EMPTY_GROUPS,
          partial: false,
          error: error instanceof ApiError ? error : null,
        });
      },
    );
    return () => controller.abort();
  }, [debounced, lat, lon, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (trimmed.length < MIN_SEARCH_LENGTH) {
    return {
      status: 'idle',
      query: trimmed,
      groups: EMPTY_GROUPS,
      count: 0,
      partial: false,
      error: null,
      retry,
    };
  }

  const current = settled.query === trimmed;
  const groups = current && settled.status === 'success' ? settled.groups : EMPTY_GROUPS;
  return {
    status: current ? settled.status : 'loading',
    query: trimmed,
    groups,
    count: countGroups(groups),
    partial: current && settled.status === 'success' && settled.partial,
    error: current ? settled.error : null,
    retry,
  };
}
