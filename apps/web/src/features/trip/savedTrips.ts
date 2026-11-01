import type {
  DataSource,
  FareQuote,
  ItineraryDto,
  LegDto,
  LegPlaceDto,
  LegStopDto,
} from '@biyahey/shared';

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
 * Reads are corrupt-safe and validate every field a consumer can reach — nested
 * `LegDto.stops` included — so a malformed row is dropped whole instead of
 * being partially normalized and crashing a later renderer (R66). Writes report
 * whether they persisted; a failed write is never reported as a success.
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

const LEG_MODES: ReadonlySet<string> = new Set<string>([
  'walk',
  'jeepney',
  'bus',
  'mrt3',
  'lrt1',
  'lrt2',
  'ferry',
  'uv-express',
  'p2p',
]);

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Finite number guard shared by every numeric DTO field. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** ISO 8601 guard: a non-empty string `Date.parse` can read. */
function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFareQuote(value: unknown): value is FareQuote {
  if (!isRecord(value)) {
    return false;
  }
  const breakdown = value.breakdown;
  return (
    isFiniteNumber(value.amount) &&
    value.currency === 'PHP' &&
    (value.confidence === 'official' || value.confidence === 'estimated') &&
    isIsoTimestamp(value.effective_from) &&
    (value.source_id === null || typeof value.source_id === 'string') &&
    Array.isArray(breakdown) &&
    breakdown.every(
      (line) =>
        isRecord(line) &&
        isNonEmptyString(line.label) &&
        isFiniteNumber(line.amount),
    )
  );
}

function isPlace(value: unknown): value is LegPlaceDto {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isFiniteNumber(value.lat) &&
    isFiniteNumber(value.lon) &&
    isOptionalString(value.stopId)
  );
}

/** One served stop (R61): every field `StopsList` reads, and nothing invented. */
function isStop(value: unknown): value is LegStopDto {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isFiniteNumber(value.lat) &&
    isFiniteNumber(value.lon) &&
    isOptionalString(value.stopId) &&
    isOptionalString(value.arrivalTime) &&
    isOptionalString(value.departureTime)
  );
}

function isLeg(value: unknown): value is LegDto {
  return (
    isRecord(value) &&
    typeof value.mode === 'string' &&
    LEG_MODES.has(value.mode) &&
    isPlace(value.from) &&
    isPlace(value.to) &&
    isIsoTimestamp(value.startTime) &&
    isIsoTimestamp(value.endTime) &&
    isFiniteNumber(value.durationMin) &&
    isFiniteNumber(value.distanceM) &&
    (value.landmarkHint === null || typeof value.landmarkHint === 'string') &&
    isOptionalString(value.routeShortName) &&
    isOptionalString(value.headsign) &&
    isOptionalString(value.signage) &&
    (value.informalTransfer === undefined || typeof value.informalTransfer === 'boolean') &&
    isStringArray(value.sourceIds) &&
    (value.stops === undefined ||
      (Array.isArray(value.stops) && value.stops.every(isStop)))
  );
}

function isItinerary(value: unknown): value is ItineraryDto {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isFiniteNumber(value.durationMin) &&
    isIsoTimestamp(value.startTime) &&
    isIsoTimestamp(value.endTime) &&
    isFiniteNumber(value.transfers) &&
    isFiniteNumber(value.walkDistanceM) &&
    isStringArray(value.modes) &&
    isStringArray(value.sources) &&
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
    isStringArray(value.used_for)
  );
}

function normalizeSavedTrip(value: unknown): SavedTrip | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { itinerary, fareSnapshot, sources } = value;
  if (!isItinerary(itinerary) || !isFareQuote(fareSnapshot)) {
    return undefined;
  }
  // The row's identity is `itinerary.id`: the seed shape carries no separate
  // row id, and a row without one is not addressable by Task 8.
  if (!isNonEmptyString(value.datasetVersion) || !isIsoTimestamp(value.savedAt)) {
    return undefined;
  }
  if (!Array.isArray(sources) || !sources.every(isSource)) {
    return undefined;
  }
  return {
    itinerary,
    sources,
    fareSnapshot,
    datasetVersion: value.datasetVersion,
    savedAt: value.savedAt,
  };
}

/** Returns whether the store accepted the write. Never throws at the rider. */
function writeEntries(entries: readonly SavedTrip[]): boolean {
  const store = storage();
  if (store === null) {
    return false;
  }
  try {
    store.setItem(SAVED_TRIPS_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Quota exceeded or private mode: saving must not throw at the rider.
    return false;
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
 * Save (or replace) one trip.
 *
 * Returns the stored entry, or `null` when storage refused the write (absent
 * storage, quota exceeded, private mode) or a read-back cannot find the entry.
 * Callers must only announce success for a non-null result.
 */
export function saveTrip(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
  now: Date = new Date(),
): SavedTrip | null {
  const entry: SavedTrip = {
    itinerary,
    sources: [...sources],
    fareSnapshot: itinerary.fare,
    datasetVersion: datasetVersionFor(sources),
    savedAt: now.toISOString(),
  };
  const rest = readSavedTrips().filter((trip) => trip.itinerary.id !== itinerary.id);
  if (!writeEntries([entry, ...rest].slice(0, SAVED_TRIPS_LIMIT))) {
    return null;
  }
  // Read the entry back so a storage shim that silently no-ops is not
  // mistaken for a durable save.
  const persisted = readSavedTrips().some((trip) => trip.itinerary.id === itinerary.id);
  return persisted ? entry : null;
}

/** True when `id` already has a stored snapshot. */
export function isTripSaved(id: string): boolean {
  return readSavedTrips().some((trip) => trip.itinerary.id === id);
}
