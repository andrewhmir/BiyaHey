import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FareStatusDto, PlanRequest, SearchResponse } from '@biyahey/shared';
import { server } from '../test/msw/server';
import {
  API_BASE_URL,
  ApiError,
  REQUEST_TIMEOUT_MS,
  fetchFareStatus,
  planTrip,
  request,
  searchPlaces,
} from './api';

const emptyResponse: SearchResponse = {
  partial: true,
  groups: { stops: [], landmarks: [], routes: [], saved: [] },
};

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch');
}

let fetchSpy: ReturnType<typeof spyOnFetch>;

/** A promise plus its resolver, so a handler can hang without a timer. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchSpy = spyOnFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('searchPlaces', () => {
  it('calls the API base URL with q and near and returns the parsed body', async () => {
    let url: URL | undefined;
    server.use(
      http.get('*/search', ({ request: httpRequest }) => {
        url = new URL(httpRequest.url);
        return HttpResponse.json(emptyResponse);
      }),
    );

    await expect(searchPlaces('  ayala  ', { lat: 14.5547, lon: 121.0244 })).resolves.toEqual(
      emptyResponse,
    );

    expect(API_BASE_URL).toBe('http://localhost:8787');
    expect(url?.origin).toBe(API_BASE_URL);
    expect(url?.pathname).toBe('/search');
    expect(url?.searchParams.get('q')).toBe('ayala');
    expect(url?.searchParams.get('near')).toBe('14.5547,121.0244');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('omits near when no origin point is supplied', async () => {
    let url: URL | undefined;
    server.use(
      http.get('*/search', ({ request: httpRequest }) => {
        url = new URL(httpRequest.url);
        return HttpResponse.json(emptyResponse);
      }),
    );

    await searchPlaces('ayala');

    expect(url?.searchParams.has('near')).toBe(false);
  });

  it('maps a network failure to ApiError code network', async () => {
    server.use(http.get('*/search', () => HttpResponse.error()));

    await expect(searchPlaces('ayala')).rejects.toMatchObject({ code: 'network' });
  });

  it('maps a non-JSON body to ApiError code invalid_response', async () => {
    server.use(http.get('*/search', () => HttpResponse.text('<html>not json</html>')));

    await expect(searchPlaces('ayala')).rejects.toBeInstanceOf(ApiError);
    await expect(searchPlaces('ayala')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('maps a BFF HTTP error to ApiError with status and server code', async () => {
    server.use(
      http.get('*/search', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } },
          { status: 500 },
        ),
      ),
    );

    const failure = searchPlaces('ayala');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: 'http',
      status: 500,
      serverCode: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
    });
  });
});

describe('planTrip', () => {
  it('posts the PlanRequest as JSON and returns the parsed plan', async () => {
    const input: PlanRequest = {
      origin: { lat: 14.676, lon: 121.0437 },
      destination: { lat: 14.5547, lon: 121.0244 },
    };
    let method: string | undefined;
    let body: unknown;
    const planResponse = { v: 1, itineraries: [], sources: [] };
    server.use(
      http.post('*/plan', async ({ request: httpRequest }) => {
        method = httpRequest.method;
        body = await httpRequest.json();
        return HttpResponse.json(planResponse);
      }),
    );

    await expect(planTrip(input)).resolves.toEqual(planResponse);

    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });
});

describe('request abort and timeout', () => {
  it('rejects with code aborted when the caller already aborted the signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(request('/search', { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects with code aborted when the caller aborts an in-flight request', async () => {
    const gate = deferred();
    server.use(
      http.get('*/search', async () => {
        await gate.promise;
        return HttpResponse.json(emptyResponse);
      }),
    );
    const controller = new AbortController();

    const pending = request('/search', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    gate.resolve();
  });

  it('times out after the 5 s default and rejects with code timeout', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    server.use(
      http.get('*/search', async () => {
        await gate.promise;
        return HttpResponse.json(emptyResponse);
      }),
    );

    expect(REQUEST_TIMEOUT_MS).toBe(5000);

    const pending = searchPlaces('ayala');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await rejection;

    gate.resolve();
  });
});

describe('fetchFareStatus', () => {
  const status: FareStatusDto = {
    effective_from: '2026-09-28',
    stale: false,
    stale_after_days: 183,
    checked_on: '2026-11-02',
  };

  it('reads the current matrix date from /fares/status', async () => {
    let path: string | undefined;
    server.use(
      http.get('*/fares/status', ({ request: httpRequest }) => {
        path = new URL(httpRequest.url).pathname;
        return HttpResponse.json(status);
      }),
    );

    await expect(fetchFareStatus()).resolves.toEqual(status);
    expect(path).toBe('/fares/status');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a drifted body instead of guessing freshness', async () => {
    server.use(http.get('*/fares/status', () => HttpResponse.json({ effective_from: 42 })));

    await expect(fetchFareStatus()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
