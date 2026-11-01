import type { SearchResultDto } from '@biyahey/shared';
import { normalizeSearchResult } from './searchGuards';

/**
 * Local saved places used by the offline fallback.
 *
 * Search has no accounts in v1, so "saved" is whatever this device stored. The
 * writer belongs to the saved-places flow (plan Task 8 owns device storage);
 * this module only reads and hardens the payload, because a corrupt blob must
 * never blank the offline search screen.
 */
export const SAVED_PLACES_KEY = 'biyahey:v1:saved-places';

/** Saved places readable offline, or `[]` when storage is absent/corrupt. */
export function readSavedPlaces(): SearchResultDto[] {
  try {
    const raw = window.localStorage.getItem(SAVED_PLACES_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeSearchResult)
      .filter((place): place is SearchResultDto => place !== undefined);
  } catch {
    return [];
  }
}
