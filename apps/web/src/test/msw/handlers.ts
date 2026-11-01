import type { PlanResponse, SearchGroup, SearchResponse, SearchResultDto } from '@biyahey/shared';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import planCubaoAyalaRaw from '../fixtures/plan-cubao-ayala.json?raw';
import planLong15LegsRaw from '../fixtures/plan-long-15-legs.json?raw';
import planMrt3CubaoAyalaRaw from '../fixtures/plan-mrt3-cubao-ayala.json?raw';

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

// --- `POST /plan` fixtures and handlers (Task 5) ---------------------------

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A fixture drift must fail here, not later when a screen reads the field. */
function fixtureError(path: string, expected: string): never {
  throw new Error(`plan fixture is not a valid PlanResponse: ${path} must be ${expected}`);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fixtureError(path, 'an object');
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fixtureError(path, 'an array');
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fixtureError(path, 'a non-empty string');
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fixtureError(path, 'a finite number');
  }
  return value;
}

function assertPlace(value: unknown, path: string): void {
  const place = expectRecord(value, path);
  expectString(place.name, `${path}.name`);
  expectNumber(place.lat, `${path}.lat`);
  expectNumber(place.lon, `${path}.lon`);
}

function assertFare(value: unknown, path: string): void {
  const fare = expectRecord(value, path);
  const amount = expectNumber(fare.amount, `${path}.amount`);
  if (fare.currency !== 'PHP') fixtureError(`${path}.currency`, '"PHP"');
  if (fare.confidence !== 'official' && fare.confidence !== 'estimated') {
    fixtureError(`${path}.confidence`, '"official" or "estimated"');
  }
  if (typeof fare.effective_from !== 'string' || !ISO_DATE_PATTERN.test(fare.effective_from)) {
    fixtureError(`${path}.effective_from`, 'an ISO YYYY-MM-DD date');
  }
  if (fare.source_id !== null && typeof fare.source_id !== 'string') {
    fixtureError(`${path}.source_id`, 'a source id string or null');
  }
  let breakdownSum = 0;
  for (const [index, line] of expectArray(fare.breakdown, `${path}.breakdown`).entries()) {
    const entry = expectRecord(line, `${path}.breakdown[${index}]`);
    expectString(entry.label, `${path}.breakdown[${index}].label`);
    breakdownSum += expectNumber(entry.amount, `${path}.breakdown[${index}].amount`);
  }
  // The engine rounds each line to centavos, so the total must match too (R60).
  if (Math.abs(Math.round(breakdownSum * 100) / 100 - amount) > 0.001) {
    fixtureError(`${path}.breakdown`, 'a sum equal to fare.amount');
  }
}

function assertLeg(value: unknown, path: string): void {
  const leg = expectRecord(value, path);
  expectString(leg.mode, `${path}.mode`);
  assertPlace(leg.from, `${path}.from`);
  assertPlace(leg.to, `${path}.to`);
  expectString(leg.startTime, `${path}.startTime`);
  expectString(leg.endTime, `${path}.endTime`);
  expectNumber(leg.durationMin, `${path}.durationMin`);
  expectNumber(leg.distanceM, `${path}.distanceM`);
  for (const [index, id] of expectArray(leg.sourceIds, `${path}.sourceIds`).entries()) {
    expectString(id, `${path}.sourceIds[${index}]`);
  }
  // `stops` is additive and optional (R61); when a fixture carries it, it must
  // still be the served shape the timeline expands.
  if (leg.stops !== undefined) {
    for (const [index, stop] of expectArray(leg.stops, `${path}.stops`).entries()) {
      assertStop(stop, `${path}.stops[${index}]`);
    }
  }
}

function assertStop(value: unknown, path: string): void {
  const stop = expectRecord(value, path);
  expectString(stop.name, `${path}.name`);
  expectNumber(stop.lat, `${path}.lat`);
  expectNumber(stop.lon, `${path}.lon`);
  for (const field of ['stopId', 'arrivalTime', 'departureTime'] as const) {
    if (stop[field] !== undefined) {
      expectString(stop[field], `${path}.${field}`);
    }
  }
}

