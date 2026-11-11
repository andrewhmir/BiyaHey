import type { PlanPlaceInput, PlanRequest, PlanStopInput } from '@biyahey/shared';

/** MOTIS accepts at most two `via` stops. */
export const MAX_TRIP_STOPS = 2;

export type TripPoint = PlanPlaceInput;

export interface TripStop extends TripPoint {
  /** Served stop id (`SearchResultDto.id` of a `type: 'stop'` result). */
  stopId: string;
  name: string;
}

/** A trip draft, as the form holds it and as the URL serialises it. */
export interface TripDraft {
  from: TripPoint | null;
  fromName: string | null;
  dest: TripPoint | null;
  destName: string | null;
  stops: TripStop[];
}

export interface ParsedTripParams extends TripDraft {
  hasFrom: boolean;
  hasDest: boolean;
}

export interface TripParamsLike {
  get(name: string): string | null;
  has(name: string): boolean;
}

const EMPTY_DRAFT: TripDraft = {
  from: null,
  fromName: null,
  dest: null,
  destName: null,
  stops: [],
};

function inRange(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** `"14.6,121.0"` → `{lat, lon}`; `null` for anything malformed/out of range. */
export function parseCoordinatePair(value: string | null | undefined): TripPoint | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const latText = parts[0];
  const lonText = parts[1];
  if (latText === undefined || lonText === undefined) return null;
  if (latText.trim() === '' || lonText.trim() === '') return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, lon)) return null;
  return { lat, lon };
}

export function formatCoordinatePair(point: TripPoint): string {
  return `${point.lat},${point.lon}`;
}

/** Parse a `via` JSON array, dropping every invalid entry (never whole-fails). */
export function parseStops(raw: string | null | undefined): TripStop[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const stops: TripStop[] = [];
  for (const entry of parsed) {
    if (stops.length >= MAX_TRIP_STOPS) break;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    const stopId = typeof candidate.stopId === 'string' ? candidate.stopId.trim() : '';
    if (stopId.length === 0) continue;
    if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') continue;
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) continue;
    if (!inRange(candidate.lat, candidate.lon)) continue;
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
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read a trip from a query string. Never throws; bad parts are dropped. */
export function parseTripParams(
  params: TripParamsLike | null | undefined,
): ParsedTripParams {
  if (params === null || params === undefined) {
    return { ...EMPTY_DRAFT, stops: [], hasFrom: false, hasDest: false };
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

/** The query string (no `?`) for a draft; `via` is encoded exactly once. */
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
    .filter((stop) => stop.stopId.length > 0 && inRange(stop.lat, stop.lon))
    .slice(0, MAX_TRIP_STOPS);
  if (stops.length > 0) {
    const payload = stops.map(({ lat, lon, stopId, name }) => ({ lat, lon, stopId, name }));
    parts.push(`via=${encodeURIComponent(JSON.stringify(payload))}`);
  }
  return parts.join('&');
}

export function buildPlanPath(draft: TripDraft): string {
  const query = buildTripQuery(draft);
  return query.length === 0 ? '/plan' : `/plan?${query}`;
}

export function buildSearchPath(draft: TripDraft): string {
  const query = buildTripQuery(draft);
  return query.length === 0 ? '/search' : `/search?${query}`;
}

/** The `POST /plan` body for a complete draft, or `null` while incomplete. */
export function planRequestFor(draft: TripDraft, departAt?: string): PlanRequest | null {
  if (draft.from === null || draft.dest === null) return null;
  const request: PlanRequest = {
    origin: draft.from,
    destination: draft.dest,
  };
  if (draft.stops.length > 0) {
    const stops: PlanStopInput[] = draft.stops.slice(0, MAX_TRIP_STOPS).map((stop) => ({
      lat: stop.lat,
      lon: stop.lon,
      stopId: stop.stopId,
    }));
    request.stops = stops;
  }
  if (departAt !== undefined) request.departAt = departAt;
  return request;
}

/** A draft from a parsed URL or an itinerary's two endpoints. */
export function draftFrom(
  from: TripPoint | null,
  fromName: string | null,
  dest: TripPoint | null,
  destName: string | null,
  stops: TripStop[] = [],
): TripDraft {
  return { from, fromName, dest, destName, stops };
}
