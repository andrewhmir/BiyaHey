import type { SearchGroup, SearchResponse, SearchResultDto } from '@biyahey/shared';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';

// MSW fixtures for `GET /search` (R40/R50). Bodies mirror the BFF's real
// contract: grouped DTOs from `@biyahey/shared`, `distanceM` in whole metres,
// PSGC locality in `locality`, and `partial` for an incomplete answer.

function emptyGroups(): SearchGroup {
  return { stops: [], landmarks: [], routes: [], saved: [] };
}

export const ayalaTerminal: SearchResultDto = {
  id: 'gtfs_bus-lx:node:6014597491',
  name: 'Ayala Terminal',
  label: 'Ayala Terminal, Makati',
  type: 'stop',
  lat: 14.549272,
  lon: 121.029103,
  locality: 'Makati',
  distanceM: 120,
  source_id: 'osm',
  modes: ['BUS'],
};

export const oneAyala: SearchResultDto = {
  id: 'gtfs_bus-38:node:13260869029',
  name: 'One Ayala',
  label: 'One Ayala, Makati',
  type: 'stop',
  lat: 14.550547,
  lon: 121.028026,
  locality: 'Makati',
  distanceM: 605,
  source_id: 'osm',
  modes: ['BUS'],
};

export const ayalaTriangleGardens: SearchResultDto = {
  id: 'osm:landmark:ayala-triangle',
  name: 'Ayala Triangle Gardens',
  label: 'Ayala Triangle Gardens, Makati',
  type: 'landmark',
  lat: 14.5547,
  lon: 121.0244,
  locality: 'Makati',
  distanceM: 1200,
  source_id: 'osm',
};

export const ayalaMuseum: SearchResultDto = {
  id: 'osm:landmark:ayala-museum',
  name: 'Ayala Museum',
  label: 'Ayala Museum, Makati',
  type: 'landmark',
  lat: 14.5535,
  lon: 121.0271,
  locality: 'Makati',
  distanceM: 905,
  source_id: 'osm',
};

export const cubaoStop: SearchResultDto = {
  id: 'gtfs_rail-3:node:5397307754',
  name: 'Cubao',
  label: 'Cubao, Quezon City',
  type: 'stop',
  lat: 14.6194,
  lon: 121.0531,
  locality: 'Quezon City',
  distanceM: 11837,
  source_id: 'osm',
  modes: ['SUBWAY'],
};

/** Success body: two stops and two landmarks, each carrying a distance. */
export const ayalaSearchResponse: SearchResponse = {
  partial: false,
  groups: {
    stops: [ayalaTerminal, oneAyala],
    landmarks: [ayalaTriangleGardens, ayalaMuseum],
    routes: [],
    saved: [],
  },
};

export const cubaoSearchResponse: SearchResponse = {
  partial: false,
  groups: { stops: [cubaoStop], landmarks: [], routes: [], saved: [] },
};

/**
 * A genuine empty result: the query was understood and matched nothing. The
 * screen may claim absence, so `partial` stays false.
 */
export const emptySearchResponse: SearchResponse = {
  partial: false,
  groups: emptyGroups(),
};

/**
 * The geocoder could not answer completely and mapped no rows. The shared DTO
 * contract requires the PWA to keep the caveat rather than claim absence.
 */
export const partialEmptySearchResponse: SearchResponse = {
  partial: true,
  groups: emptyGroups(),
};

/** Some results, but the API could not return a complete answer. */
export const partialSearchResponse: SearchResponse = {
  partial: true,
  groups: { stops: [ayalaTerminal], landmarks: [], routes: [], saved: [] },
};

/** Default handler: a realistic body per known query, otherwise empty. */
export const searchSuccessHandler = http.get('*/search', ({ request }) => {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
  if (query === 'ayala') {
    return HttpResponse.json(ayalaSearchResponse);
  }
  if (query === 'cubao') {
    return HttpResponse.json(cubaoSearchResponse);
  }
  return HttpResponse.json(emptySearchResponse);
});

/** 200 with no results and `partial: false` (asserts definite no-results). */
export const emptySearchHandler = http.get('*/search', () =>
  HttpResponse.json(emptySearchResponse),
);

/** 200 with no results but `partial: true` (asserts the caveat survives zero rows). */
export const partialEmptySearchHandler = http.get('*/search', () =>
  HttpResponse.json(partialEmptySearchResponse),
);

/** 200 with results but `partial: true` (used to assert the honesty note). */
export const partialSearchHandler = http.get('*/search', () =>
  HttpResponse.json(partialSearchResponse),
);

/** A 500 in the BFF's documented error envelope. */
export const searchErrorHandler = http.get('*/search', () =>
  HttpResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } },
    { status: 500 },
  ),
);

/** The transport failed before a response arrived (offline simulation). */
export const searchNetworkErrorHandler = http.get('*/search', () => HttpResponse.error());

/** A slow response, for loading-state assertions. */
export const searchSlowHandler = http.get('*/search', async () => {
  await delay(600);
  return HttpResponse.json(ayalaSearchResponse);
});

export const handlers: HttpHandler[] = [searchSuccessHandler];
