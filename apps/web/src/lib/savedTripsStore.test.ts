import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planMrt3CubaoAyalaResponse } from '../test/msw/handlers';
import {
  RECENT_MAX_AGE_DAYS,
  RECENT_TRIPS_KEY,
  SAVED_TRIPS_KEY,
  datasetVersionFor,
  deleteSavedTrip,
  findSavedTrip,
  readRecentTrips,
  readSavedTrips,
  recordRecentTrip,
  renameSavedTrip,
  restoreSavedTrip,
  saveTrip,
  type SavedTrip,
} from './savedTripsStore';

const PLAN = planMrt3CubaoAyalaResponse;
const ITINERARY = PLAN.itineraries[0]!;

/** A valid stored row, exactly the Task 6 shape. */
function storedRow(patch: Partial<SavedTrip> = {}): SavedTrip {
  return {
    itinerary: ITINERARY,
    sources: PLAN.sources,
    fareSnapshot: ITINERARY.fare,
    datasetVersion: '2026-11-01',
    savedAt: '2026-10-30T08:00:00.000Z',
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('saved-trips store (Task 6 shape preserved)', () => {
  it('keeps the storage key and row shape unchanged', () => {
    expect(SAVED_TRIPS_KEY).toBe('biyahey:v1:saved-trips');
    expect(RECENT_TRIPS_KEY).toBe('biyahey:v1:recent-trips');

    const saved = saveTrip(ITINERARY, PLAN.sources, new Date('2026-11-01T08:00:00.000Z'));
    expect(saved).not.toBeNull();

    const envelope = JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY) ?? 'null') as {
      v: number;
      data: SavedTrip[];
    };
    expect(envelope.v).toBe(1);
    expect(envelope.data).toHaveLength(1);
    expect(envelope.data[0]).toMatchObject({
      itinerary: ITINERARY,
      sources: PLAN.sources,
      fareSnapshot: ITINERARY.fare,
      datasetVersion: '2026-11-01',
      savedAt: '2026-11-01T08:00:00.000Z',
    });
  });

  it('reads a legacy bare-array store written by Task 6', () => {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([storedRow()]));

    const rows = readSavedTrips();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.itinerary.id).toBe(ITINERARY.id);
    // The read migrates the legacy payload in place.
    expect(JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY) ?? 'null')).toMatchObject({ v: 1 });
  });

  it('drops a malformed row whole instead of partially normalising it', () => {
    const broken = [
      storedRow({ savedAt: 'garbage' }),
      { ...storedRow(), fareSnapshot: { ...ITINERARY.fare, amount: 'ten' } },
      {
        ...storedRow(),
        itinerary: {
          ...ITINERARY,
          legs: ITINERARY.legs.map((leg) =>
            leg.mode === 'mrt3' ? { ...leg, stops: [null] } : leg,
          ),
        },
      },
      storedRow({ sources: [null] as unknown as SavedTrip['sources'] }),
    ];
    for (const row of broken) {
      localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([storedRow(), row]));
      expect(readSavedTrips()).toHaveLength(1);
    }
  });

  it('renames a trip and keeps the nickname through a re-save', () => {
    saveTrip(ITINERARY, PLAN.sources, new Date('2026-11-01T08:00:00.000Z'));
    const renamed = renameSavedTrip(ITINERARY.id, '  Bahay → Opisina  ');
    expect(renamed?.nickname).toBe('Bahay → Opisina');
    expect(findSavedTrip(ITINERARY.id)?.nickname).toBe('Bahay → Opisina');

    // Re-saving the itinerary from the trip-detail CTA must not drop the name
    // the rider chose in the Saved list.
    saveTrip(ITINERARY, PLAN.sources, new Date('2026-11-02T08:00:00.000Z'));
    expect(findSavedTrip(ITINERARY.id)?.nickname).toBe('Bahay → Opisina');
    expect(findSavedTrip(ITINERARY.id)?.savedAt).toBe('2026-11-02T08:00:00.000Z');
  });

  it('clears a blank nickname back to the route name', () => {
    saveTrip(ITINERARY, PLAN.sources);
    renameSavedTrip(ITINERARY.id, 'Bahay');
    expect(renameSavedTrip(ITINERARY.id, '   ')?.nickname).toBeUndefined();
  });

  it('deletes and restores without changing the saved snapshot', () => {
    saveTrip(ITINERARY, PLAN.sources, new Date('2026-10-30T08:00:00.000Z'));
    const original = findSavedTrip(ITINERARY.id);
    expect(original).toBeDefined();

    expect(deleteSavedTrip(ITINERARY.id)).toBe(true);
    expect(readSavedTrips()).toEqual([]);

    if (original === undefined) {
      throw new Error('the trip disappeared before the undo assertion');
    }
    expect(restoreSavedTrip(original)).toBe(true);
    const restored = findSavedTrip(ITINERARY.id);
    expect(restored?.savedAt).toBe(original.savedAt);
    expect(restored?.fareSnapshot).toEqual(original.fareSnapshot);
  });

  it('reports a refused write instead of claiming the save', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    try {
      expect(saveTrip(ITINERARY, PLAN.sources)).toBeNull();
      expect(readSavedTrips()).toEqual([]);
    } finally {
      setItem.mockRestore();
    }
  });

  it('derives the dataset label from the newest provenance check date', () => {
    expect(datasetVersionFor(PLAN.sources)).toBe('2026-11-01');
    expect(datasetVersionFor([])).toBe('unknown');
  });
});

describe('recent trips', () => {
  const NOW = new Date('2026-11-02T00:00:00.000Z');

  function recentRow(id: string, savedAt: string): SavedTrip {
    return storedRow({ itinerary: { ...ITINERARY, id }, savedAt });
  }

  it('expires entries older than 30 days and prunes them from storage', () => {
    expect(RECENT_MAX_AGE_DAYS).toBe(30);
    localStorage.setItem(
      RECENT_TRIPS_KEY,
      JSON.stringify([
        recentRow('old-recent', '2026-09-01T00:00:00.000Z'),
        recentRow('fresh-recent', '2026-10-30T00:00:00.000Z'),
      ]),
    );

    expect(readRecentTrips(NOW).map((trip) => trip.itinerary.id)).toEqual(['fresh-recent']);
    const envelope = JSON.parse(localStorage.getItem(RECENT_TRIPS_KEY) ?? 'null') as {
      data: SavedTrip[];
    };
    expect(envelope.data.map((trip) => trip.itinerary.id)).toEqual(['fresh-recent']);
  });

  it('records a viewed trip once, newest first', () => {
    recordRecentTrip(ITINERARY, PLAN.sources, new Date('2026-10-31T00:00:00.000Z'));
    recordRecentTrip(
      { ...ITINERARY, id: 'second-recent' },
      PLAN.sources,
      new Date('2026-11-01T00:00:00.000Z'),
    );
    recordRecentTrip(ITINERARY, PLAN.sources, NOW);

    expect(readRecentTrips(NOW).map((trip) => trip.itinerary.id)).toEqual([
      ITINERARY.id,
      'second-recent',
    ]);
    expect(readRecentTrips(NOW)).toHaveLength(2);
  });
});
