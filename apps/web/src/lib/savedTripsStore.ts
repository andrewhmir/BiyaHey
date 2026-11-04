import type {
  DataSource,
  FareQuote,
  ItineraryDto,
  LegDto,
  LegPlaceDto,
  LegStopDto,
} from '@biyahey/shared';
import { deviceKey, readDeviceRecord, writeDeviceRecord } from './deviceStore';

/**
 * Saved and recent trips — the PWA's only saved-trip writer (R63/R66).
 *
 * Task 6 seeded this store behind the trip-detail Save CTA; Task 8 owns it now.
 * The storage key (`biyahey:v1:saved-trips`), the row shape
 * (`itinerary`, `sources`, `fareSnapshot`, `datasetVersion`, `savedAt`) and the
 * whole-row validation are preserved, so rows written by an older build keep
 * working and the Task 6 tests keep their guarantees. `nickname` is the one
 * additive field: the Saved list's rename action stores it on the same row.
 *
 * Validation rules (R66): every field a consumer reads is checked, nested
 * `LegDto.stops` included. A malformed row is dropped whole — never partially
 * normalised and handed to a renderer. Reads never throw; writes report whether
 * they persisted.
 *
 * `recent-trips` is the same row shape under its own key. A recent trip is a
 * trip the rider opened from a fresh `/plan` response; it expires 30 days after
 * it was viewed. Recents are recorded from plan data only, never from a saved
 * snapshot, so `savedAt` can never claim a fresh snapshot for old fare data.
 */

/** `biyahey:v1:saved-trips` — unchanged from Task 6. */
export const SAVED_TRIPS_RECORD = 'saved-trips';
export const SAVED_TRIPS_KEY = deviceKey(SAVED_TRIPS_RECORD);

/** Bound on the explicit save list. Saving again replaces by itinerary id. */
export const SAVED_TRIPS_LIMIT = 50;

/** `biyahey:v1:recent-trips` — Task 8's recents list. */
export const RECENT_TRIPS_RECORD = 'recent-trips';
export const RECENT_TRIPS_KEY = deviceKey(RECENT_TRIPS_RECORD);

/** Most recent trips kept; older entries are evicted even inside 30 days. */
export const RECENT_TRIPS_LIMIT = 20;

/** Spec §11 screen 5: a recent trip disappears after 30 days. */
export const RECENT_MAX_AGE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export interface SavedTrip {
  itinerary: ItineraryDto;
  /** Full provenance rows from the same response, so provenance works offline. */
  sources: DataSource[];
  /** The fare exactly as returned when the trip was snapshotted (never recomputed). */
  fareSnapshot: FareQuote;
  /** Dataset freshness label (derived from the provenance rows' `last_checked`). */
  datasetVersion: string;
  /** ISO timestamp of the snapshot (or of the view, for a recent trip). */
  savedAt: string;
  /** Rider's own label for the trip; absent means "use the route name". */
  nickname?: string;
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
  // PH-wide coverage: the `trike-` family. Without this, saving a plan that
  // uses a tricycle leg would be rejected on read-back and the Save CTA would
  // report a failure for a valid itinerary.
  'tricycle',
]);

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
      (line) => isRecord(line) && isNonEmptyString(line.label) && isFiniteNumber(line.amount),
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
  // row id, and a row without one is not addressable.
  if (!isNonEmptyString(value.datasetVersion) || !isIsoTimestamp(value.savedAt)) {
    return undefined;
  }
  if (!Array.isArray(sources) || !sources.every(isSource)) {
    return undefined;
  }
  const nickname = value.nickname;
  if (nickname !== undefined && !isNonEmptyString(nickname)) {
    // A blank nickname would render an empty heading; treat the row as corrupt
    // rather than silently falling back to the route name (R66).
    return undefined;
  }
  const trip: SavedTrip = {
    itinerary,
    sources,
    fareSnapshot,
    datasetVersion: value.datasetVersion,
    savedAt: value.savedAt,
  };
  if (nickname !== undefined) {
    trip.nickname = nickname.trim();
  }
  return trip;
}

function normalizeSavedTripsPayload(payload: unknown): SavedTrip[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  return payload
    .map(normalizeSavedTrip)
    .filter((entry): entry is SavedTrip => entry !== undefined)
    .slice(0, SAVED_TRIPS_LIMIT);
}

function normalizeRecentTripsPayload(payload: unknown): SavedTrip[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  return payload
    .map(normalizeSavedTrip)
    .filter((entry): entry is SavedTrip => entry !== undefined)
    .slice(0, RECENT_TRIPS_LIMIT);
}

/** Dataset freshness label for the snapshot; never invents a build id. */
export function datasetVersionFor(sources: readonly DataSource[]): string {
  const checked = sources
    .map((source) => source.last_checked)
    .filter((date): date is string => typeof date === 'string' && date.length > 0)
    .sort();
  return checked[checked.length - 1] ?? 'unknown';
}

function entryFor(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
  now: Date,
): SavedTrip {
  return {
    itinerary,
    sources: [...sources],
    fareSnapshot: itinerary.fare,
    datasetVersion: datasetVersionFor(sources),
    savedAt: now.toISOString(),
  };
}

/** All saved trips, newest first, or `[]` when storage is absent/corrupt. */
export function readSavedTrips(): SavedTrip[] {
  return readDeviceRecord<SavedTrip[]>(SAVED_TRIPS_RECORD, normalizeSavedTripsPayload) ?? [];
}

/** The stored snapshot for `id`, or `undefined`. */
export function findSavedTrip(id: string): SavedTrip | undefined {
  return readSavedTrips().find((trip) => trip.itinerary.id === id);
}

