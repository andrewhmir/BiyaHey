import type {
  DataSource,
  FareStatusDto,
  PlanRequest,
  PlanResponse,
  SearchResponse,
} from '@biyahey/shared';

/** The BFF origin. Vite inlines `VITE_API_URL`; localhost is the dev default. */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

/** One request fails fast on a mobile network; the plan has its own budget. */
const TIMEOUT_MS = 8_000;

/**
 * How long a cached BFF payload is trusted without another network read.
 *
 * Matches the BFF's `Cache-Control: max-age=60` on the two registry GETs: a
 * screen opened inside this window renders the snapshot and skips the network
 * (the idle prefetch or the previous screen already revalidated it), which is
 * what makes a repeat visit to About-data/Saved cost nothing. Past it the
 * snapshot is still painted immediately but revalidated in the background.
 */
const FRESH_MS = 60_000;

/** A tab left idle longer than this revalidates everything on the next read. */
const SESSION_TTL_MS = 10 * 60_000;

/** Session-storage keys are namespaced and versioned so a shape change cannot lie. */
const SESSION_PREFIX = 'biyahey.v1:swr:';

export type ApiErrorCode = 'network' | 'timeout' | 'aborted' | 'http';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;

  constructor(code: ApiErrorCode, message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: init.body === undefined ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok) {
      throw new ApiError('http', `API ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted === true) throw new ApiError('aborted', 'request cancelled', undefined, error);
    if (controller.signal.aborted) throw new ApiError('timeout', 'request timed out', undefined, error);
    throw new ApiError('network', 'network error', undefined, error);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

interface CachedPayload<T> {
  data: T;
  /** `Date.now()` when this payload last arrived from the network. */
  storedAt: number;
}

/**
 * In-memory SWR cache for the small deploy-static BFF payloads. It is the
 * cross-screen cache the app was missing: About-data and Saved can paint the
 * previous payload from the same visit before the revalidation lands.
 */
const memory = new Map<string, CachedPayload<unknown>>();

/**
 * One network read per key. The idle prefetch, the screen mount and a second
 * screen mounting mid-flight all await the same request, so a warm navigation
 * never double-fetches.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** A validator for data restored from sessionStorage; storage is not a type system. */
type Validator<T> = (value: unknown) => value is T;

function isDataSourceArray(value: unknown): value is DataSource[] {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof (row as { id?: unknown } | null)?.id === 'string')
  );
}

function isFareStatusDto(value: unknown): value is FareStatusDto {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.effective_from === 'string' &&
    typeof row.stale === 'boolean' &&
    typeof row.stale_after_days === 'number' &&
    typeof row.checked_on === 'string'
  );
}

function readSession<T>(key: string, valid: Validator<T>): CachedPayload<T> | undefined {
  try {
    const raw = window.sessionStorage.getItem(SESSION_PREFIX + key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const row = parsed as Record<string, unknown>;
    if (typeof row.storedAt !== 'number' || !Number.isFinite(row.storedAt)) return undefined;
    const age = Date.now() - row.storedAt;
    if (age < 0 || age > SESSION_TTL_MS) return undefined;
    if (!valid(row.data)) return undefined;
    return { data: row.data, storedAt: row.storedAt };
  } catch {
    // Storage can be blocked (private mode) or hold junk; the memory cache still works.
    return undefined;
  }
}

function writeSession<T>(key: string, entry: CachedPayload<T>): void {
  try {
    window.sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(entry));
  } catch {
    // A device that blocks storage still gets the in-memory cache.
  }
}

function readCache<T>(key: string, valid: Validator<T>): CachedPayload<T> | undefined {
  const cached = memory.get(key);
  if (cached !== undefined) return cached as CachedPayload<T>;
  const stored = readSession(key, valid);
  if (stored === undefined) return undefined;
  memory.set(key, stored);
  return stored;
}

function writeCache<T>(key: string, data: T): void {
  const entry: CachedPayload<T> = { data, storedAt: Date.now() };
  memory.set(key, entry);
  writeSession(key, entry);
}

/** Reject early with the API's abort error while letting the shared request finish and cache. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new ApiError('aborted', 'request cancelled'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApiError('aborted', 'request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function fetchShared<T>(key: string, path: string, signal?: AbortSignal): Promise<T> {
  const pending = inFlight.get(key);
  if (pending !== undefined) return abortable(pending as Promise<T>, signal);

  const shared = request<T>(path).then((data) => {
    writeCache(key, data);
    return data;
  });
  inFlight.set(key, shared);
  // Clear only if this exact request is still the registered one; a later
  // request for the same key must not be evicted by an older response.
  const forget = (): void => {
    if (inFlight.get(key) === shared) inFlight.delete(key);
  };
  void shared.then(forget, forget);
  return abortable(shared, signal);
}

/**
 * Stale-while-revalidate read: hand back a cached payload from the `FRESH_MS`
 * window without touching the network, otherwise share one background request.
 * Callers render the snapshot from `cachedSources()`/`cachedFaresStatus()` and
 * let this promise update the screen when the revalidation lands.
 */
function revalidate<T>(
  key: string,
  path: string,
  valid: Validator<T>,
  signal?: AbortSignal,
): Promise<T> {
  const cached = readCache(key, valid);
  if (cached !== undefined && Date.now() - cached.storedAt <= FRESH_MS) {
    return abortable(Promise.resolve(cached.data), signal);
  }
  return fetchShared(key, path, signal);
}

export interface NearPoint {
  lat: number;
  lon: number;
}

/** `GET /search?q=&near=` — MOTIS geocode typeahead, grouped. */
export function searchPlaces(
  query: string,
  options: { near?: NearPoint; signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (options.near !== undefined) {
    params.set('near', `${options.near.lat},${options.near.lon}`);
  }
  return request<SearchResponse>(`/search?${params.toString()}`, {}, options.signal);
}

/** `POST /plan` — the itinerary options for one trip. */
export function planTrip(request_: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
  return request<PlanResponse>('/plan', { method: 'POST', body: JSON.stringify(request_) }, signal);
}

const SOURCES_KEY = 'sources';
const SOURCES_PATH = '/sources';
const FARES_STATUS_KEY = 'fares/status';
const FARES_STATUS_PATH = '/fares/status';

/**
 * The provenance rows already known in this visit/tab, for a synchronous first
 * render. `undefined` on a cold visit, which is exactly when a skeleton (and a
 * real error path if the network fails) is the honest thing to show.
 */
export function cachedSources(): DataSource[] | undefined {
  return readCache(SOURCES_KEY, isDataSourceArray)?.data;
}

/**
 * `GET /sources` — revalidate after painting `cachedSources()`.
 *
 * Resolves with the shared in-flight request, or with the cached snapshot when
 * it is younger than the BFF's max-age, so the idle prefetch and a screen
 * mount can never fetch the same 5 KB twice.
 */
export function revalidateSources(signal?: AbortSignal): Promise<DataSource[]> {
  return revalidate(SOURCES_KEY, SOURCES_PATH, isDataSourceArray, signal);
}

/** `GET /sources`, always over the network (explicit refresh/retry). */
export function fetchSources(signal?: AbortSignal): Promise<DataSource[]> {
  return fetchShared(SOURCES_KEY, SOURCES_PATH, signal);
}

/** The fare-matrix status already known in this visit/tab, for a synchronous first render. */
export function cachedFaresStatus(): FareStatusDto | undefined {
  return readCache(FARES_STATUS_KEY, isFareStatusDto)?.data;
}

/**
 * `GET /fares/status` — revalidate after painting `cachedFaresStatus()`.
 * Shared with `revalidateSources`' dedupe/freshness rules.
 */
export function revalidateFaresStatus(signal?: AbortSignal): Promise<FareStatusDto> {
  return revalidate(FARES_STATUS_KEY, FARES_STATUS_PATH, isFareStatusDto, signal);
}

/** `GET /fares/status`, always over the network (explicit refresh/retry). */
export function fetchFaresStatus(signal?: AbortSignal): Promise<FareStatusDto> {
  return fetchShared(FARES_STATUS_KEY, FARES_STATUS_PATH, signal);
}
