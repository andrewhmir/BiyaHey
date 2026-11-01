import type { SavedTrip } from '../../lib/savedTripsStore';

/**
 * Saved-trip staleness (spec §11 screen 5, plan Task 8).
 *
 * A saved trip is stale when EITHER
 * - the fare matrix has changed since the snapshot
 *   (`fareSnapshot.effective_from` differs from the current matrix date the API
 *   reports on `GET /fares/status`), OR
 * - the snapshot is more than 30 days old.
 *
 * The date comparison is the only fare test here: the PWA never recomputes a
 * fare (R45), it compares the API's own effectivity dates. When the current
 * matrix date is unknown (offline, request failed, still loading) the trip is
 * neither certified fresh nor claimed stale — {@link stalenessOf} returns
 * `unknown`, and the screen says the fare *may* have changed while labelling the
 * ETA as a saved snapshot.
 *
 * **The matrix comparison only applies to unambiguously PUV quotes (R73).**
 * `GET /fares/status` is the LTFRB PUV matrix only (`FARE_MATRIX_EFFECTIVE_FROM`
 * in `packages/shared/src/fares.ts`), while rail, ferry and mixed itineraries
 * carry dates from their own matrices. Comparing a rail snapshot's
 * `effective_from` with the PUV date would flag a fare that did not change, and
 * printing the PUV date next to a rail snapshot would state a fact about a
 * matrix that does not price it. Rail/ferry/mixed (`source_id: null`) and
 * unknown-source snapshots therefore rely on the 30-day age rule alone and
 * report `unknown` while young; the screen never shows them the PUV date.
 */

/** Spec §11 screen 5: a saved snapshot older than this is stale. */
export const SAVED_TRIP_MAX_AGE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** The only fare source whose effectivity date `GET /fares/status` reports. */
export const PUV_FARE_SOURCE_ID = 'ltfrb-fares';

export type SavedTripStaleness = 'fresh' | 'unknown' | 'fare-changed' | 'expired';

/** True when the quote is unambiguously priced by the PUV matrix (R73). */
export function isPuvFareSnapshot(trip: SavedTrip): boolean {
  return trip.fareSnapshot.source_id === PUV_FARE_SOURCE_ID;
}

/** Age in days; `Infinity` for an unreadable timestamp (defensive only). */
export function savedTripAgeDays(trip: SavedTrip, now: Date = new Date()): number {
  const savedAt = Date.parse(trip.savedAt);
  if (Number.isNaN(savedAt)) {
    return Number.POSITIVE_INFINITY;
  }
  return (now.getTime() - savedAt) / MS_PER_DAY;
}

/** True when `savedAt` is strictly more than 30 days before `now`. */
export function isSavedTripExpired(trip: SavedTrip, now: Date = new Date()): boolean {
  return savedTripAgeDays(trip, now) > SAVED_TRIP_MAX_AGE_DAYS;
}

/**
 * The plan's two-condition staleness rule.
 *
 * Returns `undefined` when there is no evidence either way (M5): the matrix
 * date is unknown, or the quote is not PUV-priced and the PUV matrix cannot
 * speak for it. `undefined` must never be rendered as freshness. The age rule
 * is evidence on its own, so an expired trip is still `true` offline.
 */
export function isStale(
  trip: SavedTrip,
  currentMatrixEffectiveFrom?: string,
  now: Date = new Date(),
): boolean | undefined {
  if (isSavedTripExpired(trip, now)) {
    return true;
  }
  if (!isPuvFareSnapshot(trip) || currentMatrixEffectiveFrom === undefined) {
    return undefined;
  }
  return trip.fareSnapshot.effective_from !== currentMatrixEffectiveFrom;
}

/**
 * Which honest label a saved row deserves.
 *
 * `unknown` is deliberate: offline the PWA cannot check the API's matrix date,
 * and a rail/ferry/mixed quote is not priced by the PUV matrix even when the
 * API answers. In both cases the snapshot must not be certified as current.
 */
export function stalenessOf(
  trip: SavedTrip,
  currentMatrixEffectiveFrom?: string,
  now: Date = new Date(),
): SavedTripStaleness {
  if (isSavedTripExpired(trip, now)) {
    return 'expired';
  }
  if (!isPuvFareSnapshot(trip) || currentMatrixEffectiveFrom === undefined) {
    return 'unknown';
  }
  if (trip.fareSnapshot.effective_from !== currentMatrixEffectiveFrom) {
    return 'fare-changed';
  }
  return 'fresh';
}
