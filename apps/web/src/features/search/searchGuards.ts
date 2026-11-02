import type { SearchGroup, SearchResponse, SearchResultDto } from '@biyahey/shared';

/** Group keys in render order; every response must carry all four arrays. */
const GROUP_KEYS = ['stops', 'landmarks', 'routes', 'saved'] as const;

/**
 * Validate and normalize one search row from untrusted storage.
 *
 * Saved places and the typeahead cache both round-trip through localStorage,
 * where a partial write, a schema change, or another tab can leave `null` or
 * malformed rows behind. Returning `undefined` here keeps such a row out of
 * `SearchResults`, which would otherwise crash on `result.type`.
 */
export function normalizeSearchResult(value: unknown): SearchResultDto | undefined {
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

/**
 * Validate a cached search response before it becomes renderable data.
 *
 * Returns `undefined` (rejecting the whole entry) for a missing group, a
 * non-boolean `partial`, or any group row {@link normalizeSearchResult} cannot
 * normalize. The cache is an optimisation, so dropping a corrupt entry only
 * means the screen waits for the live response instead of crashing.
 */
export function normalizeSearchResponse(value: unknown): SearchResponse | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as { partial?: unknown; groups?: unknown };
  if (typeof candidate.partial !== 'boolean') {
    return undefined;
  }
  if (typeof candidate.groups !== 'object' || candidate.groups === null) {
    return undefined;
  }
  const rawGroups = candidate.groups as Record<string, unknown>;
  const groups = {} as SearchGroup;
  for (const key of GROUP_KEYS) {
    const rawRows = rawGroups[key];
    if (!Array.isArray(rawRows)) {
      return undefined;
    }
    const rows = rawRows.map(normalizeSearchResult);
    if (rows.some((row) => row === undefined)) {
      return undefined;
    }
    groups[key] = rows as SearchResultDto[];
  }
  return { partial: candidate.partial, groups };
}
