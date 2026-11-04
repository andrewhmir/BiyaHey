import type { DataSource, SourceId } from './provenance.js';
import type { FareQuote } from './types.js';

// Re-exported for the PWA through the browser-safe barrel. These are type-only
// re-exports: the compiled bundle never pulls in `provenance.ts`, which reads
// the registry from disk with `node:fs`.
export type { DataSource, SourceId } from './provenance.js';

/**
 * Every mode an itinerary leg can present in v1 (spec §8.2).
 *
 * `p2p` is part of the shared vocabulary but the MOTIS adapter does not emit it
 * yet: MOTIS exposes PT2-style routes as ordinary `bus-` route ids and publishes
 * no per-route fare, which the p2p fare rule requires.
 *
 * `tricycle` is the PH-wide-coverage vocabulary member for the `trike-` route
 * family. No current feed emits it, so it is additive at the wire level: a
 * payload that carries it is new, and old payloads that do not stay valid.
 */
export type LegMode =
  | 'walk'
  | 'jeepney'
  | 'bus'
  | 'mrt3'
  | 'lrt1'
  | 'lrt2'
  | 'ferry'
  | 'uv-express'
  | 'p2p'
  | 'tricycle';

/** One endpoint of a leg, as the PWA renders it. */
export interface LegPlaceDto {
  name: string;
  lat: number;
  lon: number;
  /** GTFS stop id when the endpoint is a served stop rather than an input pin. */
  stopId?: string;
}

/**
 * One stop on a transit leg, in the order the vehicle serves it (R61).
 *
 * A leg's `stops` list is board stop first, intermediate stops in travel order,
 * and alight stop last. The list is deduplicated by `stopId` when present, else
 * by name and coordinates. Times are copied from the router's `arrival` /
 * `departure` values: the board stop normally has only `departureTime` and the
 * alight stop only `arrivalTime`.
 *
 * The field is additive: it is absent on walk legs and on payloads whose
 * router response carried no intermediate stops, so older responses remain
 * valid and no `v` bump is needed.
 */
export interface LegStopDto {
  name: string;
  /** GTFS stop/platform id when the router reported a served stop. */
  stopId?: string;
  lat: number;
  lon: number;
  /** ISO 8601 arrival time; absent on the board stop. */
  arrivalTime?: string;
  /** ISO 8601 departure time; absent on the alight stop. */
  departureTime?: string;
}

/**
 * Encoded route shape for one leg, as the router reported it.
 *
 * `points` is a Google-encoded polyline over `[lat, lon]` **deltas**, not
 * GeoJSON order, scaled by `10 ** precision`. MOTIS's pinned build sends
 * `precision: 6` for every leg (the algorithm's default is 5), so consumers
 * must decode with the reported precision. The encoded string is carried
 * through untouched rather than as a decoded vertex list: it is roughly an
 * order of magnitude smaller on the wire, and both the API and the PWA already
 * have `decodePolyline` for it.
 */
export interface LegGeometryDto {
  points: string;
  precision: number;
}

