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
  | 'p2p';

/** One endpoint of a leg, as the PWA renders it. */
export interface LegPlaceDto {
  name: string;
  lat: number;
  lon: number;
  /** GTFS stop id when the endpoint is a served stop rather than an input pin. */
  stopId?: string;
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
   * encoded polyline. The v1 DTO deliberately carries no geometry: the PWA
   * draws routes from its own map layer and a polyline would multiply the
   * response size without being used.
   */
  distanceM: number;
  /** Dataset ids this leg drew on (network plus fare source). */
  sourceIds: SourceId[];
}

/** One journey option returned by `POST /plan`. */
export interface ItineraryDto {
  id: string;
  durationMin: number;
  startTime: string;
  endTime: string;
  transfers: number;
  walkDistanceM: number;
  /** Distinct modes in travel order, including `walk`. */
  modes: string[];
  fare: FareQuote;
  /** Union of the leg source ids, in provenance registry order. */
  sources: SourceId[];
  legs: LegDto[];
}

/** A coordinate pair the caller wants to travel between. */
export interface PlanPlaceInput {
  lat: number;
  lon: number;
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
