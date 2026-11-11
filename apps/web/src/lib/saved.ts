import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { datasetVersion } from './format';

/** One saved route: the itinerary as planned, plus the data it came from. */
export interface SavedTrip {
  itinerary: ItineraryDto;
  sources: DataSource[];
  /** ISO timestamp of the snapshot. */
  savedAt: string;
  /** Rider's own label; absent means "use the route name". */
  nickname?: string;
  /** Origin/destination labels the rider typed when planning (when known). */
  fromLabel?: string;
  toLabel?: string;
}

/** Optional labels recorded with a trip snapshot. */
export interface TripLabels {
  from?: string;
  to?: string;
}

const PLATFORM_NAME = /^(platform|start|end|origin|destination)\b/i;

/** A leg place name, ignoring router placeholders like `END` / `Platform 12`. */
function cleanEndpointName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return PLATFORM_NAME.test(trimmed) ? '' : trimmed;
}

/** The best origin/destination labels an itinerary alone can supply. */
export function itineraryEndpoints(itinerary: ItineraryDto): { from: string; to: string } {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  const from = cleanEndpointName(first?.from.name) || cleanEndpointName(last?.to.name);
  const to = cleanEndpointName(last?.to.name) || cleanEndpointName(first?.from.name);
  return { from, to };
}

const SAVED_KEY = 'biyahey.v3:saved';
const RECENT_KEY = 'biyahey.v3:recents';
const SAVED_LIMIT = 50;
const RECENT_LIMIT = 20;
const RECENT_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function readList(key: string): SavedTrip[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedTrip);
  } catch {
    return [];
  }
}

function isSavedTrip(value: unknown): value is SavedTrip {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  const itinerary = row.itinerary as Record<string, unknown> | undefined;
  return (
    typeof row.savedAt === 'string' &&
    Array.isArray(row.sources) &&
    typeof itinerary === 'object' &&
    itinerary !== null &&
    typeof itinerary.id === 'string' &&
    Array.isArray(itinerary.legs) &&
    itinerary.legs.length > 0
  );
}

function writeList(key: string, rows: SavedTrip[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

export function listSaved(): SavedTrip[] {
  return readList(SAVED_KEY);
}

export function findSaved(id: string): SavedTrip | undefined {
  return listSaved().find((row) => row.itinerary.id === id);
}

export function isSaved(id: string): boolean {
  return findSaved(id) !== undefined;
}

export function saveTrip(
  itinerary: ItineraryDto,
  sources: DataSource[],
  labels: TripLabels = {},
): boolean {
  const rows = listSaved().filter((row) => row.itinerary.id !== itinerary.id);
  const row: SavedTrip = {
    itinerary,
    sources,
    savedAt: new Date().toISOString(),
    ...(labels.from ? { fromLabel: labels.from } : {}),
    ...(labels.to ? { toLabel: labels.to } : {}),
  };
  return writeList(SAVED_KEY, [row, ...rows].slice(0, SAVED_LIMIT));
}

export function deleteSaved(id: string): boolean {
  return writeList(
    SAVED_KEY,
    listSaved().filter((row) => row.itinerary.id !== id),
  );
}

export function renameSaved(id: string, nickname: string): boolean {
  const trimmed = nickname.trim();
  const rows = listSaved().map((row) =>
    row.itinerary.id === id
      ? trimmed.length === 0
        ? { itinerary: row.itinerary, sources: row.sources, savedAt: row.savedAt }
        : { ...row, nickname: trimmed }
      : row,
  );
  return writeList(SAVED_KEY, rows);
}

export function listRecents(): SavedTrip[] {
  const cutoff = Date.now() - RECENT_MAX_AGE_DAYS * MS_PER_DAY;
  return readList(RECENT_KEY).filter((row) => {
    const savedAt = Date.parse(row.savedAt);
    return Number.isFinite(savedAt) && savedAt >= cutoff;
  });
}

/** Record a freshly opened plan (never a saved snapshot) as a recent trip. */
export function recordRecent(
  itinerary: ItineraryDto,
  sources: DataSource[],
  labels: TripLabels = {},
): void {
  const rows = listRecents().filter((row) => row.itinerary.id !== itinerary.id);
  const row: SavedTrip = {
    itinerary,
    sources,
    savedAt: new Date().toISOString(),
    ...(labels.from ? { fromLabel: labels.from } : {}),
    ...(labels.to ? { toLabel: labels.to } : {}),
  };
  writeList(RECENT_KEY, [row, ...rows].slice(0, RECENT_LIMIT));
}

/** A row's display title: the rider's nickname, else the destination label. */
export function tripTitle(row: SavedTrip): string {
  if (row.nickname !== undefined && row.nickname.trim().length > 0) return row.nickname;
  const stored = row.toLabel?.trim();
  if (stored !== undefined && stored.length > 0) return stored;
  return itineraryEndpoints(row.itinerary).to || '—';
}

/** The origin → destination pair a saved/recent row can display. */
export function tripEndpoints(row: SavedTrip): { from: string; to: string } {
  const fallback = itineraryEndpoints(row.itinerary);
  return {
    from: row.fromLabel?.trim() || fallback.from,
    to: row.toLabel?.trim() || fallback.to,
  };
}

/** The fare snapshot's honesty label (its effectivity date). */
export function fareEffectivity(row: SavedTrip): string {
  return row.itinerary.fare.effective_from;
}

/** The snapshot's data freshness label. */
export function snapshotVersion(row: SavedTrip): string {
  return datasetVersion(row.sources);
}
