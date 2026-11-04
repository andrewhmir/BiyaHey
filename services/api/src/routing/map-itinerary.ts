import type {
  FareMode,
  FareQuote,
  ItineraryDto,
  LegDto,
  LegGeometryDto,
  LegMode,
  LegPlaceDto,
  LegStopDto,
  SourceId,
} from '@biyahey/shared';
import { decodePolyline, quoteFareForLeg, sumFares } from '@biyahey/shared';
import { haversineM } from '../domain/geo.js';

/**
 * A mapped tricycle terminal loaded from the build artifact
 * (`data/build/tricycle-terminals.json`, build root `/data`).
 *
 * Only `name` and the coordinates are used by the mapper: the hint annotates a
 * walk leg, it never becomes a route. `osmId`/`kind` are carried for callers
 * that want the provenance of the terminal; the artifact is the source of
 * truth and rows missing coordinates are dropped by the loader.
 */
export interface TricycleTerminal {
  osmId?: string;
  /** Published display name, or an empty string when the row had none. */
  name: string;
  lat: number;
  lon: number;
  kind?: string;
}

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
  /**
   * Mapped tricycle terminals used only to annotate walk legs (PH-wide
   * coverage D5). Empty when the build artifact is absent, in which case walk
   * legs stay unhinted and no error is raised.
   */
  tricycleTerminals: readonly TricycleTerminal[];
}

/** Walk legs within this radius of a mapped terminal carry a hint. */
export const TRICYCLE_HINT_RADIUS_M = 300;

/** Honest label used when a terminal artifact row published no name. */
export const GENERIC_TRICYCLE_TERMINAL_NAME = 'Tricycle terminal';

/**
 * Raw (unrounded) duration in seconds of every mapped leg, keyed per itinerary.
 *
 * The guard must judge speed from the seconds MOTIS reported, not from the
 * whole-minute `durationMin` it rounds to: a 1.4-minute leg would otherwise look
 * 40% faster than it is. The property is symbol-keyed and non-enumerable, so it
 * never appears in the HTTP response.
 */
const RAW_LEG_DURATION_SECONDS = Symbol('rawLegDurationSeconds');

type ItineraryWithRawDurations = ItineraryDto & {
  [RAW_LEG_DURATION_SECONDS]?: ReadonlyArray<number | undefined>;
};

interface MappedLeg {
  dto: LegDto;
  quote: FareQuote | null;
  /** Raw MOTIS leg duration in seconds; drives the plausibility guard. */
  durationSeconds?: number;
}

/** Route-id families whose first segment is the mode contract (R29). */
const ROUTE_ID_PATTERN = /^(?:[a-z0-9]+_)?(rail|bus|jeep|uv|ferry|trike)-(.+)$/i;

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
 *
 * Ferry ids are the Pasig River Ferry (MMDA, free) only: `ferry-prfs…`. The
 * feed also carries long-distance ferries (`ferry-manilacoron`,
 * `ferry-maniladavao…`) that are not MMDA services and have no v1 fare; pricing
 * them as the free PRFS service would be false, so they return `undefined` too
 * and the plan route counts them as unsupported. The publish stage also
 * excludes both families from the built feed, so this is a defence in depth.
 *
 * `trike-` ids are the PH-wide-coverage tricycle family (OSM-mapped e-trike
 * corridors and the curated tricycle inventory). They map to `tricycle`; the
 * mode has no published fare source, so `mapLeg` marks the fare gap instead of
 * pricing it.
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
      return suffix.startsWith('prfs') ? 'ferry' : undefined;
    case 'trike':
      return 'tricycle';
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
 * Standalone `P2P` token in a route's published labels.
 *
 * P2P (premium point-to-point) shuttles exist in the national OSM feed as
 * ordinary `bus-` route ids: GTFS carries no P2P marker, OSM only labels them
 * through `network=P2P` and their names. v1 has no machine-readable P2P route
 * fare (ruling R48), so such a leg must be served but **not** priced by the
 * ordinary-city-bus matrix — that would state a fare no operator publishes and
 * contradict the record that P2P is deferred. Detection is deliberately narrow:
 * only the labels MOTIS publishes (displayName / routeShortName / headsign) with
 * the token `P2P` delimited from other characters; never inferred from shape,
 * distance or operator.
 */
