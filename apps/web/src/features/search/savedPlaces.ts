import type { SearchResultDto } from '@biyahey/shared';

/**
 * Local saved places used by the offline fallback.
 *
 * Search has no accounts in v1, so "saved" is whatever this device stored. The
 * writer belongs to the saved-places flow (plan Task 8 owns device storage);
 * this module only reads and hardens the payload, because a corrupt blob must
 * never blank the offline search screen.
 */
export const SAVED_PLACES_KEY = 'biyahey:v1:saved-places';

function normalizePlace(value: unknown): SearchResultDto | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const place = value as Record<string, unknown>;
  if (typeof place.id !== 'string' || place.id.length === 0) {
    return undefined;
  }
  if (typeof place.name !== 'string' || place.name.length === 0) {
    return undefined;
  }
  if (place.type !== 'stop' && place.type !== 'landmark') {
    return undefined;
  }
  if (typeof place.lat !== 'number' || !Number.isFinite(place.lat)) {
    return undefined;
  }
  if (typeof place.lon !== 'number' || !Number.isFinite(place.lon)) {
    return undefined;
  }

  const result: SearchResultDto = {
    id: place.id,
    name: place.name,
    label:
      typeof place.label === 'string' && place.label.length > 0 ? place.label : place.name,
    type: place.type,
    lat: place.lat,
    lon: place.lon,
    locality: typeof place.locality === 'string' ? place.locality : null,
    source_id:
      typeof place.source_id === 'string'
        ? (place.source_id as SearchResultDto['source_id'])
        : 'osm',
  };

  if (typeof place.distanceM === 'number' && Number.isFinite(place.distanceM)) {
    result.distanceM = place.distanceM;
  }
  if (Array.isArray(place.modes)) {
    result.modes = place.modes.filter((mode): mode is string => typeof mode === 'string');
  }
  return result;
}

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
      .map(normalizePlace)
      .filter((place): place is SearchResultDto => place !== undefined);
  } catch {
    return [];
  }
}
