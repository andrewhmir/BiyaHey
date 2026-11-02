import type { SourceId } from './provenance.js';

/**
 * Every way a rider can pay a fare in v1 (spec §8.3).
 *
 * The spec stores fares as a `(mode, class)` pair; the union below flattens
 * that pair into one key so callers can switch exhaustively and the browser
 * bundle never has to carry the YAML config.
 */
export type FareMode =
  | 'jeepney'
  | 'modern-jeepney'
  | 'city-bus-ordinary'
  | 'city-bus-aircon'
  | 'provincial-bus-ordinary'
  | 'uv-express-traditional'
  | 'uv-express-modern'
  | 'p2p'
  | 'mrt3'
  | 'lrt2'
  | 'lrt1'
  | 'ferry';

/** One priced leg, with the provenance the UI must display (spec §8.3, §8.5). */
export interface FareQuote {
  /** Amount in PHP, rounded to 2 decimal places. */
  amount: number;
  currency: 'PHP';
  /**
   * `official` when the amount comes from a published primary source;
   * `estimated` when it is derived from a secondary or partial source (the
   * MRT-3/LRT-2 bands) or from an unverified free-ride override.
   */
  confidence: 'official' | 'estimated';
  /** ISO `YYYY-MM-DD` date the quoted fare took effect. */
  effective_from: string;
  /** Provenance registry id; `null` when a summed quote mixes sources. */
  source_id: SourceId | null;
  /** Itemised fare lines; the amounts sum to `amount`. */
  breakdown: { label: string; amount: number }[];
}

/**
 * `POST /fares/quote` response: a {@link FareQuote} plus the fare-matrix
 * staleness verdict the About-data and fare UI needs (spec §8.3).
 *
 * `stale` is computed from the quote's own `effective_from`, using the same
 * 183-day rule as {@link isFareStale}; the optional `today` request field makes
 * the check deterministic in tests.
 */
export interface FareQuoteResponse extends FareQuote {
  /** True when `effective_from` is more than 183 days before the checked date. */
  stale: boolean;
}

/** Input for one fareable leg of a journey. */
export interface LegFareInput {
  mode: FareMode;
  /** Leg distance in kilometres; must be finite and non-negative. */
  distanceKm: number;
  /** Required for `p2p`: the operator's route fare before the +15% premium. */
  routeFare?: number;
  /**
   * Set for LTFRB service-contracting routes (rail-hub jeepneys, EDSA
   * Carousel) whose free-ride status is unverified.
   */
  freeRideOverride?: boolean;
}
