import type { ItineraryDto, LegDto, LegGeometryDto, PlanPlaceInput, SourceId } from '@biyahey/shared';
import { decodePolyline } from '@biyahey/shared';
import { haversineM } from '../domain/geo.js';
import { polylineLengthM, walkOnlyFare } from './map-itinerary.js';

/**
 * Walking fallback synthesis (PH-wide coverage D4).
 *
 * When every MOTIS plan attempt returns zero usable itineraries, `/plan` still
 * owes the caller one honest answer: a walking estimate. This module builds
 * that single itinerary. It has two shapes:
 *
 * 1. **Routed road geometry** (preferred): the caller supplies a
 *    {@link MappedWalkGeometry} obtained from a direct-only MOTIS walk request
 *    (`transitModes=` empty, `directModes=WALK`; see `MotisClient.walkRoute` and
 *    Lead finding F1). The shape follows the walking graph, the duration is the
 *    router's own seconds, and `sources` cites `osm`.
 * 2. **Straight line** (last resort): a two-point polyline from origin to
 *    destination, duration at 4.5 km/h, and `approximate: true` on the leg so
 *    the PWA can label and style it as an estimate.
 *
 * Neither shape ever claims transit: no fare, no route name, no signage, no
 * stops, no schedule.
 */

/** Straight-line walking speed used for the honest last-resort estimate. */
export const WALK_FALLBACK_SPEED_KMH = 4.5;

const WALK_FALLBACK_SPEED_MPS = (WALK_FALLBACK_SPEED_KMH * 1000) / 3600; // 1.25 m/s

/**
 * Implied walking speed used only to SIZE the road-following walk request.
 *
 * It is deliberately slower than the displayed estimate speed: MOTIS needs
 * enough search budget to find a path that is longer than the straight line.
 */
export const WALK_ROUTING_SPEED_MPS = 1.2;

/** Multiplier over the haversine-implied time for the walk-request budget. */
export const WALK_ROUTING_SAFETY_FACTOR = 1.6;

/** One hour keeps a short-pair walk request useful without a tiny budget. */
export const MIN_MAX_DIRECT_TIME_SECONDS = 3_600;

/**
 * Six hours of computed walk (MOTIS `maxDirectTime` is in SECONDS).
 *
 * Beyond that, one request stops being cheap and the straight line is the
 * honest answer anyway: a pair that far apart is not a realistic walk, and the
 * brief's >25 km warning is UI copy rather than an API suppression.
 */
export const MAX_MAX_DIRECT_TIME_SECONDS = 21_600;

/** MOTIS's pinned build reports `precision: 6`; the algorithm default is 5. */
const DEFAULT_POLYLINE_PRECISION = 5;
const STRAIGHT_LINE_PRECISION = 6;

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

/** FNV-1a over the request identity; only needs to be stable, not secure. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Encode one signed integer as a Google-polyline value. */
function encodeSignedValue(value: number): string {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (encoded >= 0x20) {
    out += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  return out + String.fromCharCode(encoded + 63);
}

/** Encode `[lat, lon]` vertices as a Google polyline (same codec MOTIS uses). */
function encodePolyline(
  points: ReadonlyArray<readonly [number, number]>,
  precision: number,
): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLon = 0;
  let encoded = '';
  for (const [lat, lon] of points) {
    const latE6 = Math.round(lat * factor);
    const lonE6 = Math.round(lon * factor);
    encoded += encodeSignedValue(latE6 - lastLat) + encodeSignedValue(lonE6 - lastLon);
    lastLat = latE6;
    lastLon = lonE6;
  }
  return encoded;
}

/**
 * Routed walk geometry from a direct-only MOTIS walk response.
 *
 * `distanceM` is measured from the decoded polyline rather than copied from
 * MOTIS's declared `distance`, so the served distance is exactly the length of
 * the shape the PWA draws. `durationSeconds` stays in the router's unit
 * (seconds); the DTO conversion happens in {@link buildWalkFallback}.
 */
export interface MappedWalkGeometry {
  points: string;
  precision: number;
  /** Routed shape length in metres, measured from the decoded polyline. */
  distanceM: number;
  /** Router-reported walk duration in **seconds**. */
  durationSeconds: number;
}

/**
 * Extract usable walk geometry from a direct-only `/api/v6/plan` payload.
 *
 * F1: the walk is `direct[0]`, its shape is `legs[0].legGeometry` (precision 6)
 * and its duration is `direct[0].duration` in seconds. Anything missing or
 * malformed returns `undefined`, which sends the caller to the straight-line
 * branch instead of inventing a shape.
 */
export function mapRoutedWalk(payload: unknown): MappedWalkGeometry | undefined {
  const record = asRecord(payload);
  if (record === undefined) {
    return undefined;
  }
  const direct = asArray(record.direct);
  if (direct === undefined || direct.length === 0) {
    return undefined;
  }
  const itinerary = asRecord(direct[0]);
  if (itinerary === undefined) {
    return undefined;
  }
  const legs = asArray(itinerary.legs);
  if (legs === undefined || legs.length === 0) {
    return undefined;
  }
  const leg = asRecord(legs[0]);
  if (leg === undefined) {
    return undefined;
  }
  // A direct walk response should only ever carry WALK legs; refuse anything
  // else rather than draw a transit shape as a walking estimate.
  const mode = asString(leg.mode)?.toUpperCase();
  if (mode !== undefined && mode !== 'WALK') {
    return undefined;
  }

  const geometry = asRecord(leg.legGeometry);
  if (geometry === undefined) {
    return undefined;
  }
  const points = asString(geometry.points);
  if (points === undefined) {
    return undefined;
  }
  const reportedPrecision = asNumber(geometry.precision);
  const precision =
    reportedPrecision !== undefined &&
    Number.isInteger(reportedPrecision) &&
    reportedPrecision >= 0 &&
    reportedPrecision <= 9
      ? reportedPrecision
      : DEFAULT_POLYLINE_PRECISION;
  const decoded = decodePolyline(points, precision);
  if (
    decoded.length < 2 ||
    !decoded.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
  ) {
    return undefined;
  }
  const distanceM = polylineLengthM(decoded);
  if (!Number.isFinite(distanceM) || distanceM < 1) {
    return undefined;
  }

  const durationSeconds = asNumber(itinerary.duration) ?? asNumber(leg.duration);
  if (durationSeconds === undefined || durationSeconds <= 0) {
    return undefined;
  }
  return { points, precision, distanceM, durationSeconds };
}

