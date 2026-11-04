import type {
  DataSource,
  FareStatusDto,
  PlanRequest,
  PlanResponse,
  SearchResponse,
} from '@biyahey/shared';

/**
 * Base URL of the Plan 1 BFF (R40).
 *
 * Vite inlines `VITE_API_URL` at build time; the localhost fallback keeps the
 * checked-in dev setup working without an `.env` file. Tests never rely on the
 * container: MSW intercepts every request (R40).
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

/** A search request must fail fast on a mobile network. */
export const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Plan §Task 8's 3 s bound for `POST /plan`, enforced client-side.
 *
 * The service worker cannot enforce it: Workbox's NetworkFirst timeout path
 * calls `cacheMatch(request)`, and the Cache API rejects a non-GET request, so
 * a registered `/plan` route would turn a slow plan into a network error
 * instead of falling back. Enforcing the budget here gives the caller an honest
 * typed `timeout` failure it can render a retry state for (R72).
 */
export const PLAN_TIMEOUT_MS = 3_000;

/**
 * Machine-readable failure categories.
 *
 * `network` means the request never reached the API, `timeout` means it never
 * answered within {@link REQUEST_TIMEOUT_MS}, `http` is a non-2xx response
 * (with the BFF's `error.code` preserved as {@link ApiError.serverCode}), and
 * `invalid_response` means the body was not the JSON the contract promised.
 */
export type ApiErrorCode = 'network' | 'timeout' | 'aborted' | 'http' | 'invalid_response';

export interface ApiErrorOptions {
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

/** The only error type callers of this module have to handle. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  readonly serverCode: string | undefined;

  constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status;
    this.serverCode = options.serverCode;
  }
}

export interface NearPoint {
  lat: number;
  lon: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** JSON-serialised request body; omitted for GET. */
  body?: unknown;
  /** Caller cancellation (a new keystroke, an unmount). */
  signal?: AbortSignal;
  /**
   * Per-request budget. Defaults to {@link REQUEST_TIMEOUT_MS}; `planTrip` passes
   * the 3 s {@link PLAN_TIMEOUT_MS} instead, and tests may shorten it.
   */
  timeoutMs?: number;
}

export interface CallOptions {
  signal?: AbortSignal;
}

interface ApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function parseErrorBody(payload: unknown): { code?: string; message?: string } {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const error = (payload as ApiErrorBody).error;
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  return {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
  };
}

function mapFailure(
  error: unknown,
  context: { signal?: AbortSignal; timedOut: boolean; timeoutMs: number },
): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (context.signal?.aborted === true) {
    return new ApiError('aborted', 'Kinansela ang request.', { cause: error });
  }
  if (context.timedOut) {
    return new ApiError(
      'timeout',
      `Hindi sumagot ang API sa loob ng ${context.timeoutMs / 1000} segundo.`,
      { cause: error },
    );
  }
  return new ApiError('network', 'Hindi maabot ang API. Suriin ang koneksyon.', { cause: error });
}

/**
 * Typed JSON fetch wrapper for the BFF.
 *
 * Every request is bounded by a timeout (`timeoutMs`, default 5 s — plan
 * requests pass the 3 s {@link PLAN_TIMEOUT_MS}) and cancelled when the
 * caller's `signal` aborts; both paths share one internal `AbortController`.
 * The fetch is raced against the abort signal so an aborted typeahead request
 * can never resolve late and win over a newer query.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  if (signal?.aborted === true) {
    throw new ApiError('aborted', 'Kinansela ang request.', { cause: signal.reason });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        if (signal?.aborted === true) {
          reject(new ApiError('aborted', 'Kinansela ang request.'));
          return;
        }
        if (timedOut) {
          reject(
            new ApiError('timeout', `Hindi sumagot ang API sa loob ng ${timeoutMs / 1000} segundo.`),
          );
          return;
        }
        reject(new ApiError('aborted', 'Kinansela ang request.'));
      },
      { once: true },
    );
  });

  try {
    let response: Response;
    try {
      response = await Promise.race([
        fetch(`${API_BASE_URL}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        }),
        aborted,
      ]);
    } catch (error) {
      throw mapFailure(error, { signal, timedOut, timeoutMs });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw mapFailure(error, { signal, timedOut, timeoutMs });
    }

    let payload: unknown;
    let parsed = text.length === 0;
    if (!parsed) {
      try {
        payload = JSON.parse(text) as unknown;
        parsed = true;
      } catch {
        parsed = false;
      }
    }

    if (!response.ok) {
      const errorBody = parseErrorBody(payload);
      throw new ApiError(
        'http',
        errorBody.message ?? `Request failed with status ${response.status}`,
        { status: response.status, serverCode: errorBody.code },
      );
    }

    if (!parsed) {
      throw new ApiError('invalid_response', 'Hindi mabasa ang sagot ng API.');
    }

    return payload as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * `GET /search?q=&near=lat,lon` (spec §10).
 *
 * `near` is optional: the API only attaches `distanceM` when the caller says
 * where it is, so the PWA never displays a distance measured from an arbitrary
 * point. The returned groups are rendered as-is (R43/R45).
 */