const P2P_LABEL_PATTERN = /(?:^|[^a-z0-9])p2p(?:[^a-z0-9]|$)/i;

function isP2pServiceLabel(record: JsonRecord): boolean {
  return [asString(record.displayName), asString(record.routeShortName), asString(record.headsign)].some(
    (label) => label !== undefined && P2P_LABEL_PATTERN.test(label),
  );
}

/**
 * Map a leg mode to the fare engine's mode.
 *
 * `bus-` legs are priced as ordinary city buses and `uv-` legs as traditional
 * UV Express: the GTFS route id carries no aircon/class distinction, so v1
 * chooses the cheaper documented class instead of guessing a premium.
 *
 * P2P is formally deferred in v1 (ruling R48): MOTIS exposes PT2-style services
 * as ordinary `bus-` routes and the feed publishes no machine-readable per-route
 * P2P fare, so the adapter never emits a `p2p` leg and `/plan` never claims P2P.
 * The fare engine's `p2p` rule stays for a later phase.
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

/**
 * Re-exported from `@biyahey/shared` for API-side consumers and tests.
 *
 * The decoder itself lives in the browser-safe shared package because the PWA
 * decodes the same `LegDto.geometry` to draw the route line: one implementation
 * means the shape the map plots is exactly the shape the fare distance was
 * measured from. See `decodePolyline` there for the encoding contract.
 */
export { decodePolyline };

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

/** One MOTIS intermediate stop mapped to the served `LegStopDto` shape. */
function mapStop(value: unknown): LegStopDto | undefined {
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
  const stop: LegStopDto = { name, lat, lon };
  const stopId = asString(record.stopId);
  if (stopId !== undefined) {
    stop.stopId = stopId;
  }
  const arrivalTime = asString(record.arrival);
  if (arrivalTime !== undefined) {
    stop.arrivalTime = arrivalTime;
  }
  const departureTime = asString(record.departure);
  if (departureTime !== undefined) {
    stop.departureTime = departureTime;
  }
  return stop;
}

/** Dedupe identity for a served stop: stop id when present, else name + coords. */
function servedStopKey(stop: LegStopDto): string {
  return (
    stop.stopId ?? `${stop.name.trim().toLowerCase()}|${stop.lat.toFixed(5)}|${stop.lon.toFixed(5)}`
  );
}

/**
 * Map MOTIS `leg.intermediateStops` into the served stop list (R61).
 *
 * MOTIS includes only the stops between boarding and alighting, so the board
 * stop (`leg.from`) and alight stop (`leg.to`) are prepended/appended from the
 * leg's own endpoints. The result is board first, intermediates in travel
 * order, alight last, deduplicated by stop id (or name + coordinates when the
 * router sent no id). The alight stop always stays last: a duplicate
 * intermediate is dropped instead of displacing it.
 *
 * Returns `undefined` for a response with no intermediate stops, which keeps
 * walk-only and older payloads free of the additive `stops` field.
 */
function mapTransitStops(
  record: JsonRecord,
  from: LegPlaceDto,
  to: LegPlaceDto,
  startTime: string,
  endTime: string,
): LegStopDto[] | undefined {
  const rawStops = asArray(record.intermediateStops);
  if (rawStops === undefined || rawStops.length === 0) {
    return undefined;
  }
  const intermediates = rawStops
    .map(mapStop)
    .filter((stop): stop is LegStopDto => stop !== undefined);
  if (intermediates.length === 0) {
    // The router sent a list but none of it was a usable stop: do not present
    // a fabricated two-stop ride as if it were the whole shape.
    return undefined;
  }

  const fromRecord = asRecord(record.from);
  const toRecord = asRecord(record.to);
  const board: LegStopDto = { name: from.name, lat: from.lat, lon: from.lon };
  if (from.stopId !== undefined) {
    board.stopId = from.stopId;
  }
  // The leg's own start is the honest fallback when MOTIS omits the stop time.
  board.departureTime =
    (fromRecord === undefined ? undefined : asString(fromRecord.departure)) ?? startTime;

  const alight: LegStopDto = { name: to.name, lat: to.lat, lon: to.lon };
  if (to.stopId !== undefined) {
    alight.stopId = to.stopId;
  }
  alight.arrivalTime = (toRecord === undefined ? undefined : asString(toRecord.arrival)) ?? endTime;

  const alightKey = servedStopKey(alight);
  const seen = new Set<string>([servedStopKey(board)]);
  const middle: LegStopDto[] = [];
  for (const stop of intermediates) {
    const key = servedStopKey(stop);
    if (key === alightKey || seen.has(key)) {
      continue;
    }
    seen.add(key);
    middle.push(stop);
  }
  return [board, ...middle, alight];
}

