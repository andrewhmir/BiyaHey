import type { FetchLike } from '../app.js';
import { RouterResponseError, RouterUnavailableError } from '../errors.js';

/** Default MOTIS base URL used when `MOTIS_URL` is not set. */
export const DEFAULT_MOTIS_URL = 'http://localhost:8080';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 1;
const MAX_DETAIL_LENGTH = 300;

/** Query accepted by {@link MotisClient.plan}. */
export interface MotisPlanQuery {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  /** ISO 8601 departure timestamp, passed through to MOTIS. */
  time: string;
  /** Optional cap; MOTIS maps 0 to "direct itineraries only". */
  maxTransfers?: number;
  /**
   * Intermediate stops to route through, in travel order (trip-planner R89).
   *
   * MOTIS's `via` parameter takes GTFS stop ids, never coordinates, and accepts
   * at most two; the body schema enforces that bound. Omitted or empty leaves
   * the request identical to a direct origin -> destination plan.
   */
  via?: readonly string[];
}

/**
 * Query accepted by {@link MotisClient.walkRoute}.
 *
 * This is the verified road-following walk mechanism (Lead finding F1): the
 * pinned MOTIS build serves walk geometry from `/api/v6/plan` only, with an
 * empty `transitModes` and `directModes=WALK`. `/api/v1/route` is a 404 there.
 */
export interface MotisWalkQuery {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  /** ISO 8601 departure timestamp, passed through to MOTIS. */
  time: string;
  /**
   * Upper bound on the direct walk in **seconds** (MOTIS `maxDirectTime`).
   *
   * MOTIS's `maxTravelTime` is the minutes-valued parameter and is never set
   * here; mixing the two units would size the search wrong by 60x.
   */
  maxDirectTime: number;
}

/** Thin, injectable client for the MOTIS endpoints the BFF needs. */
export interface MotisClient {
  plan(query: MotisPlanQuery): Promise<unknown>;
  /** Direct-only walking request; returns the raw `/api/v6/plan` payload. */
  walkRoute(query: MotisWalkQuery): Promise<unknown>;
  geocode(text: string): Promise<unknown>;
}

/** Constructor options for {@link createMotisClient}. */
export interface MotisClientOptions {
  /** Injected transport (Task 4 slot); Node's `fetch` by default. */
  fetch: FetchLike;
  /** Overrides `MOTIS_URL`; mainly for tests. */
  baseUrl?: string;
  /** Per-attempt timeout; defaults to 5 s. */
  timeoutMs?: number;
  /** Number of retries after the first attempt; defaults to 1. */
  retries?: number;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function isResponseLike(value: unknown): value is ResponseLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.ok === 'boolean' &&
    typeof record.status === 'number' &&
    typeof record.json === 'function' &&
    typeof record.text === 'function'
  );
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as Record<string, unknown>).code;
    if (typeof code === 'string') {
      return `${error.message} (${code})`;
    }
  }
  return error.message;
}

async function safeText(response: ResponseLike): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, MAX_DETAIL_LENGTH);
  } catch {
    return '';
  }
}

/**
 * Build a client bound to one injectable transport.
 *
 * Base URL resolution happens here so `MOTIS_URL` is read once per app build,
 * and so a test can inject a fixed fixture transport without touching env.
 */
export function createMotisClient(options: MotisClientOptions): MotisClient {
  const fetchImpl = options.fetch;
  const baseUrl = (options.baseUrl ?? process.env.MOTIS_URL ?? DEFAULT_MOTIS_URL).replace(
    /\/+$/,
    '',
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  async function decode(raw: unknown, url: string): Promise<unknown> {
    if (!isResponseLike(raw)) {
      if (raw === undefined || raw === null) {
        throw new RouterUnavailableError(`MOTIS returned an empty response from ${url}`);
      }
      // Injected fixture transports hand back an already-parsed JSON object.
      return raw;
    }
    if (!raw.ok) {
      const detail = await safeText(raw);
      const suffix = detail.length > 0 ? `: ${detail}` : '';
      const message = `MOTIS ${url} returned HTTP ${raw.status}${suffix}`;
      if (raw.status >= 400 && raw.status < 500) {
        // A 4xx means MOTIS parsed the query and rejected it: retrying cannot
        // help, so surface the upstream detail immediately.
        throw new RouterResponseError(raw.status, message);
      }
      throw new RouterUnavailableError(message);
    }
    try {
      return await raw.json();
    } catch {
      throw new RouterUnavailableError(`MOTIS ${url} did not return JSON`);
    }
  }

  async function request(url: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const raw = await fetchImpl(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        return await decode(raw, url);
      } catch (error) {
        if (error instanceof RouterResponseError) {
          throw error;
        }
        lastError = controller.signal.aborted
          ? new RouterUnavailableError(`MOTIS request timed out after ${timeoutMs} ms (${url})`)
          : error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError instanceof RouterUnavailableError) {
      throw lastError;
    }
    throw new RouterUnavailableError(
      `MOTIS router unavailable at ${url}: ${describeError(lastError)}`,
    );
  }

  async function requestJson(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    return request(`${baseUrl}${path}?${search.toString()}`);
  }

  return {
    plan(query) {
      // No `numItineraries`: the pinned MOTIS 2.11.4 build ignores it (probed
      // 2026-11-01 — default and numItineraries=1/5 all returned 10 itineraries)
      // and serves no OpenAPI document. The route widens the search with extra
      // calls instead.
      // `via` is a comma-separated stop-id list (MOTIS explode=false), so it is
      // joined here; an empty list must not add the parameter at all, keeping
      // a no-stop request byte-identical to the v1 contract.
      const via =
        query.via !== undefined && query.via.length > 0 ? query.via.join(',') : undefined;
      return requestJson('/api/v6/plan', {
        fromPlace: `${query.origin.lat},${query.origin.lon}`,
        toPlace: `${query.destination.lat},${query.destination.lon}`,
        time: query.time,
        maxTransfers: query.maxTransfers,
        via,
      });
    },
    walkRoute(query) {
      // F1 (probed 2026-11-04): `transitModes=` empty disables transit,
      // `directModes=WALK` asks for a walking path, and the answer arrives in
      // `direct[0]` with `legs[0].legGeometry` (precision 6) plus real
      // `duration` (seconds) and `distance` (metres). `transitModes` must be
      // sent as an empty parameter, which `requestJson` preserves.
      // `maxDirectTime` is SECONDS; `maxTravelTime` would be minutes.
      return requestJson('/api/v6/plan', {
        fromPlace: `${query.origin.lat},${query.origin.lon}`,
        toPlace: `${query.destination.lat},${query.destination.lon}`,
        time: query.time,
        transitModes: '',
        directModes: 'WALK',
        maxDirectTime: query.maxDirectTime,
      });
    },
    geocode(text) {
      return requestJson('/api/v1/geocode', { text });
    },
  };
}
