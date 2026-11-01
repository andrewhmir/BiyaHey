import type {
  FareMode,
  FareQuote,
  ItineraryDto,
  LegDto,
  LegMode,
  LegPlaceDto,
  SourceId,
} from '@biyahey/shared';
import { quoteFareForLeg, sumFares } from '@biyahey/shared';

/**
 * Data the adapter needs beyond the raw MOTIS payload.
 *
 * `freeRideRouteIds` is empty in the default install (no free-ride status has
 * been corroborated yet) and the curated inventory only covers jeep/UV routes,
 * so every other route id is OSM-relation-derived.
 */
export interface MapContext {
  freeRideRouteIds: ReadonlySet<string>;
  curatedLandmarks: ReadonlyMap<string, readonly string[]>;
  /** Normalized route ids listed in the curated jeep/UV inventory. */
  curatedRouteIds: ReadonlySet<string>;
}

interface MappedLeg {
  dto: LegDto;
  quote: FareQuote | null;
}

/** Route-id families whose first segment is the mode contract (R29). */
const ROUTE_ID_PATTERN = /^(?:[a-z0-9]+_)?(rail|bus|jeep|uv|ferry)-(.+)$/i;

const RAIL_MODES: Readonly<Record<string, LegMode>> = Object.freeze({
  '1': 'lrt1',
  lrt1: 'lrt1',
  '2': 'lrt2',
  lrt2: 'lrt2',
  '3': 'mrt3',
  mrt3: 'mrt3',
});

/**
 * Map a MOTIS route id to a v1 fare mode.
 *
 * MOTIS namespaces feed ids (`gtfs_rail-3`), so the dataset prefix is stripped
 * first. Rail ids are accepted both as the live feed's `rail-3`/`rail-2`/`rail-1`
 * and as the brief's `rail-mrt3`/`rail-lrt2`/`rail-lrt1` aliases. Rail lines v1
 * cannot price (`rail-ss`, `rail-mnc`, the future `rail-mrt9`) return
 * `undefined` and the whole itinerary is dropped rather than mispriced.
 */
export function modeFromRouteId(routeId: string): LegMode | undefined {
  const normalized = normalizeRouteId(routeId);
  if (normalized === undefined) {
    return undefined;
  }
  const separator = normalized.indexOf('-');
  const family = normalized.slice(0, separator);
  const suffix = normalized.slice(separator + 1);
  switch (family) {
    case 'rail':
      return Object.hasOwn(RAIL_MODES, suffix) ? RAIL_MODES[suffix] : undefined;
    case 'bus':
      return 'bus';
    case 'jeep':
      return 'jeepney';
    case 'uv':
      return 'uv-express';
    case 'ferry':
      return 'ferry';
    default:
      return undefined;
  }
}

/** Strip MOTIS's dataset namespace and lowercase the route id. */
export function normalizeRouteId(routeId: string): string | undefined {
  const match = ROUTE_ID_PATTERN.exec(routeId.trim());
  if (match === null) {
    return undefined;
  }
  return `${match[1].toLowerCase()}-${match[2].toLowerCase()}`;
}

/**
 * Map a leg mode to the fare engine's mode.
 *
 * `bus-` legs are priced as ordinary city buses and `uv-` legs as traditional
 * UV Express: the GTFS route id carries no aircon/class distinction, so v1
 * chooses the cheaper documented class instead of guessing a premium.
 */
const FARE_MODE_BY_LEG: Readonly<Partial<Record<LegMode, FareMode>>> = Object.freeze({
  jeepney: 'jeepney',
  bus: 'city-bus-ordinary',
  mrt3: 'mrt3',
  lrt2: 'lrt2',
  lrt1: 'lrt1',
  ferry: 'ferry',
  'uv-express': 'uv-express-traditional',
});

const WALK_ONLY_EFFECTIVE_FROM = '2026-09-28'; // LTFRB PUV matrix (spec §8.3)