function modeFromMotisMode(mode: string | undefined): LegMode | undefined {
  switch (mode) {
    case 'BUS':
    case 'COACH':
      return 'bus';
    default:
      // SUBWAY/METRO/TRAM/RAIL without a route id cannot be attributed to
      // MRT-3/LRT-1/LRT-2, and v1 has no generic rail fare. FERRY without a
      // route id likewise cannot be proven to be the free MMDA PRFS service;
      // pricing it as free would be a false claim.
      return undefined;
  }
}

function declaredDistanceM(record: JsonRecord): number | undefined {
  const distance = asNumber(record.distance);
  return distance !== undefined && distance >= 0 ? distance : undefined;
}

/** MOTIS polyline precision assumed when `legGeometry.precision` is unusable. */
const DEFAULT_POLYLINE_PRECISION = 5;

/**
 * Map one raw MOTIS `legGeometry` into the additive DTO field.
 *
 * The encoded string is copied through untouched — consumers need the original
 * bytes to decode at the precision it was written with — while the decoded
 * vertices are used here to prove the shape is drawable and to keep the
 * existing geometry-derived distance fallback. A `precision` that is missing or
 * not an integer 0..9 falls back to the polyline algorithm's default of 5
 * rather than silently decoding at an arbitrary scale. A shape with fewer than
 * two finite vertices cannot be drawn as a line, so the field is left absent
 * instead of carried as a degenerate shape.
 */
