import type { FastifyInstance } from 'fastify';
import type { SearchGroup, SearchResponse, SearchResultDto } from '@biyahey/shared';
import { haversineM } from '../domain/geo.js';
import { InvalidBodyError } from '../errors.js';
import { createMotisClient } from '../routing/motis-client.js';

/** Below this length the endpoint answers `partial: true` without a router call. */
const MIN_QUERY_LENGTH = 3;

/** Caller's origin for result distances (`?near=lat,lon`). */
interface NearPoint {
  lat: number;
  lon: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function emptyGroups(): SearchGroup {
  return { stops: [], landmarks: [], routes: [], saved: [] };
}

function partialResponse(): SearchResponse {
  return { partial: true, groups: emptyGroups() };
}

function localityOf(record: JsonRecord): string | null {
  const areas = asArray(record.areas);
  if (areas === undefined) {
    return null;
  }
  let city: string | undefined;
  let fallback: string | undefined;
  for (const entry of areas) {
    const area = asRecord(entry);
    if (area === undefined) {
      continue;
    }
    const name = asString(area.name);
    if (name === undefined) {
      continue;
    }
    if (city === undefined && asNumber(area.adminLevel) === 6) {
      city = name;
    }
    if (fallback === undefined && area.default === true) {
      fallback = name;
    }
  }
  return city ?? fallback ?? null;
}

function mapSearchResult(raw: unknown, near?: NearPoint): SearchResultDto | undefined {
  const record = asRecord(raw);
  if (record === undefined) {
    return undefined;
  }
  const type = asString(record.type)?.toUpperCase();
  const id = asString(record.id);
  const name = asString(record.name);
  const lat = asNumber(record.lat);
  const lon = asNumber(record.lon);
  if (type === undefined || id === undefined || name === undefined) {
    return undefined;
  }
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const locality = localityOf(record);
  const result: SearchResultDto = {
    id,
    name,
    label: locality !== null && locality !== name ? `${name}, ${locality}` : name,
    type: type === 'STOP' ? 'stop' : 'landmark',
    lat,
    lon,
    locality,
    // MOTIS geocodes the OSM-derived GTFS stops and OSM places; this endpoint
    // never calls Photon, so the honest registry id is `osm`.
    source_id: 'osm',
  };
  if (near !== undefined) {
    // Spec §10 lists a distance on every search result. It is measured from
    // the caller's point, so it is present only when `?near=` was supplied;
    // inventing a distance from an arbitrary (e.g. city-centre) point would be
    // a false claim.
    result.distanceM = Math.round(haversineM([near.lat, near.lon], [lat, lon]));
  }
  const modes = asArray(record.modes)?.filter(
    (mode): mode is string => typeof mode === 'string' && mode.length > 0,
  );
  if (modes !== undefined && modes.length > 0) {
    result.modes = modes;
  }
  return result;
}

/**
 * Group raw MOTIS geocode results.
 *
 * `STOP` results go to `stops`; every other MOTIS geocode type (PLACE, ADDRESS,
 * STREET, HOUSE, ...) goes to `landmarks`. `routes` and `saved` are reserved
 * groups and always empty in v1.
 */
function mapGeocode(raw: unknown, near?: NearPoint): { groups: SearchGroup; dropped: number } {
  const groups = emptyGroups();
  if (!Array.isArray(raw)) {
    return { groups, dropped: 1 };
  }
  let dropped = 0;
  for (const entry of raw) {
    const result = mapSearchResult(entry, near);
    if (result === undefined) {
      dropped += 1;
      continue;
    }
    if (result.type === 'stop') {
      groups.stops.push(result);
    } else {
      groups.landmarks.push(result);
    }
  }
  return { groups, dropped };
}

function readQuery(value: unknown): string {
  const record = asRecord(value);
  const raw = record === undefined ? undefined : record.q;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Parse the optional `near=lat,lon` query parameter.
 *
 * Returns `undefined` when absent (so no distance is attached). A malformed
 * value is a client error, not a silent fallback: the PWA must not receive
 * distances measured from a different point than the one it asked about.
 */
function readNear(value: unknown): NearPoint | undefined {
  const record = asRecord(value);
  const raw = record === undefined ? undefined : record.near;
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new InvalidBodyError('Invalid query parameter near: expected "lat,lon"');
  }
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 2) {
    throw new InvalidBodyError('Invalid query parameter near: expected "lat,lon"');
  }
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (
    parts[0].length === 0 ||
    parts[1].length === 0 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new InvalidBodyError(
      `Invalid query parameter near: "${raw}" is not a lat,lon pair in range`,
    );
  }
  return { lat, lon };
}