function assertItinerary(value: unknown, path: string): void {
  const itinerary = expectRecord(value, path);
  expectString(itinerary.id, `${path}.id`);
  expectNumber(itinerary.durationMin, `${path}.durationMin`);
  expectString(itinerary.startTime, `${path}.startTime`);
  expectString(itinerary.endTime, `${path}.endTime`);
  expectNumber(itinerary.transfers, `${path}.transfers`);
  expectNumber(itinerary.walkDistanceM, `${path}.walkDistanceM`);
  for (const [index, mode] of expectArray(itinerary.modes, `${path}.modes`).entries()) {
    expectString(mode, `${path}.modes[${index}]`);
  }
  assertFare(itinerary.fare, `${path}.fare`);
  for (const [index, id] of expectArray(itinerary.sources, `${path}.sources`).entries()) {
    expectString(id, `${path}.sources[${index}]`);
  }
  for (const [index, leg] of expectArray(itinerary.legs, `${path}.legs`).entries()) {
    assertLeg(leg, `${path}.legs[${index}]`);
  }
}

function assertSource(value: unknown, path: string): void {
  const source = expectRecord(value, path);
  for (const field of [
    'id',
    'name',
    'publisher',
    'url',
    'licence_spdx',
    'licence_url',
    'coverage',
    'last_checked',
    'attribution',
  ] as const) {
    expectString(source[field], `${path}.${field}`);
  }
  for (const [index, entry] of expectArray(source.used_for, `${path}.used_for`).entries()) {
    expectString(entry, `${path}.used_for[${index}]`);
  }
}

/**
 * Parse the checked-in JSON fixture through a small runtime shape guard.
 *
 * The plan response is contract-validated against the fields the UI reads, so a
 * renamed/mistyped fixture field throws at import time instead of passing until
 * some later test reads it. The JSON file stays the checked-in source of truth.
 */
export function parsePlanFixture(raw: string): PlanResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`plan fixture is not valid JSON: ${String(error)}`);
  }

  const response = expectRecord(parsed, 'response');
  if (response.v !== 1) fixtureError('response.v', '1');

  const sourceRows = expectArray(response.sources, 'response.sources').map((source, index) => {
    assertSource(source, `response.sources[${index}]`);
    return source as { id: string };
  });
  const knownSourceIds = new Set(sourceRows.map((source) => source.id));

  for (const [index, itinerary] of expectArray(
    response.itineraries,
    'response.itineraries',
  ).entries()) {
    assertItinerary(itinerary, `response.itineraries[${index}]`);
    for (const sourceId of (itinerary as { sources: string[] }).sources) {
      if (!knownSourceIds.has(sourceId)) {
        fixtureError(
          `response.itineraries[${index}].sources`,
          `only ids present in response.sources (missing "${sourceId}")`,
        );
      }
    }
  }

  return parsed as unknown as PlanResponse;
}

/**
 * The Cubao → Ayala plan fixture (three fare-forward options sorted by ETA).
 *
 * Stored as checked-in JSON and imported with Vite's `?raw` suffix so the test
 * shares the exact contract shape the BFF promises (`PlanResponse`, including
 * `fare.effective_from` and per-itinerary `sources[]`) without enabling
 * `resolveJsonModule` in the app's TypeScript project.
 */
export const planCubaoAyalaResponse: PlanResponse = parsePlanFixture(planCubaoAyalaRaw);

/**
 * MRT-3 Cubao → Ayala fixture for the trip-detail tests (Task 6): one rail leg
 * with a four-stop served list, `Look for: MRT-3 / Ayala`, the Farmers Plaza
 * landmark, and the 2026-03-23 rail fare from `rail-fares`.
 */
export const planMrt3CubaoAyalaResponse: PlanResponse = parsePlanFixture(planMrt3CubaoAyalaRaw);

/** Fifteen legs with 60-character stop names: the timeline clipping stress case. */
export const planLong15LegsResponse: PlanResponse = parsePlanFixture(planLong15LegsRaw);

/** Default `POST /plan` handler: the three-option Cubao → Ayala plan. */
export const planSuccessHandler = http.post('*/plan', () =>
  HttpResponse.json(planCubaoAyalaResponse),
);

/** 200 with zero itineraries: the honest "Walang ruta" state (R41). */
export const planEmptyHandler = http.post('*/plan', () =>
  HttpResponse.json({
    v: 1,
    itineraries: [],
    sources: planCubaoAyalaResponse.sources,
  } satisfies PlanResponse),
);

/** A 500 in the BFF's documented error envelope. */
export const planErrorHandler = http.post('*/plan', () =>
  HttpResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } },
    { status: 500 },
  ),
);

/** The transport failed before a response arrived (offline simulation). */
export const planNetworkErrorHandler = http.post('*/plan', () => HttpResponse.error());

/** A response that never arrives, for the delayed-skeleton assertion. */
export const planPendingHandler = http.post('*/plan', async () => {
  await delay('infinite');
  return HttpResponse.json(planCubaoAyalaResponse);
});

export const handlers: HttpHandler[] = [searchSuccessHandler, planSuccessHandler];