function decodeLegGeometry(
  record: JsonRecord,
): { dto: LegGeometryDto; lengthM: number } | undefined {
  const geometry = asRecord(record.legGeometry);
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
  return { dto: { points, precision }, lengthM: polylineLengthM(decoded) };
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

/**
 * Nearest mapped tricycle terminal within {@link TRICYCLE_HINT_RADIUS_M} of a
 * walk leg's start or end, as the additive `LegDto.tricycleHint`.
 *
 * The hint is evidence that a terminal exists near the walk, not evidence of a
 * served route: terminals are point features, so the mapper never turns this
 * into a tricycle leg. A terminal with no published name keeps the generic
 * label. An empty terminal list (artifact absent) returns `undefined`.
 */
function tricycleTerminalHint(
  from: LegPlaceDto,
  to: LegPlaceDto,
  terminals: readonly TricycleTerminal[],
): LegDto['tricycleHint'] | undefined {
  let best: LegDto['tricycleHint'];
  let bestDistanceM = Number.POSITIVE_INFINITY;
  for (const terminal of terminals) {
    if (!Number.isFinite(terminal.lat) || !Number.isFinite(terminal.lon)) {
      continue;
    }
    for (const place of [from, to]) {
      const distanceM = haversineM([place.lat, place.lon], [terminal.lat, terminal.lon]);
      if (!Number.isFinite(distanceM) || distanceM > TRICYCLE_HINT_RADIUS_M) {
        continue;
      }
      if (distanceM < bestDistanceM) {
        bestDistanceM = distanceM;
        const name = terminal.name.trim();
        best = {
          terminalName: name.length > 0 ? name : GENERIC_TRICYCLE_TERMINAL_NAME,
          distanceM: Math.round(distanceM),
        };
      }
    }
  }
  return best;
}

/**
 * Sentinel returned by {@link mapLeg} when the leg is a mode/route family v1
 * deliberately does not price (unsupported rail, non-PRFS ferry, P2P, ...).
 *
 * It is distinct from `undefined`, which means the leg was malformed. The
 * distinction lets `/plan` count unsupported-mode drops in a response header
 * without claiming every malformed payload was an unsupported mode.
 */
const UNSUPPORTED_MODE = Symbol('unsupportedMode');

/** Sentinel returned by {@link mapItinerary} for an unsupported-mode itinerary. */
const UNSUPPORTED_ITINERARY = Symbol('unsupportedItinerary');

type LegMapResult = MappedLeg | typeof UNSUPPORTED_MODE | undefined;

function mapLeg(raw: unknown, context: MapContext): LegMapResult {
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
    return UNSUPPORTED_MODE;
  }

  const from = mapPlace(record.from);
  const to = mapPlace(record.to);
  const startTime = asString(record.startTime) ?? asString(record.scheduledStartTime);
  const endTime = asString(record.endTime) ?? asString(record.scheduledEndTime);
  if (from === undefined || to === undefined || startTime === undefined || endTime === undefined) {
    return undefined;
  }

  const declaredDurationSeconds = asNumber(record.duration);
  const timestampDurationSeconds = (Date.parse(endTime) - Date.parse(startTime)) / 1000;
  const rawDurationSeconds =
    declaredDurationSeconds ??
    (Number.isFinite(timestampDurationSeconds) ? timestampDurationSeconds : undefined);
  const durationMin =
    rawDurationSeconds === undefined ? 0 : Math.max(0, Math.round(rawDurationSeconds / 60));

  const chooseDeclaredFirst = mode === 'walk';
  const declared = declaredDistanceM(record);
  const legGeometry = decodeLegGeometry(record);
  const fromGeometry = legGeometry?.lengthM;
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

  // A P2P service has no machine-readable route fare (ruling R48) and is not an
  // ordinary city bus, so it is carried unpriced instead of mispriced.
  const p2pService = mode !== 'walk' && isP2pServiceLabel(record);
  const fareNotPublished = mode === 'tricycle' || p2pService;
  let quote: FareQuote | null = null;
  if (fareNotPublished) {
    // No published fare source exists for this leg (tricycle: PH-wide coverage
    // R4/R11; P2P: R48). It is carried with `fareNotPublished` below and
    // excluded from the itinerary sum; pricing it with another mode's matrix
    // would invent an amount.
  } else if (mode !== 'walk') {
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
  if (fareNotPublished) {
    // Additive marker, never an amount: the itinerary total excludes this leg
    // and carries `fareIncomplete` (see `mapItinerary`).
    dto.fareNotPublished = true;
  }
  if (mode === 'walk') {
    const hint = tricycleTerminalHint(from, to, context.tricycleTerminals);
    if (hint !== undefined) {
      // A hint only annotates a walk leg. The mapper never synthesizes a
      // tricycle leg from a terminal: the route is not in the dataset.
      dto.tricycleHint = hint;
    }
  }
  if (shortName !== undefined) {
    dto.routeShortName = shortName;
  }
  if (headsign !== undefined) {
    dto.headsign = headsign;
  }
  if (signageLabel !== undefined) {
    dto.signage = `Look for: ${signageLabel}`;
  }
  if (legGeometry !== undefined) {
    // Additive: the PWA draws the real road shape when this is present and
    // falls back to the leg endpoints when it is not.
    dto.geometry = legGeometry.dto;
  }
  if (mode !== 'walk') {
    const stops = mapTransitStops(record, from, to, startTime, endTime);
    if (stops !== undefined) {
      dto.stops = stops;
    }
  }
  return rawDurationSeconds === undefined
    ? { dto, quote }
    : { dto, quote, durationSeconds: rawDurationSeconds };
}

function mapItinerary(
  raw: unknown,
  context: MapContext,
): ItineraryDto | typeof UNSUPPORTED_ITINERARY | undefined {
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
    if (leg === UNSUPPORTED_MODE) {
      // One unsupported mode (PNR, non-PRFS ferry, P2P, ...) makes the whole
      // itinerary unpriceable; the caller counts it instead of mispricing it.
      return UNSUPPORTED_ITINERARY;
    }
    if (leg === undefined) {
      return undefined;
    }
    mappedLegs.push(leg);
  }
  const legs = mappedLegs.map((leg) => leg.dto);

  // Spec §9: a walk between two transit legs is the informal-transfer leg. The
  // flag is set only where it is true, so access/egress walks and walk-only
  // trips stay unlabelled rather than carrying a misleading `false`.
  const hasTransitBefore = (index: number): boolean =>
    legs.slice(0, index).some((leg) => leg.mode !== 'walk');
  const hasTransitAfter = (index: number): boolean =>
    legs.slice(index + 1).some((leg) => leg.mode !== 'walk');
  legs.forEach((leg, index) => {
    if (leg.mode === 'walk' && hasTransitBefore(index) && hasTransitAfter(index)) {
      leg.informalTransfer = true;
    }
  });

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
  // At least one leg has no published fare source (a tricycle leg today): the
  // total is the sum of the priced legs only, and the flag stops the UI from
  // presenting that partial sum as a complete fare.
  if (legs.some((leg) => leg.fareNotPublished === true)) {
    draft.fareIncomplete = true;
  }
  const itinerary: ItineraryWithRawDurations = {
    ...draft,
    id: `it-${stableHash(itineraryKey(draft))}`,
  };
  // Attach the raw timings the guard needs without changing the served DTO.
  Object.defineProperty(itinerary, RAW_LEG_DURATION_SECONDS, {
    value: mappedLegs.map((leg) => leg.durationSeconds),
    enumerable: false,
  });
  return itinerary;
}