/** True when `id` already has a stored snapshot. */
export function isTripSaved(id: string): boolean {
  return findSavedTrip(id) !== undefined;
}

/**
 * Save (or replace) one trip.
 *
 * Returns the stored entry, or `null` when storage refused the write (absent
 * storage, quota exceeded, private mode) or a read-back cannot find the entry.
 * Callers must only announce success for a non-null result. A re-save keeps the
 * rider's nickname instead of silently dropping it.
 */
export function saveTrip(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
  now: Date = new Date(),
): SavedTrip | null {
  const previous = findSavedTrip(itinerary.id);
  const entry = entryFor(itinerary, sources, now);
  if (previous?.nickname !== undefined) {
    entry.nickname = previous.nickname;
  }
  const rest = readSavedTrips().filter((trip) => trip.itinerary.id !== itinerary.id);
  if (!writeDeviceRecord(SAVED_TRIPS_RECORD, [entry, ...rest].slice(0, SAVED_TRIPS_LIMIT))) {
    return null;
  }
  // Read the entry back so a storage shim that silently no-ops is not
  // mistaken for a durable save. `savedAt` and the fare snapshot are compared,
  // not just the id: an older row with the same itinerary id would otherwise
  // make a no-op write look successful (M10).
  const persisted = readSavedTrips().find((trip) => trip.itinerary.id === itinerary.id);
  if (
    persisted === undefined ||
    persisted.savedAt !== entry.savedAt ||
    JSON.stringify(persisted.fareSnapshot) !== JSON.stringify(entry.fareSnapshot)
  ) {
    return null;
  }
  return entry;
}

/**
 * Remove one saved trip. Returns whether the store no longer contains it.
 * The caller keeps the removed row to offer undo via {@link restoreSavedTrip}.
 */
export function deleteSavedTrip(id: string): boolean {
  const entries = readSavedTrips();
  if (!entries.some((trip) => trip.itinerary.id === id)) {
    return false;
  }
  const next = entries.filter((trip) => trip.itinerary.id !== id);
  if (!writeDeviceRecord(SAVED_TRIPS_RECORD, next)) {
    return false;
  }
  return !readSavedTrips().some((trip) => trip.itinerary.id === id);
}

/**
 * Re-insert a previously deleted row unchanged (undo). The original `savedAt`
 * and fare snapshot are preserved — undo restores the rider's trip, it does not
 * refresh it into a falsely current one.
 */
export function restoreSavedTrip(trip: SavedTrip): boolean {
  const normalized = normalizeSavedTrip(trip);
  if (normalized === undefined) {
    return false;
  }
  const rest = readSavedTrips().filter(
    (entry) => entry.itinerary.id !== normalized.itinerary.id,
  );
  if (!writeDeviceRecord(SAVED_TRIPS_RECORD, [normalized, ...rest].slice(0, SAVED_TRIPS_LIMIT))) {
    return false;
  }
  return readSavedTrips().some(
    (entry) =>
      entry.itinerary.id === normalized.itinerary.id && entry.savedAt === normalized.savedAt,
  );
}

/**
 * Rename (or, with a blank name, un-name) a saved trip.
 *
 * Returns the updated row, or `null` when the trip is absent or the write did
 * not persist. The UI must not claim a rename that storage refused.
 */
export function renameSavedTrip(id: string, nickname: string): SavedTrip | null {
  const name = nickname.trim();
  const entries = readSavedTrips();
  const index = entries.findIndex((trip) => trip.itinerary.id === id);
  if (index === -1) {
    return null;
  }
  const current = entries[index];
  if (current === undefined) {
    return null;
  }
  const updated: SavedTrip = { ...current };
  if (name.length === 0) {
    delete updated.nickname;
  } else {
    updated.nickname = name;
  }
  const next = [...entries];
  next[index] = updated;
  if (!writeDeviceRecord(SAVED_TRIPS_RECORD, next)) {
    return null;
  }
  const persisted = readSavedTrips().find((trip) => trip.itinerary.id === id);
  if (persisted === undefined || (persisted.nickname ?? '') !== name) {
    return null;
  }
  return persisted;
}

/** All recent trips inside the 30-day window, newest first. Prunes the rest. */
export function readRecentTrips(now: Date = new Date()): SavedTrip[] {
  const all =
    readDeviceRecord<SavedTrip[]>(RECENT_TRIPS_RECORD, normalizeRecentTripsPayload) ?? [];
  const cutoff = now.getTime() - RECENT_MAX_AGE_DAYS * MS_PER_DAY;
  const fresh = all.filter((trip) => {
    const viewedAt = Date.parse(trip.savedAt);
    return !Number.isNaN(viewedAt) && viewedAt >= cutoff;
  });
  if (fresh.length !== all.length) {
    writeDeviceRecord(RECENT_TRIPS_RECORD, fresh);
  }
  return fresh;
}

/**
 * Record a trip the rider just opened from a fresh plan response.
 *
 * Re-opening the same itinerary refreshes its position and snapshot time. Only
 * plan data is ever recorded here; opening a saved snapshot does not, so an old
 * fare can never be stamped as newly updated.
 */
export function recordRecentTrip(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
  now: Date = new Date(),
): SavedTrip | null {
  const entry = entryFor(itinerary, sources, now);
  const rest = readRecentTrips(now).filter((trip) => trip.itinerary.id !== itinerary.id);
  if (
    !writeDeviceRecord(RECENT_TRIPS_RECORD, [entry, ...rest].slice(0, RECENT_TRIPS_LIMIT))
  ) {
    return null;
  }
  const persisted = readRecentTrips(now).some(
    (trip) => trip.itinerary.id === itinerary.id && trip.savedAt === entry.savedAt,
  );
  return persisted ? entry : null;
}
