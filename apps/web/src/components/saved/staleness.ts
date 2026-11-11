import type { SavedTrip } from '../../lib/saved';

const MS_PER_DAY = 86_400_000;

/** A saved snapshot older than this is stale (spec §11 screen 5). */
export const SAVED_MAX_AGE_DAYS = 30;

/** The only fare source `GET /fares/status` reports; other quotes cannot be compared. */
export const PUV_FARE_SOURCE_ID = 'ltfrb-fares';

export type SavedStaleness = 'fresh' | 'unknown' | 'fare-changed' | 'expired';

/** True when the quote is priced by the LTFRB PUV matrix the status endpoint reports. */
export function isPuvFare(row: SavedTrip): boolean {
  return row.itinerary.fare.source_id === PUV_FARE_SOURCE_ID;
}

export function savedAgeDays(row: SavedTrip, now: Date = new Date()): number {
  const savedAt = Date.parse(row.savedAt);
  return Number.isNaN(savedAt) ? Number.POSITIVE_INFINITY : (now.getTime() - savedAt) / MS_PER_DAY;
}

/**
 * Which honest label a saved row deserves. `unknown` means there is no evidence
 * either way (offline, or a rail/ferry/mixed quote the PUV matrix cannot price):
 * never present that as fresh.
 */
export function stalenessOf(
  row: SavedTrip,
  matrixEffectiveFrom: string | undefined,
  now: Date = new Date(),
): SavedStaleness {
  if (savedAgeDays(row, now) > SAVED_MAX_AGE_DAYS) return 'expired';
  if (!isPuvFare(row) || matrixEffectiveFrom === undefined) return 'unknown';
  if (row.itinerary.fare.effective_from !== matrixEffectiveFrom) return 'fare-changed';
  return 'fresh';
}