/**
 * Plausibility guard for mapped itineraries (R10 data-defect mitigation).
 *
 * The published feed carries OSM route relations whose shapes and
 * `stop_times` disagree: `bus-61`, for example, has stops ~893 m apart with
 * two-minute spacing, yet one leg's shape is 70,231 m long in the same two
 * minutes. MOTIS maps that geometry onto the leg, `mapLeg` falls back to the
 * geometry distance for transit legs, and the fare engine then prices 70 km of
 * "travel". That is how a Cubao->Ayala plan acquired PHP 406.98 "options" that
 * no vehicle could run — a data defect, not a provincial-bus choice.
 *
 * A transit leg is implausible when its implied speed exceeds
 * {@link MAX_TRANSIT_SPEED_KMH}. 120 km/h is above the fastest legs the current
 * feed keeps (~105 km/h on two golden corridors) and far below the 743-2,107 km/h
 * the bad shapes imply. It is a gross-defect net, not proof of realism: the kept
 * 104-105 km/h legs are themselves implausible for NCR traffic, and tightening the
 * net depends on the GTFS rebuild recorded in the phase-1 acceptance runbook.
 * Long-distance provincial buses are not pruned by this: a genuine 100 km run in
 * 90 minutes (67 km/h) passes.
 *
 * `durationMin` is rounded to whole minutes, so speed is judged from the raw
 * MOTIS seconds attached by the mapper instead: a 1.4-minute leg would otherwise
 * look 40% faster than it is and could be dropped for a legitimate ~90 km/h ride.
 * DTOs without that metadata (hand-built fixtures) fall back to `durationMin`
 * with a 30-second floor: a sub-minute hop is not penalised, but a kilometre
 * claimed in "0 minutes" still is.
 *
 * A geometry-to-straight-line ratio guard is deliberately NOT applied: a route
 * that crosses the Pasig River can legitimately drive several kilometres
 * between stops that are 1 km apart, so a ratio rule would prune valid
 * itineraries. The speed rule catches the observed defect without that risk.
 */
export const MAX_TRANSIT_SPEED_KMH = 120;

/** Floor for a missing or rounded-to-zero duration; see {@link MAX_TRANSIT_SPEED_KMH}. */
const MIN_EVALUATED_DURATION_MIN = 0.5;

/** One transit leg that fails the plausibility guard. */
export interface ImplausibleLeg {
  legIndex: number;
  mode: LegMode;
  distanceM: number;
  durationMin: number;
  impliedSpeedKmh: number;
}

/**
 * Duration used to judge implied speed, in minutes: the raw mapped seconds when
 * present, else the rounded DTO minute with the sub-minute floor.
 */
function guardDurationMin(leg: LegDto, rawSeconds: number | undefined): number {
  if (rawSeconds !== undefined && rawSeconds > 0) {
    return rawSeconds / 60;
  }
  return Math.max(leg.durationMin, MIN_EVALUATED_DURATION_MIN);
}

