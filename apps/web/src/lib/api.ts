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

/** `GET /sources` — the provenance registry rows, in registry order. */
export function fetchSources(signal?: AbortSignal): Promise<DataSource[]> {
  return request<DataSource[]>('/sources', {}, signal);
}

/** `GET /fares/status` — fare-matrix effectivity and staleness. */
export function fetchFaresStatus(signal?: AbortSignal): Promise<FareStatusDto> {
  return request<FareStatusDto>('/fares/status', {}, signal);
}
