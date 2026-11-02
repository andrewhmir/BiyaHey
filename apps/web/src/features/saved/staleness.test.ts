import { describe, expect, it } from 'vitest';
import type { SavedTrip } from '../../lib/savedTripsStore';
import {
  planCubaoAyalaResponse,
  planMrt3CubaoAyalaResponse,
} from '../../test/msw/handlers';
import {
  PUV_FARE_SOURCE_ID,
  SAVED_TRIP_MAX_AGE_DAYS,
  isPuvFareSnapshot,
  isSavedTripExpired,
  isStale,
  savedTripAgeDays,
  stalenessOf,
} from './staleness';

const PLAN = planMrt3CubaoAyalaResponse;
const ITINERARY = PLAN.itineraries[0]!;
const PUV_FARE = planCubaoAyalaResponse.itineraries[0]!.fare;
const NOW = new Date('2026-11-02T00:00:00.000Z');
const CURRENT_MATRIX = '2026-09-28';

function trip(
  savedAt = '2026-10-30T00:00:00.000Z',
  effectiveFrom = CURRENT_MATRIX,
  sourceId: SavedTrip['fareSnapshot']['source_id'] = PUV_FARE_SOURCE_ID,
): SavedTrip {
  return {
    itinerary: ITINERARY,
    sources: PLAN.sources,
    fareSnapshot: { ...PUV_FARE, effective_from: effectiveFrom, source_id: sourceId },
    datasetVersion: '2026-11-01',
    savedAt,
  };
}

describe('isStale', () => {
  it('is fresh when a PUV snapshot matches the current matrix and is young', () => {
    expect(isPuvFareSnapshot(trip())).toBe(true);
    expect(isStale(trip(), CURRENT_MATRIX, NOW)).toBe(false);
    expect(stalenessOf(trip(), CURRENT_MATRIX, NOW)).toBe('fresh');
  });

  it('is stale when the PUV matrix date changed since the snapshot', () => {
    const snapshot = trip('2026-10-30T00:00:00.000Z', '2026-06-01');
    expect(isStale(snapshot, CURRENT_MATRIX, NOW)).toBe(true);
    expect(stalenessOf(snapshot, CURRENT_MATRIX, NOW)).toBe('fare-changed');
  });

  it('is stale once the snapshot is more than 30 days old', () => {
    expect(SAVED_TRIP_MAX_AGE_DAYS).toBe(30);
    const old = trip('2026-09-01T00:00:00.000Z', CURRENT_MATRIX);
    expect(isStale(old, CURRENT_MATRIX, NOW)).toBe(true);
    expect(stalenessOf(old, CURRENT_MATRIX, NOW)).toBe('expired');
  });

  it('returns undefined — never false — without matrix evidence', () => {
    // M5: `false` reads as a freshness claim. With no API matrix date there is
    // no evidence either way, so the boolean is `undefined`.
    expect(isStale(trip('2026-10-30T00:00:00.000Z', '2026-06-01'), undefined, NOW)).toBeUndefined();
    expect(stalenessOf(trip(), undefined, NOW)).toBe('unknown');
    // But an expired trip is stale regardless of connectivity.
    expect(stalenessOf(trip('2026-09-01T00:00:00.000Z'), undefined, NOW)).toBe('expired');
  });

  it('never compares a rail snapshot with the PUV-only matrix (R73)', () => {
    // The MRT-3 quote is effective 2026-03-23 from the rail matrix. The API's
    // 2026-09-28 date is the PUV matrix, so a difference is not evidence.
    const rail = trip('2026-10-30T00:00:00.000Z', '2026-03-23', 'rail-fares');
    expect(isPuvFareSnapshot(rail)).toBe(false);
    expect(isStale(rail, CURRENT_MATRIX, NOW)).toBeUndefined();
    expect(stalenessOf(rail, CURRENT_MATRIX, NOW)).toBe('unknown');

    // The 30-day age rule still applies to a rail snapshot.
    const oldRail = trip('2026-09-01T00:00:00.000Z', '2026-03-23', 'rail-fares');
    expect(isStale(oldRail, CURRENT_MATRIX, NOW)).toBe(true);
    expect(stalenessOf(oldRail, CURRENT_MATRIX, NOW)).toBe('expired');
  });

  it('treats a mixed/unknown-source quote as unknown too', () => {
    // `sumFares` sets `source_id: null` for a mixed itinerary.
    const mixed = trip('2026-10-30T00:00:00.000Z', '2026-09-28', null);
    expect(stalenessOf(mixed, CURRENT_MATRIX, NOW)).toBe('unknown');
    expect(isStale(mixed, CURRENT_MATRIX, NOW)).toBeUndefined();
  });
});

describe('age boundaries', () => {
  it('treats exactly 30 days as not yet expired and 30 days + 1 ms as expired', () => {
    expect(savedTripAgeDays(trip('2026-10-03T00:00:00.000Z'), NOW)).toBe(30);
    expect(isSavedTripExpired(trip('2026-10-03T00:00:00.000Z'), NOW)).toBe(false);
    expect(isSavedTripExpired(trip('2026-10-02T23:59:59.999Z'), NOW)).toBe(true);
  });

  it('treats an unreadable timestamp as infinitely old instead of fresh', () => {
    expect(savedTripAgeDays(trip('not-a-date'), NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(isSavedTripExpired(trip('not-a-date'), NOW)).toBe(true);
  });
});
