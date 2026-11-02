import type { PlanPlaceInput } from '@biyahey/shared';

/**
 * The trip-planner URL contract shared by `/search` and `/plan` (R89).
 *
 * The directions form owns the whole trip (start, up to two stops, end), so the
 * hand-off is a URL a rider can bookmark, share, or navigate back from:
 *
 *   /plan?from=<lat>,<lon>&fromName=<label>
 *        &dest=<lat>,<lon>&name=<label>
 *        [&via=<encodeURIComponent(JSON.stringify([{lat,lon,stopId,name}, ...]))>]
 *
 * `via` is encoded exactly once and stays in travel order. `/search` accepts the
 * same parameters to prefill the form (edit/deep links), and `/plan` parses them
 * defensively: a malformed or hostile URL drops the bad entries instead of
 * crashing the lazy route chunk.
 *
 * The helper lives under `features/search` because the form is the writer, but
 * it is pure (no React, no storage) so both screens and the tests share it.
 */

/** The router's `via` limit: MOTIS accepts at most two stops. */
export const MAX_TRIP_STOPS = 2;

/** A coordinate pair the trip form can send. */
export type TripPoint = PlanPlaceInput;

/** One optional intermediate stop, in travel order. */
export interface TripStop extends TripPoint {
  /** Served stop id (`SearchResultDto.id` of a `type: 'stop'` result). */
  stopId: string;
  /** Display name carried so the URL alone is enough to render the trip. */
  name: string;
}

/** A whole trip draft, as the form holds it and as the URL serialises it. */
export interface TripDraft {
  from: TripPoint | null;
  fromName: string | null;
  dest: TripPoint | null;
  destName: string | null;
  stops: TripStop[];
}

/** Parsed URL state, plus whether the params were present at all. */
export interface ParsedTripParams extends TripDraft {
  /** `from` was present, even if its value could not be parsed. */
  hasFrom: boolean;
  /** `dest` was present, even if its value could not be parsed. */
  hasDest: boolean;
}

/**
 * Minimal read surface of `URLSearchParams`, so callers can pass
 * `useSearchParams()`'s value or a plain `URLSearchParams` in tests.
 */
export interface TripParamsLike {
  get(name: string): string | null;
  has(name: string): boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Coordinates outside the globe are a corrupt URL, never a place. */
function inRange(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** `"14.6,121.0"` → `{lat, lon}`; `null` for anything malformed/out of range. */
export function parseCoordinatePair(value: string | null | undefined): TripPoint | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parts = value.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [latText, lonText] = parts;
  if (latText.trim() === '' || lonText.trim() === '') {
    return null;
  }
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, lon)) {
    return null;
  }
  return { lat, lon };
}

/** `{lat, lon}` → the `lat,lon` pair the query string carries. */
export function formatCoordinatePair(point: TripPoint): string {
  return `${point.lat},${point.lon}`;
}

/**
 * Parse the `via` value. Every invalid entry is dropped (not the whole list):
 * a bad third entry must not discard the first two, and a `via` that is not
 * JSON, not an array, or not a list of stop objects becomes `[]` — the plan
 * simply asks for a route without stops instead of crashing.
 */
export function parseStops(raw: string | null | undefined): TripStop[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const stops: TripStop[] = [];
  for (const entry of parsed) {
    if (stops.length >= MAX_TRIP_STOPS) {
      break;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    // A stop without its served id cannot become a router `via`, so it is not
    // a usable stop even if its coordinates are sound.
    const stopId =
      typeof candidate.stopId === 'string' ? candidate.stopId.trim() : '';
    if (stopId.length === 0) {
      continue;
    }
    if (!isFiniteNumber(candidate.lat) || !isFiniteNumber(candidate.lon)) {
      continue;
    }
    if (!inRange(candidate.lat, candidate.lon)) {
      continue;
    }
    stops.push({
      lat: candidate.lat,
      lon: candidate.lon,
      stopId,
      name: typeof candidate.name === 'string' ? candidate.name : '',
    });
  }
  return stops;
}

function readName(params: TripParamsLike, key: string): string | null {
  const value = params.get(key);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the trip from a query string. Never throws: a URL a rider mangled (or a
 * stale link from an older app version) still opens the form, just without the
 * parts that could not be understood.
 */
export function parseTripParams(
  params: TripParamsLike | null | undefined,
): ParsedTripParams {
  if (params === null || params === undefined) {
    return {
      from: null,
      fromName: null,
      dest: null,
      destName: null,
      stops: [],
      hasFrom: false,
      hasDest: false,
    };
  }
  const from = parseCoordinatePair(params.get('from'));
  const dest = parseCoordinatePair(params.get('dest'));
  return {
    from,
    fromName: from === null ? null : readName(params, 'fromName'),
    dest,
    destName: dest === null ? null : readName(params, 'name'),
    stops: parseStops(params.get('via')),
    hasFrom: params.has('from'),
    hasDest: params.has('dest'),
  };
}

/**
 * The query string (without `?`) for a draft. `via` is `encodeURIComponent`d
 * exactly once, matching the agreed contract, so one `URLSearchParams` read
 * decodes it back to JSON.
 */
export function buildTripQuery(draft: TripDraft): string {
  const parts: string[] = [];

  if (draft.from !== null) {
    parts.push(`from=${formatCoordinatePair(draft.from)}`);
    if (draft.fromName !== null && draft.fromName.trim().length > 0) {
      parts.push(`fromName=${encodeURIComponent(draft.fromName)}`);
    }
  }

  if (draft.dest !== null) {
    parts.push(`dest=${formatCoordinatePair(draft.dest)}`);
    if (draft.destName !== null && draft.destName.trim().length > 0) {
      parts.push(`name=${encodeURIComponent(draft.destName)}`);
    }
  }

  const stops = draft.stops
    .filter(
      (stop) =>
        typeof stop.stopId === 'string' &&
        stop.stopId.length > 0 &&
        Number.isFinite(stop.lat) &&
        Number.isFinite(stop.lon) &&
        inRange(stop.lat, stop.lon),
    )
    .slice(0, MAX_TRIP_STOPS);
  if (stops.length > 0) {
    const payload = stops.map(({ lat, lon, stopId, name }) => ({ lat, lon, stopId, name }));
    parts.push(`via=${encodeURIComponent(JSON.stringify(payload))}`);
  }

  return parts.join('&');
}

/** `/plan?<trip>` — the directions form's trip hand-off. */
export function buildPlanPath(draft: TripDraft): string {
  const query = buildTripQuery(draft);
  return query.length === 0 ? '/plan' : `/plan?${query}`;
}

/** `/search?<trip>` — prefill the form from a plan (edit/back/deep link). */
export function buildSearchPath(draft: TripDraft): string {
  const query = buildTripQuery(draft);
  return query.length === 0 ? '/search' : `/search?${query}`;
}