/** A `[start, length]` span of one whitespace-delimited token. */
interface TokenSpan {
  start: number;
  length: number;
}

/** The query's tokens as the spans MOTIS reports in a result's `tokens`. */
function queryTokenSpans(query: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const pattern = /\S+/g;
  for (;;) {
    const match = pattern.exec(query);
    if (match === null) {
      return spans;
    }
    spans.push({ start: match.index, length: match[0].length });
  }
}

function resultTokenSpans(record: JsonRecord): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const entry of asArray(record.tokens) ?? []) {
    const pair = asArray(entry);
    if (pair === undefined) {
      continue;
    }
    const start = asNumber(pair[0]);
    const length = asNumber(pair[1]);
    if (start !== undefined && length !== undefined) {
      spans.push({ start, length });
    }
  }
  return spans;
}

/**
 * Whether at least one result genuinely matched every token of the query.
 *
 * The MOTIS geocoder is fuzzy: for an absent place it still returns nearby
 * candidates and marks the query spans they fuzzily matched in `tokens`, so
 * token coverage alone is not enough. A genuine match also carries a negative
 * `score`; the fallback rows returned for a nonsense query score at or above
 * zero. Live probe on 2026-11-01 (`q=Barangay Walang Ganito 12345`): one row
 * claims all four query spans at score `+0.25`, while every real query's top
 * match scored between `-14` and `-44`. Both signals are required so a search
 * with no genuine hit is never reported as complete.
 */
function hasCompleteMatch(raw: unknown, query: string): boolean {
  const querySpans = queryTokenSpans(query);
  if (querySpans.length === 0 || !Array.isArray(raw)) {
    return false;
  }
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === undefined) {
      continue;
    }
    const score = asNumber(record.score);
    if (score === undefined || score >= 0) {
      continue;
    }
    const matched = resultTokenSpans(record);
    const coversAll = querySpans.every((span) =>
      matched.some(
        (candidate) => candidate.start === span.start && candidate.length === span.length,
      ),
    );
    if (coversAll) {
      return true;
    }
  }
  return false;
}

/**
 * `GET /search?q=` — MOTIS geocode typeahead, grouped for the PWA.
 *
 * Failures are never 5xx: an absent place, a short query, a malformed upstream
 * payload or a downed router all answer 200 with `partial: true`, so the
 * typeahead keeps working and the UI can invite more typing. `partial` is also
 * set when no returned result genuinely matched every query token, so a fuzzy
 * result set for an unknown place is never presented as a complete answer.
 */
export function registerSearchRoutes(app: FastifyInstance): void {
  const client = createMotisClient({ fetch: app.motisFetch });

  app.get('/search', async (request): Promise<SearchResponse> => {
    const query = readQuery(request.query);
    // Validated before the fallback `catch` below: a malformed `near` is a
    // client error (400), not a fuzzy-result fallback. Distance is measured
    // from this point only when the caller supplied it.
    const near = readNear(request.query);
    if (query.length < MIN_QUERY_LENGTH) {
      return partialResponse();
    }
    try {
      const raw = await client.geocode(query);
      const { groups, dropped } = mapGeocode(raw, near);
      const total = groups.stops.length + groups.landmarks.length;
      const complete = hasCompleteMatch(raw, query);
      return { partial: total === 0 || dropped > 0 || !complete, groups };
    } catch {
      return partialResponse();
    }
  });
}
