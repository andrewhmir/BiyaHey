import type { PlanRequest, PlanResponse, SearchResponse } from '@biyahey/shared';

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
  /** Override for tests; production always uses {@link REQUEST_TIMEOUT_MS}. */
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
 * Every request is bounded by a 5 s timeout and cancelled when the caller's
 * `signal` aborts; both paths share one internal `AbortController`. The fetch
 * is raced against the abort signal so an aborted typeahead request can never
 * resolve late and win over a newer query.
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

/** `POST /plan`; exposed for Task 5's route-options screen. */
export async function planTrip(
  input: PlanRequest,
  options: CallOptions = {},
): Promise<PlanResponse> {
  return request<PlanResponse>('/plan', {
    method: 'POST',
    body: input,
    signal: options.signal,
  });
}
