import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';

/**
 * Minimal saved-trips store seeded by the trip-detail Save CTA (R63).
 *
 * Task 8 owns the Saved/Recent list, the 30-day recent expiry and the offline
 * UI; it may relocate or extend this module. The contract this seed fixes is
 * the storage key and the snapshot fields:
 *
 * - `biyahey:v1:saved-trips` — versioned localStorage namespace shared with the
 *   search cache.
 * - one entry per itinerary (saving again replaces the previous entry).
 * - `fareSnapshot` and `sources` are copied as returned by the API, so an old
 *   trip can compare its fare later without a network call.
 * - `datasetVersion` identifies the snapshot's dataset freshness. Plan 1 does
 *   not expose a manifest build id on `PlanResponse`, so this is derived from
 *   the provenance rows' `last_checked` dates; Task 8 should replace it with
 *   the manifest id if the API starts publishing one.
 * - `savedAt` is an ISO timestamp.
 *
 * Storage is corrupt-safe like `searchCache`: a bad row is dropped instead of
 * crashing the screen, and a failed write is swallowed because saving is a
 * convenience, not correctness.
 */
export const SAVED_TRIPS_KEY = 'biyahey:v1:saved-trips';

/** Bounds the seed until Task 8 owns expiry; saving again replaces by id. */
export const SAVED_TRIPS_LIMIT = 50;

export interface SavedTrip {
  itinerary: ItineraryDto;
  sources: DataSource[];
  fareSnapshot: FareQuote;
  datasetVersion: string;
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFareQuote(value: unknown): value is FareQuote {
  if (!isRecord(value)) {
    return false;
  }
  const breakdown = value.breakdown;
  return (
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    value.currency === 'PHP' &&
    (value.confidence === 'official' || value.confidence === 'estimated') &&
    typeof value.effective_from === 'string' &&
    Array.isArray(breakdown) &&
    breakdown.every(
      (line) =>
        isRecord(line) &&
        typeof line.label === 'string' &&
        typeof line.amount === 'number' &&
        Number.isFinite(line.amount),
    )
  );
}

function isPlace(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value.lon === 'number' &&
    Number.isFinite(value.lon)
  );
}

function isLeg(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.mode === 'string' &&
    isPlace(value.from) &&
    isPlace(value.to) &&
    typeof value.startTime === 'string' &&
    typeof value.endTime === 'string' &&
    typeof value.durationMin === 'number' &&
    Number.isFinite(value.durationMin) &&
    typeof value.distanceM === 'number' &&
    Number.isFinite(value.distanceM) &&
    Array.isArray(value.sourceIds)
  );
}

function isItinerary(value: unknown): value is ItineraryDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.durationMin === 'number' &&
    typeof value.startTime === 'string' &&
    typeof value.endTime === 'string' &&
    Array.isArray(value.legs) &&
    value.legs.every(isLeg) &&
    isFareQuote(value.fare)
  );
}

function isSource(value: unknown): value is DataSource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    typeof value.attribution === 'string' &&
    Array.isArray(value.used_for)
  );
}

function normalizeSavedTrip(value: unknown): SavedTrip | undefined {
  if (!isRecord(value) || !isItinerary(value.itinerary) || !isFareQuote(value.fareSnapshot)) {
    return undefined;
  }
  if (typeof value.datasetVersion !== 'string' || typeof value.savedAt !== 'string') {
    return undefined;
  }
  const sources = Array.isArray(value.sources)
    ? value.sources.filter((source): source is DataSource => isSource(source))
    : [];
  return {
    itinerary: value.itinerary,
    sources,
    fareSnapshot: value.fareSnapshot,
    datasetVersion: value.datasetVersion,
    savedAt: value.savedAt,
  };
}

function writeEntries(entries: readonly SavedTrip[]): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(SAVED_TRIPS_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or private mode: saving must not throw at the rider.
  }
}

/** All saved trips, newest first, or `[]` when storage is absent/corrupt. */
export function readSavedTrips(): SavedTrip[] {
  const store = storage();
  if (store === null) {
    return [];
  }
  try {
    const raw = store.getItem(SAVED_TRIPS_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeSavedTrip)
      .filter((entry): entry is SavedTrip => entry !== undefined)
      .slice(0, SAVED_TRIPS_LIMIT);
  } catch {
    return [];
  }
}

/** Dataset freshness label for the snapshot; never invents a build id. */
export function datasetVersionFor(sources: readonly DataSource[]): string {
  const checked = sources
    .map((source) => source.last_checked)
    .filter((date): date is string => typeof date === 'string' && date.length > 0)
    .sort();
  return checked[checked.length - 1] ?? 'unknown';
}

/**
 * Save (or replace) one trip. Returns the stored entry so a caller can report
 * what was written without re-reading storage.
 */
export function saveTrip(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
  now: Date = new Date(),
): SavedTrip {
  const entry: SavedTrip = {
    itinerary,
    sources: [...sources],
    fareSnapshot: itinerary.fare,
    datasetVersion: datasetVersionFor(sources),
    savedAt: now.toISOString(),
  };
  const rest = readSavedTrips().filter((trip) => trip.itinerary.id !== itinerary.id);
  writeEntries([entry, ...rest].slice(0, SAVED_TRIPS_LIMIT));
  return entry;
}

/** True when `id` already has a stored snapshot. */
export function isTripSaved(id: string): boolean {
  return readSavedTrips().some((trip) => trip.itinerary.id === id);
}