const EARTH_RADIUS_M = 6_371_000;

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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two `[lat, lon]` pairs, in metres. */
function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function decodeValue(encoded: string, state: { index: number }): number | undefined {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (state.index >= encoded.length) {
      return undefined;
    }
    const byte = encoded.charCodeAt(state.index) - 63;
    state.index += 1;
    if (byte < 0) {
      return undefined;
    }
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) {
      break;
    }
    if (shift > 30) {
      return undefined;
    }
  }
  return (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
}

/**
 * Decode a Google-encoded polyline.
 *
 * MOTIS's `legGeometry.precision` is 6 on the live build, not Google's default
 * 5, so callers must pass the field through rather than assume.
 */
export function decodePolyline(encoded: string, precision = 5): Array<[number, number]> {
  const factor =
    Number.isInteger(precision) && precision >= 0 && precision <= 9 ? 10 ** precision : 1e5;
  const points: Array<[number, number]> = [];
  const state = { index: 0 };
  let lat = 0;
  let lon = 0;
  while (state.index < encoded.length) {
    const latDelta = decodeValue(encoded, state);
    const lonDelta = decodeValue(encoded, state);
    if (latDelta === undefined || lonDelta === undefined) {
      break;
    }
    lat += latDelta;
    lon += lonDelta;
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/** Sum the great-circle length of a decoded polyline, in metres. */
export function polylineLengthM(points: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineM(points[index - 1], points[index]);
  }
  return total;
}

/**
 * Stable itinerary identity used for dedupe and React keys.
 *
 * MOTIS gives every itinerary the same `START`/`END` pseudostops, so using only
 * the first/last stop would collapse two real options with the same departure
 * time. The full ordered chain of transit stop ids (or the walk endpoints for a
 * walk-only trip) is the honest discriminator.
 */
export function itineraryKey(itinerary: ItineraryDto): string {
  const transit = itinerary.legs
    .filter((leg) => leg.mode !== 'walk')
    .map((leg) => `${stopKey(leg.from)}>${stopKey(leg.to)}`)
    .join('|');
  if (transit.length > 0) {
    return `${itinerary.startTime}|${transit}`;
  }
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  return `${itinerary.startTime}|walk|${first === undefined ? '' : stopKey(first.from)}>${
    last === undefined ? '' : stopKey(last.to)
  }`;
}

function stopKey(place: LegPlaceDto): string {
  return place.stopId ?? `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Zero-fare quote for a trip that needs no ticket at all. */
export function walkOnlyFare(): FareQuote {
  return {
    amount: 0,
    currency: 'PHP',
    confidence: 'official',
    effective_from: WALK_ONLY_EFFECTIVE_FROM,
    source_id: null,
    breakdown: [],
  };
}

function mapPlace(value: unknown): LegPlaceDto | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const name = asString(record.name);
  const lat = asNumber(record.lat);
  const lon = asNumber(record.lon);
  if (name === undefined || lat === undefined || lon === undefined) {
    return undefined;
  }
  const stopId = asString(record.stopId);
  return stopId === undefined ? { name, lat, lon } : { name, lat, lon, stopId };
}

function modeFromMotisMode(mode: string | undefined): LegMode | undefined {
  switch (mode) {
    case 'BUS':
    case 'COACH':
      return 'bus';
    case 'FERRY':
      return 'ferry';
    default:
      // SUBWAY/METRO/TRAM/RAIL without a route id cannot be attributed to
      // MRT-3/LRT-1/LRT-2, and v1 has no generic rail fare.
      return undefined;
  }
}

function declaredDistanceM(record: JsonRecord): number | undefined {
  const distance = asNumber(record.distance);
  return distance !== undefined && distance >= 0 ? distance : undefined;
}

function geometryDistanceM(record: JsonRecord): number | undefined {
  const geometry = asRecord(record.legGeometry);
  if (geometry === undefined) {
    return undefined;
  }
  const encoded = asString(geometry.points);
  if (encoded === undefined) {
    return undefined;
  }
  const precision = asNumber(geometry.precision);
  const points = decodePolyline(encoded, precision);
  return points.length < 2 ? undefined : polylineLengthM(points);
}

function landmarkHintFor(
  routeId: string | undefined,
  from: LegPlaceDto,
  to: LegPlaceDto,
  context: MapContext,
): string | null {
  if (routeId === undefined) {
    return null;
  }
  const normalized = normalizeRouteId(routeId);
  if (normalized === undefined) {
    return null;
  }
  const landmarks = context.curatedLandmarks.get(normalized);
  if (landmarks === undefined) {
    return null;
  }
  // The curated inventory publishes no landmark coordinates, so "nearest" can
  // only be resolved by matching the served stop name exactly. Anything else
  // honestly returns null instead of inventing a landmark.
  for (const place of [to, from]) {
    const match = landmarks.find(
      (landmark) => landmark.trim().toLowerCase() === place.name.trim().toLowerCase(),
    );
    if (match !== undefined) {
      return match;
    }
  }
  return null;
}

function mapLeg(raw: unknown, context: MapContext): MappedLeg | undefined {
  const record = asRecord(raw);
  if (record === undefined) {
    return undefined;
  }
  const motisMode = asString(record.mode)?.toUpperCase();
  const routeId = asString(record.routeId);

  let mode: LegMode | undefined;
  if (motisMode === 'WALK') {
    mode = 'walk';
  } else if (routeId !== undefined) {
    mode = modeFromRouteId(routeId);
  } else {
    mode = modeFromMotisMode(motisMode);
  }
  if (mode === undefined) {
    return undefined;
  }

  const from = mapPlace(record.from);
  const to = mapPlace(record.to);
  const startTime = asString(record.startTime) ?? asString(record.scheduledStartTime);
  const endTime = asString(record.endTime) ?? asString(record.scheduledEndTime);
  if (from === undefined || to === undefined || startTime === undefined || endTime === undefined) {
    return undefined;
  }

  const durationSeconds = asNumber(record.duration);
  const durationMin =
    durationSeconds !== undefined
      ? Math.max(0, Math.round(durationSeconds / 60))
      : Math.max(0, Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60_000));

  const chooseDeclaredFirst = mode === 'walk';
  const declared = declaredDistanceM(record);
  const fromGeometry = geometryDistanceM(record);
  const distanceM = chooseDeclaredFirst ? (declared ?? fromGeometry) : (fromGeometry ?? declared);
  if (distanceM === undefined) {
    // No distance means no defensible fare and no walk distance; dropping the
    // itinerary is better than emitting a ₱0 transit leg.
    return undefined;
  }

  const shortName = asString(record.routeShortName);
  const displayName = asString(record.displayName);
  const signageLabel = displayName ?? shortName;
  const headsign = asString(record.headsign);
  const normalizedRouteId = routeId === undefined ? undefined : normalizeRouteId(routeId);
  const freeRideOverride =
    normalizedRouteId !== undefined && context.freeRideRouteIds.has(normalizedRouteId);

  let quote: FareQuote | null = null;
  if (mode !== 'walk') {
    const fareMode = FARE_MODE_BY_LEG[mode];
    if (fareMode === undefined) {
      return undefined;
    }
    try {
      quote = quoteFareForLeg({
        mode: fareMode,
        distanceKm: distanceM / 1000,
        freeRideOverride,
      });
    } catch {
      // A p2p leg without an operator route fare is the only expected throw;
      // drop the itinerary instead of inventing a premium.
      return undefined;
    }
  }

  const sourceIds: SourceId[] = ['osm'];
  const curatedRoute =
    normalizedRouteId !== undefined && context.curatedRouteIds.has(normalizedRouteId);
  if ((mode === 'jeepney' || mode === 'uv-express') && curatedRoute) {
    // Only a route listed in the curated OSM Wiki inventory used that dataset.
    // OSM-relation-derived jeep/UV routes (most of the live feed) must not
    // claim it, or `sources` would name a dataset the leg never consulted.
    sourceIds.push('osm-wiki-jeepney');
  }
  if (quote !== null && quote.source_id !== null) {
    sourceIds.push(quote.source_id);
  }

  const dto: LegDto = {
    mode,
    from,
    to,
    startTime,
    endTime,
    durationMin,
    landmarkHint: landmarkHintFor(routeId, from, to, context),
    distanceM: Math.round(distanceM),
    sourceIds,
  };
  if (shortName !== undefined) {
    dto.routeShortName = shortName;
  }
  if (headsign !== undefined) {
    dto.headsign = headsign;
  }
  if (signageLabel !== undefined) {
    dto.signage = `Look for: ${signageLabel}`;
  }
  return { dto, quote };
}

function mapItinerary(raw: unknown, context: MapContext): ItineraryDto | undefined {
  const record = asRecord(raw);
  if (record === undefined) {
    return undefined;
  }
  const rawLegs = asArray(record.legs);
  if (rawLegs === undefined || rawLegs.length === 0) {
    return undefined;
  }
  const mappedLegs: MappedLeg[] = [];
  for (const rawLeg of rawLegs) {
    const leg = mapLeg(rawLeg, context);
    if (leg === undefined) {
      // One unsupported mode (e.g. PNR) makes the whole itinerary unpriceable.
      return undefined;
    }
    mappedLegs.push(leg);
  }
  const legs = mappedLegs.map((leg) => leg.dto);

  const startTime = asString(record.startTime) ?? legs[0].startTime;
  const endTime = asString(record.endTime) ?? legs[legs.length - 1].endTime;
  const durationSeconds = asNumber(record.duration);
  const durationMin =
    durationSeconds !== undefined
      ? Math.max(0, Math.round(durationSeconds / 60))
      : legs.reduce((total, leg) => total + leg.durationMin, 0);

  const transitLegs = legs.filter((leg) => leg.mode !== 'walk');
  const reportedTransfers = asNumber(record.transfers);
  const transfers =
    reportedTransfers !== undefined && Number.isInteger(reportedTransfers) && reportedTransfers >= 0
      ? reportedTransfers
      : Math.max(0, transitLegs.length - 1);

  const quotes = mappedLegs.flatMap((leg) => (leg.quote === null ? [] : [leg.quote]));
  const fare = quotes.length > 0 ? sumFares(quotes) : walkOnlyFare();

  const sources = new Set<SourceId>();
  for (const leg of legs) {
    for (const sourceId of leg.sourceIds) {
      sources.add(sourceId);
    }
  }

  const draft: ItineraryDto = {
    id: '',
    durationMin,
    startTime,
    endTime,
    transfers,
    walkDistanceM: legs
      .filter((leg) => leg.mode === 'walk')
      .reduce((total, leg) => total + leg.distanceM, 0),
    modes: [...new Set(legs.map((leg) => leg.mode))],
    fare,
    sources: [...sources],
    legs,
  };
  return { ...draft, id: `it-${stableHash(itineraryKey(draft))}` };
}

/**
 * Map a MOTIS `/api/v6/plan` payload into v2 DTOs.
 *
 * Includes all-walk entries from MOTIS's separate `direct` array: a short trip
 * (e.g. Cubao to a point 200 m away) comes back only in `direct`, with
 * `itineraries: []`.
 */
export function mapPlanItineraries(payload: unknown, context: MapContext): ItineraryDto[] {
  const record = asRecord(payload);
  if (record === undefined) {
    return [];
  }
  const raw = [...(asArray(record.itineraries) ?? []), ...(asArray(record.direct) ?? [])];
  const itineraries: ItineraryDto[] = [];
  for (const entry of raw) {
    const itinerary = mapItinerary(entry, context);
    if (itinerary !== undefined) {
      itineraries.push(itinerary);
    }
  }
  return itineraries;
}
