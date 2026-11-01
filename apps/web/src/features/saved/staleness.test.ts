import { describe, expect, it } from 'vitest';
import type { SavedTrip } from '../../lib/savedTripsStore';
import { planMrt3CubaoAyalaResponse } from '../../test/msw/handlers';
import {
  SAVED_TRIP_MAX_AGE_DAYS,
  isSavedTripExpired,
  isStale,
  savedTripAgeDays,
  stalenessOf,
} from './staleness';

const PLAN = planMrt3CubaoAyalaResponse;
const ITINERARY = PLAN.itineraries[0]!;
const NOW = new Date('2026-11-02T00:00:00.000Z');
const CURRENT_MATRIX = '2026-09-28';

function trip(
  savedAt = '2026-10-30T00:00:00.000Z',
  effectiveFrom = CURRENT_MATRIX,
): SavedTrip {
  return {
    itinerary: ITINERARY,
    sources: PLAN.sources,
    fareSnapshot: { ...ITINERARY.fare, effective_from: effectiveFrom },
    datasetVersion: '2026-11-01',
    savedAt,
  };
}

describe('isStale', () => {
  it('is fresh when the snapshot matches the current matrix and is under 30 days old', () => {
    expect(isStale(trip(), CURRENT_MATRIX, NOW)).toBe(false);
    expect(stalenessOf(trip(), CURRENT_MATRIX, NOW)).toBe('fresh');
  });

  it('is stale when the fare matrix date changed since the snapshot', () => {
    const snapshot = trip('2026-10-30T00:00:00.000Z', '2026-03-23');
    expect(isStale(snapshot, CURRENT_MATRIX, NOW)).toBe(true);
    expect(stalenessOf(snapshot, CURRENT_MATRIX, NOW)).toBe('fare-changed');
  });

  it('is stale once the snapshot is more than 30 days old', () => {
    expect(SAVED_TRIP_MAX_AGE_DAYS).toBe(30);
    const old = trip('2026-09-01T00:00:00.000Z', CURRENT_MATRIX);
    expect(isStale(old, CURRENT_MATRIX, NOW)).toBe(true);
    expect(stalenessOf(old, CURRENT_MATRIX, NOW)).toBe('expired');
  });

  it('cannot certify staleness or freshness from an unknown matrix', () => {
    // Strict two-condition rule: without the API date only the age rule fires.
    expect(isStale(trip('2026-10-30T00:00:00.000Z', '2026-03-23'), undefined, NOW)).toBe(false);
    expect(stalenessOf(trip(), undefined, NOW)).toBe('unknown');
    // But an expired trip is stale regardless of connectivity.
    expect(stalenessOf(trip('2026-09-01T00:00:00.000Z'), undefined, NOW)).toBe('expired');
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