/**
 * Budget for the direct walk request, in SECONDS, or `undefined` to skip it.
 *
 * The budget is the haversine-implied time at 1.2 m/s times a 1.6 safety
 * factor, floored at {@link MIN_MAX_DIRECT_TIME_SECONDS} and clamped at
 * {@link MAX_MAX_DIRECT_TIME_SECONDS}. When the haversine walk alone would
 * exceed the ceiling, no request is sent: the straight line is the honest
 * answer, and the brief's >25 km warning is UI copy, not API suppression.
 */
export function walkRouteMaxDirectTime(
  origin: PlanPlaceInput,
  destination: PlanPlaceInput,
): number | undefined {
  const distanceM = haversineM([origin.lat, origin.lon], [destination.lat, destination.lon]);
  const impliedSeconds = distanceM / WALK_ROUTING_SPEED_MPS;
  if (!Number.isFinite(impliedSeconds)) {
    return undefined;
  }
  if (impliedSeconds > MAX_MAX_DIRECT_TIME_SECONDS) {
    return undefined;
  }
  return Math.min(
    MAX_MAX_DIRECT_TIME_SECONDS,
    Math.max(
      MIN_MAX_DIRECT_TIME_SECONDS,
      Math.ceil(impliedSeconds * WALK_ROUTING_SAFETY_FACTOR),
    ),
  );
}

/** Input accepted by {@link buildWalkFallback}. */
export interface WalkFallbackInput {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  /** ISO 8601 departure; the fallback starts when the caller asked to leave. */
  departAt: string;
  /** Routed road geometry when a walking path exists; omit for straight line. */
  routedWalk?: MappedWalkGeometry;
}

/**
 * Build the single labelled walking estimate `/plan` serves when no transit
 * option exists.
 *
 * The DTO fulfils the Task 5 contract exactly: `fallback: 'walk'`, one walk
 * leg, zero fare, `sources` always contains `walk-estimate` (plus `osm` when
 * the shape is a routed OSM path), and `approximate: true` only on straight-line
 * geometry. The id is deterministic for identical input, so repeated identical
 * requests produce the same React key and no duplicate cache entries.
 */
export function buildWalkFallback(input: WalkFallbackInput): ItineraryDto {
  const haversine = haversineM(
    [input.origin.lat, input.origin.lon],
    [input.destination.lat, input.destination.lon],
  );
  const routed = input.routedWalk;
  const distanceM = routed === undefined ? Math.round(haversine) : Math.round(routed.distanceM);
  const durationSeconds =
    routed === undefined
      ? Math.max(distanceM > 0 ? 1 : 0, Math.ceil(haversine / WALK_FALLBACK_SPEED_MPS))
      : Math.max(0, Math.ceil(routed.durationSeconds));
  const durationMin = Math.ceil(durationSeconds / 60);

  const startMs = Date.parse(input.departAt);
  const endTime = Number.isFinite(startMs)
    ? new Date(startMs + durationSeconds * 1000).toISOString()
    : input.departAt;

  const sourceIds: SourceId[] =
    routed === undefined ? ['walk-estimate'] : ['osm', 'walk-estimate'];

  const geometry: LegGeometryDto =
    routed === undefined
      ? {
          points: encodePolyline(
            [
              [input.origin.lat, input.origin.lon],
              [input.destination.lat, input.destination.lon],
            ],
            STRAIGHT_LINE_PRECISION,
          ),
          precision: STRAIGHT_LINE_PRECISION,
        }
      : { points: routed.points, precision: routed.precision };

  const leg: LegDto = {
    mode: 'walk',
    from: { name: 'Origin', lat: input.origin.lat, lon: input.origin.lon },
    to: { name: 'Destination', lat: input.destination.lat, lon: input.destination.lon },
    startTime: input.departAt,
    endTime,
    durationMin,
    landmarkHint: null,
    distanceM,
    geometry,
    sourceIds: [...sourceIds],
  };
  if (routed === undefined) {
    // The shape is a straight line between the requested points, never a
    // routed path; the PWA must draw and label it as an estimate.
    leg.approximate = true;
  }

  const id = `it-walk-${stableHash(
    `${input.origin.lat},${input.origin.lon}>${input.destination.lat},${input.destination.lon}` +
      `|${input.departAt}|${routed === undefined ? 'straight' : 'routed'}`,
  )}`;

  return {
    id,
    fallback: 'walk',
    durationMin,
    startTime: input.departAt,
    endTime,
    transfers: 0,
    walkDistanceM: distanceM,
    modes: ['walk'],
    fare: walkOnlyFare(),
    sources: [...sourceIds],
    legs: [leg],
  };
}