/** One leg of an itinerary. */
export interface LegDto {
  mode: LegMode;
  from: LegPlaceDto;
  to: LegPlaceDto;
  /** ISO 8601 timestamp copied from the router. */
  startTime: string;
  /** ISO 8601 timestamp copied from the router. */
  endTime: string;
  /** Whole minutes; transfer buffers are added to this for presentation. */
  durationMin: number;
  routeShortName?: string;
  headsign?: string;
  /** Wayfinding line, always `Look for: <displayName ?? routeShortName>`. */
  signage?: string;
  /** Nearest curated stop landmark, or null when none can be derived. */
  landmarkHint: string | null;
  /**
   * Leg length in metres, derived from MOTIS's declared `distance` or from its
   * encoded polyline. The encoded shape itself travels in {@link geometry}
   * when the router sent one; this derived length stays the value every
   * consumer can rely on, including payloads without geometry.
   */
  distanceM: number;
  /**
   * Encoded route shape for this leg, copied from MOTIS's `legGeometry`.
   *
   * Additive and optional: payloads cached or built before the PWA drew real
   * route shapes carry no geometry, so consumers must fall back to the leg's
   * `from`→`to` segment instead of rejecting the response. Decode `points`
   * with {@link decodePolyline} before drawing; it is lat/lon-delta order, not
   * GeoJSON's lon/lat order.
   */
  geometry?: LegGeometryDto;
  /**
   * True when this leg's geometry is a straight-line estimate rather than a
   * routed path — the honest minimum for a walk fallback whose walking graph
   * has no path. Additive and optional: a routed leg omits the field rather
   * than sending `false`, so older payloads and cached itineraries keep
   * rendering and no `v` bump is needed.
   */
  approximate?: true;
  /**
   * True when this transit leg's fare has no published source, so the
   * itinerary total excludes it (see {@link ItineraryDto.fareIncomplete}). It
   * is never a guessed amount: the field marks the gap instead of pricing it.
   * Additive and optional: a priced leg omits the field rather than sending
   * `false`, so older payloads remain valid.
   */
  fareNotPublished?: true;
  /**
   * Present on a walk leg whose endpoint passes within 300 m of a mapped
   * tricycle terminal (PH-wide coverage D5). It is a hint, not a leg: the
   * route is not in the dataset, and the PWA must label it as not being one.
   * Additive and optional: walk legs with no nearby terminal omit it, so older
   * payloads and cached itineraries stay valid.
   */
  tricycleHint?: {
    /** Display name of the mapped terminal. */
    terminalName: string;
    /** Distance from the walk endpoint to the terminal, in whole metres. */
    distanceM: number;
  };
  /**
   * True for a walk leg that is a transfer between two transit legs (spec §9's
   * `informal_transfer` leg type). The PWA labels it as a transfer and applies
   * the presentation buffer; ordinary access/egress walks and lone walk-only
   * trips leave the field absent rather than `false`, so older payloads and
   * walk-only responses stay valid.
   */
  informalTransfer?: boolean;
  /** Dataset ids this leg drew on (network plus fare source). */
  sourceIds: SourceId[];
  /**
   * Served stops for a transit leg (R61): board stop first, intermediate stops
   * in travel order, alight stop last. Absent on walk legs and when the router
   * sent no intermediate stops; consumers must treat absence as "no stop list",
   * not as an empty list.
   */
  stops?: LegStopDto[];
}

/** One journey option returned by `POST /plan`. */
export interface ItineraryDto {
  id: string;
  /**
   * Set to `'walk'` only when this itinerary is a BiyaHey!-synthesised walking
   * estimate because the router found no transit option (PH-wide coverage D4).
   * Additive and optional: a routed itinerary omits the field rather than
   * sending `false`, so older payloads and cached itineraries stay valid and
   * `v` stays 1.
   */
  fallback?: 'walk';
  durationMin: number;
  startTime: string;
  endTime: string;
  transfers: number;
  walkDistanceM: number;
  /** Distinct modes in travel order, including `walk`. */
  modes: string[];
  fare: FareQuote;
  /**
   * True when {@link fare} excludes at least one leg whose fare has no
   * published source (see {@link LegDto.fareNotPublished}). Additive and
   * optional: a fully priced itinerary omits the field rather than sending
   * `false`, so older payloads remain valid and no `v` bump is needed.
   */
  fareIncomplete?: true;
  /** Union of the leg source ids, in provenance registry order. */
  sources: SourceId[];
  legs: LegDto[];
}

/** A coordinate pair the caller wants to travel between. */
export interface PlanPlaceInput {
  lat: number;
  lon: number;
}

/**
 * One optional intermediate stop for `POST /plan` (trip-planner R89).
 *
 * The router's `via` parameter accepts stop ids only, so a stop is carried as
 * the served stop id the search response put on `SearchResultDto.id` (a
 * `type: 'stop'` result). The coordinates stay in the request so the stop is a
 * place a caller can display and reason about, not an opaque router id.
 *
 * The router accepts at most two via stops; the BFF rejects a longer list.
 */
export interface PlanStopInput extends PlanPlaceInput {
  /** Served MOTIS/GTFS stop id (the `id` of a `type: 'stop'` search result). */
  stopId: string;
}

/** Re-ranking and display preferences accepted by `POST /plan`. */
export interface PlanPreferences {
  /** Cheapest first (fare ascending, then duration ascending). */
  cheapest?: boolean;
  /** Fewest transfers first (transfers ascending, then duration ascending). */
  fewestTransfers?: boolean;
  /** Drop itineraries with more transfers than this. */
  maxTransfers?: number;
  /** Minutes added to each transfer walk leg for presentation. */
  bufferMin?: number;
}