/**
 * List the transit legs of `itinerary` whose implied speed exceeds
 * {@link MAX_TRANSIT_SPEED_KMH}. Walk legs are never flagged: walking distance
 * is a declared MOTIS value, not a route-shape artefact.
 */
export function implausibleTransitLegs(itinerary: ItineraryDto): ImplausibleLeg[] {
  const flagged: ImplausibleLeg[] = [];
  const rawDurations = (itinerary as ItineraryWithRawDurations)[RAW_LEG_DURATION_SECONDS];
  itinerary.legs.forEach((leg, legIndex) => {
    if (leg.mode === 'walk') {
      return;
    }
    const evaluatedDurationMin = guardDurationMin(leg, rawDurations?.[legIndex]);
    const impliedSpeedKmh = leg.distanceM / 1000 / (evaluatedDurationMin / 60);
    if (impliedSpeedKmh > MAX_TRANSIT_SPEED_KMH) {
      flagged.push({
        legIndex,
        mode: leg.mode,
        distanceM: leg.distanceM,
        durationMin: leg.durationMin,
        impliedSpeedKmh: Math.round(impliedSpeedKmh),
      });
    }
  });
  return flagged;
}

/** True when every transit leg of `itinerary` passes the plausibility guard. */
export function isPlausibleItinerary(itinerary: ItineraryDto): boolean {
  return implausibleTransitLegs(itinerary).length === 0;
}

/** Result of {@link mapPlanItinerariesDetailed}. */
export interface DetailedMapResult {
  itineraries: ItineraryDto[];
  /**
   * Stable keys for itineraries dropped because they contain a mode/route
   * family v1 does not price. Keys let `/plan` dedupe the count across its
   * three MOTIS attempts, like the plausibility guard does.
   */
  unsupportedKeys: string[];
}

/**
 * A stable identity for an unsupported raw itinerary.
 *
 * It cannot use {@link itineraryKey} (no DTO exists). The departure time plus
 * the ordered route ids/modes is enough to recognise the same option arriving
 * on the base call and the +10-minute retry.
 */
function unsupportedItineraryKey(record: JsonRecord): string {
  const legs = asArray(record.legs) ?? [];
  const identity = legs
    .map((entry) => {
      const leg = asRecord(entry);
      if (leg === undefined) {
        return '?';
      }
      return asString(leg.routeId) ?? asString(leg.mode)?.toUpperCase() ?? '?';
    })
    .join('>');
  return `${asString(record.startTime) ?? asString(record.scheduledStartTime) ?? ''}|${identity}`;
}

/**
 * Map a MOTIS `/api/v6/plan` payload and report unsupported-mode drops.
 *
 * `mapPlanItineraries` is the simple view over this function: it ignores the
 * count. `/plan` uses this one to expose
 * `x-biyahey-unsupported-dropped`, so a PNR or long-distance-ferry option
 * disappears visibly instead of silently.
 */
export function mapPlanItinerariesDetailed(
  payload: unknown,
  context: MapContext,
): DetailedMapResult {
  const record = asRecord(payload);
  if (record === undefined) {
    return { itineraries: [], unsupportedKeys: [] };
  }
  const raw = [...(asArray(record.itineraries) ?? []), ...(asArray(record.direct) ?? [])];
  const itineraries: ItineraryDto[] = [];
  const unsupportedKeys: string[] = [];
  for (const entry of raw) {
    const itinerary = mapItinerary(entry, context);
    if (itinerary === UNSUPPORTED_ITINERARY) {
      const rawRecord = asRecord(entry);
      if (rawRecord !== undefined) {
        unsupportedKeys.push(unsupportedItineraryKey(rawRecord));
      }
      continue;
    }
    if (itinerary !== undefined) {
      itineraries.push(itinerary);
    }
  }
  return { itineraries, unsupportedKeys };
}

/**
 * Map a MOTIS `/api/v6/plan` payload into v2 DTOs.
 *
 * Includes all-walk entries from MOTIS's separate `direct` array: a short trip
 * (e.g. Cubao to a point 200 m away) comes back only in `direct`, with
 * `itineraries: []`.
 */
export function mapPlanItineraries(payload: unknown, context: MapContext): ItineraryDto[] {
  return mapPlanItinerariesDetailed(payload, context).itineraries;
}