export async function searchPlaces(
  q: string,
  near?: NearPoint,
  options: CallOptions = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: q.trim() });
  if (near !== undefined) {
    params.set('near', `${near.lat},${near.lon}`);
  }
  return request<SearchResponse>(`/search?${params.toString()}`, { signal: options.signal });
}

/**
 * `POST /plan`; exposed for Task 5's route-options screen.
 *
 * Uses the plan-specific 3 s budget rather than the generic 5 s: the service
 * worker no longer registers a `/plan` route (it cannot cache a POST), so this
 * per-request timeout is the only place the mandated bound can be enforced.
 */
export async function planTrip(
  input: PlanRequest,
  options: CallOptions = {},
): Promise<PlanResponse> {
  return request<PlanResponse>('/plan', {
    method: 'POST',
    body: input,
    signal: options.signal,
    timeoutMs: PLAN_TIMEOUT_MS,
  });
}

/**
 * Browser-safe runtime guard for one `GET /sources` registry row.
 *
 * About-data renders every field of every row, so a row that is missing one
 * (or carries a non-string id) must reach the screen's error/retry state rather
 * than a card that crashes on `undefined`. This mirrors `isFareStatusDto`:
 * plain TypeScript, no Node-only imports, safe in the PWA bundle.
 *
 * A `kind: 'derived'` row (`walk-estimate`) is computed by BiyaHey! rather than
 * sourced from a dataset, so it legitimately publishes no dataset source URL or
 * licence URL; those rows may omit `url` and `licence_url` (the registry uses
 * `"—"` as the no-URL sentinel). `licence_spdx` is still required: SPDX's
 * `NOASSERTION` is how such a row states that it claims no licence.
 */
export function isDataSourceRow(value: unknown): value is DataSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Partial<DataSource> & { kind?: unknown };
  const identityStrings = [
    'id',
    'name',
    'publisher',
    'licence_spdx',
    'coverage',
    'last_checked',
    'attribution',
  ] as const;
  for (const field of identityStrings) {
    if (typeof row[field] !== 'string' || row[field].length === 0) {
      return false;
    }
  }
  if (row.kind !== 'derived') {
    const datasetStrings = ['url', 'licence_url'] as const;
    for (const field of datasetStrings) {
      if (typeof row[field] !== 'string' || row[field].length === 0) {
        return false;
      }
    }
  }
  return (
    Array.isArray(row.used_for) && row.used_for.every((entry) => typeof entry === 'string')
  );
}

/**
 * `GET /sources` — the provenance registry, in the BFF's canonical order
 * (spec §10, Task 7).
 *
 * The rows are rendered as returned: the web app never has its own attribution
 * or licence table (R45). A response that is not an array, or that carries a
 * malformed row, is rejected here so About-data fails with its honest retry
 * state instead of crashing a card (Task 9 M3).
 */
export async function fetchSources(options: CallOptions = {}): Promise<DataSource[]> {
  const payload = await request<unknown>('/sources', { signal: options.signal });
  if (!Array.isArray(payload) || !payload.every(isDataSourceRow)) {
    throw new ApiError('invalid_response', 'Hindi mabasa ang listahan ng data sources.');
  }
  return payload;
}

/**
 * Runtime guard for `GET /fares/status` (Task 8).
 *
 * The saved screen only needs `effective_from` (to compare against a saved
 * quote's own `effective_from`); it never recomputes a fare (R45). The other
 * fields are validated too so a drifted response surfaces as an honest
 * "matrix unknown" state instead of `undefined` leaking into a comparison.
 */
function isFareStatusDto(value: unknown): value is FareStatusDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const status = value as Partial<FareStatusDto>;
  return (
    typeof status.effective_from === 'string' &&
    status.effective_from.length > 0 &&
    typeof status.stale === 'boolean' &&
    typeof status.stale_after_days === 'number' &&
    Number.isFinite(status.stale_after_days) &&
    typeof status.checked_on === 'string'
  );
}

/**
 * `GET /fares/status` — the current fare matrix's effectivity date.
 *
 * Used by the saved-trips staleness check: a saved quote whose
 * `effective_from` differs from this date was priced against an older matrix.
 * No fare is calculated here, and an unreadable response is an error rather
 * than a fresh claim.
 */
export async function fetchFareStatus(options: CallOptions = {}): Promise<FareStatusDto> {
  const payload = await request<unknown>('/fares/status', { signal: options.signal });
  if (!isFareStatusDto(payload)) {
    throw new ApiError('invalid_response', 'Hindi mabasa ang fare matrix status.');
  }
  return payload;
}