/** Request body for `POST /plan`. */
export interface PlanRequest {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  /**
   * Optional intermediate stops in travel order (trip-planner R89).
   *
   * Additive and optional: a request without it is byte-identical to the v1
   * contract. The BFF maps each `stopId` to the router's `via` parameter, which
   * accepts at most two stops.
   */
  stops?: PlanStopInput[];
  /** ISO 8601 departure; defaults to "now" when omitted. */
  departAt?: string;
  preferences?: PlanPreferences;
}

/** Response body for `POST /plan`. */
export interface PlanResponse {
  v: 1;
  itineraries: ItineraryDto[];
  /** Full provenance rows for every dataset the returned itineraries used. */
  sources: DataSource[];
}

/** A typeahead hit: a stop or a landmark/place. */
export interface SearchResultDto {
  id: string;
  name: string;
  /** Display label, e.g. `Cubao, Quezon City`. */
  label: string;
  type: 'stop' | 'landmark';
  lat: number;
  lon: number;
  /** City/municipality (admin level 6) when the geocoder reports one. */
  locality: string | null;
  /**
   * Great-circle distance from the caller's `near` point, in whole metres
   * (spec §10 requires a distance on search results). Omitted when `/search`
   * was called without `near`.
   */
  distanceM?: number;
  /**
   * `osm`: MOTIS geocodes the OSM-derived GTFS stops and OSM places. The
   * provenance registry also lists Photon, but this endpoint never calls it.
   */
  source_id: SourceId;
  /** MOTIS stop modes (BUS, SUBWAY, ...), when reported. */
  modes?: string[];
}

/** Grouped typeahead results. */
export interface SearchGroup {
  stops: SearchResultDto[];
  landmarks: SearchResultDto[];
  /** Reserved for a route-code search; always empty in v1. */
  routes: SearchResultDto[];
  /** Reserved for saved places; always empty in v1 (no accounts yet). */
  saved: SearchResultDto[];
}

/** Response body for `GET /search`. */
export interface SearchResponse {
  /**
   * True when the query is too short, the geocoder returned nothing, or some
   * raw results could not be mapped. The PWA keeps typing instead of showing
   * "no results" for a partial answer.
   */
  partial: boolean;
  groups: SearchGroup;
}

/**
 * Response body for `GET /fares/status` (spec §8.3's staleness rule).
 *
 * The PWA's About-data/fare footer can show whether the matrix is older than
 * six months without loading the YAML or reimplementing the date rule.
 */
export interface FareStatusDto {
  /** ISO `YYYY-MM-DD` effectivity date of the LTFRB PUV fare matrix. */
  effective_from: string;
  /** True when `effective_from` is more than `stale_after_days` before the check. */
  stale: boolean;
  /** The 183-day threshold the engine and CI use. */
  stale_after_days: number;
  /** ISO `YYYY-MM-DD` date the check was made against. */
  checked_on: string;
}

/**
 * Join already-loaded provenance rows into the attribution line the UI shows.
 *
 * This is the browser-safe counterpart of `attributionFor` in
 * `@biyahey/shared/provenance`: that helper loads the registry from disk with
 * `node:fs`, which a PWA bundle cannot carry. Here the caller passes the
 * `sources[]` array the API returned, so the PWA renders exactly the registry
 * order and wording the server sent — no duplicate attribution table, no Node
 * built-ins.
 *
 * Rows are joined with ` · ` in the order given (the API returns canonical
 * registry order), and blank attributions are skipped so a malformed row cannot
 * leave a stray separator.
 */
export function joinAttributions(sources: readonly DataSource[]): string {
  return sources
    .map((source) => source.attribution.trim())
    .filter((attribution) => attribution.length > 0)
    .join(' · ');
}

/** Read one signed polyline delta; returns `undefined` on malformed input. */
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
 * Decode a Google-encoded polyline into `[lat, lon]` pairs.
 *
 * This is the encoding MOTIS uses for `legGeometry`: each vertex is a signed
 * lat delta followed by a signed lon delta, scaled by `10 ** precision`.
 * MOTIS's pinned build sends `precision: 6`, not the algorithm's default 5, so
 * callers must pass the reported field through rather than assume. Truncated or
 * malformed input ends the decode at the last complete vertex; this function
 * never throws, so a corrupt cached payload cannot crash a render.
 *
 * It lives in the browser-safe shared package because the PWA draws the same
 * `LegDto.geometry` the API measures distance from: one implementation means
 * the plotted shape is exactly the shape the fare distance was derived from.
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
