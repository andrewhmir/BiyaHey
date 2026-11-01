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
 */

/** Spec §11 screen 5: a saved snapshot older than this is stale. */
export const SAVED_TRIP_MAX_AGE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export type SavedTripStaleness = 'fresh' | 'unknown' | 'fare-changed' | 'expired';

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
 * With no current matrix date, only the 30-day rule can be asserted; callers
 * must render the honest "unknown" snapshot label, not claim freshness.
 */
export function isStale(
  trip: SavedTrip,
  currentMatrixEffectiveFrom?: string,
  now: Date = new Date(),
): boolean {
  if (isSavedTripExpired(trip, now)) {
    return true;
  }
  return (
    currentMatrixEffectiveFrom !== undefined &&
    trip.fareSnapshot.effective_from !== currentMatrixEffectiveFrom
  );
}

/**
 * Which honest label a saved row deserves.
 *
 * `unknown` is deliberate: offline the PWA cannot check the API's matrix date,
 * so it must not certify the snapshot as current.
 */
export function stalenessOf(
  trip: SavedTrip,
  currentMatrixEffectiveFrom?: string,
  now: Date = new Date(),
): SavedTripStaleness {
  if (isSavedTripExpired(trip, now)) {
    return 'expired';
  }
  if (currentMatrixEffectiveFrom === undefined) {
    return 'unknown';
  }
  if (trip.fareSnapshot.effective_from !== currentMatrixEffectiveFrom) {
    return 'fare-changed';
  }
  return 'fresh';
}
