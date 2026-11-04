import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { PlanResponse, SearchResponse } from '@biyahey/shared';
import { implausibleTransitLegs, isPlausibleItinerary } from '../src/routing/map-itinerary.js';

/**
 * Golden NCR acceptance suite (spec §3 criteria 2 and 3; Task 11).
 *
 * This is an integration test: it talks to a *running* stack over HTTP. It is
 * tagged `integration`, so `npm test` / `npm run ci` filter it out (Vitest
 * `--tagsFilter=!integration`; see `vitest.config.ts`) and no ambient `API_URL`
 * can make CI depend on a live stack. It is also skipped unless `API_URL` is
 * set. `npm run verify:phase1` starts the API on a free port, sets `API_URL`,
 * and runs this file. Manual run:
 *
 *   $env:API_URL = 'http://localhost:8787'
 *   npm run test:integration            # every integration-tagged suite
 *   npx vitest run services/api/test/golden.test.ts   # this file only
 *
 * What it asserts, per trip in `golden/routes.json`:
 *   - at least `minItineraries` itineraries (the live count the corridor really
 *     produces, not the brief's illustrative 3);
 *   - every mode in `requiredModes` appears across the returned itineraries;
 *   - every itinerary passes the BFF plausibility guard (no transit leg whose
 *     implied speed exceeds `MAX_TRANSIT_SPEED_KMH`; the R10 bad-shape defect);
 *   - every itinerary has a total fare inside `fareBounds`, a non-empty
 *     `sources[]`, and a dated `fare.effective_from` (spec §3 criterion 5);
 *   - total time, transfers and walk distance are present (criterion 3).
 *
 * It also records the `x-biyahey-motis-calls` and
 * `x-biyahey-implausible-dropped` response headers per trip, so the acceptance
 * report proves the guard and the R37 fan-out actually ran.
 *
 * It also measures p95 plan latency over the ten trips (criterion 3) and p95
 * search latency over six real NCR queries (criterion 2), both against the
 * 1.5 s limit. When `GOLDEN_REPORT` names a path, the same measurements are
 * written there as JSON so `verify:phase1` can print them.
 */

interface GoldenTrip {
  name: string;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  minItineraries: number;
  requiredModes: string[];
  fareBounds: { min: number; max: number };
  note?: string;
}

interface GoldenSuite {
  departAt: string;
  trips: GoldenTrip[];
}

interface TripResult {
  name: string;
  itineraries: number;
  modes: string[];
  fares: number[];
  transfers: number[];
  walkDistanceM: number[];
  planMs: number;
  motisCalls: number | null;
  implausibleDropped: number | null;
}

const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
const suite = JSON.parse(
  readFileSync(new URL('./golden/routes.json', import.meta.url), 'utf8'),
) as GoldenSuite;

const SEARCH_QUERIES = [
  'Cubao',
  'Ayala',
  'Novaliches',
  'Fairview',
  'Alabang',
  'Divisoria',
];

/** Nearest-rank p95 of a millisecond sample, rounded. */
function p95(samples: number[]): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return Math.round(sorted[index]);
}

interface GoldenReport {
  apiUrl: string;
  departAt: string;
  trips: TripResult[];
  planP95Ms: number;
  searchP95Ms: number;
  searchSamples: Array<{ query: string; ms: number; stops: number; landmarks: number }>;
}

/** ISO-8601 UTC of the next 08:00 Asia/Manila, inside MOTIS's loaded window. */
function nextMorningDeparture(): string {
  const offsetMs = 8 * 3_600_000;
  const nowPht = Date.now() + offsetMs;
  const dayStartPht = Math.floor(nowPht / 86_400_000) * 86_400_000;
  let targetPht = dayStartPht + 8 * 3_600_000;
  if (targetPht <= nowPht) {
    targetPht += 86_400_000;
  }
  return new Date(targetPht - offsetMs).toISOString();
}

// Keep the recorded fixture date while it is still in the future (it documents
// the acceptance run); once it would fall outside MOTIS's loaded timetable
// window, depart at the next 08:00 Asia/Manila instead of failing for a reason
// unrelated to the feed.
const departure = Date.parse(suite.departAt) > Date.now() ? suite.departAt : nextMorningDeparture();

const report: GoldenReport = {
  apiUrl: apiUrl ?? '',
  departAt: departure,
  trips: [],
  planP95Ms: 0,
  searchP95Ms: 0,
  searchSamples: [],
};

it('defines exactly ten golden trips', () => {
  expect(suite.trips).toHaveLength(10);
  expect(new Set(suite.trips.map((trip) => trip.name)).size).toBe(10);
  for (const trip of suite.trips) {
    // The acceptance contract is at least three options per corridor; a trip
    // whose live data cannot meet that must be replaced, never lowered.
    expect(trip.minItineraries, `${trip.name}: minItineraries`).toBeGreaterThanOrEqual(3);
    expect(trip.requiredModes.length, `${trip.name}: requiredModes`).toBeGreaterThan(0);
    expect(trip.fareBounds.max, `${trip.name}: fareBounds`).toBeGreaterThanOrEqual(trip.fareBounds.min);
  }
});

describe.skipIf(apiUrl === undefined)('golden NCR acceptance (live API)', { tags: ['integration'] }, () => {
  it(
    'plans every golden trip within its contract',
    async () => {
      const planLatencies: number[] = [];

      for (const trip of suite.trips) {
        const started = performance.now();
        const response = await fetch(`${apiUrl}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            origin: trip.origin,
            destination: trip.destination,
            departAt: departure,
          }),
        });
        const planMs = Math.round(performance.now() - started);
        planLatencies.push(planMs);

        expect(response.status, `${trip.name}: POST /plan status`).toBe(200);
        const body = (await response.json()) as PlanResponse;
        const motisCallsHeader = response.headers.get('x-biyahey-motis-calls') ?? '';
        const implausibleDroppedHeader =
          response.headers.get('x-biyahey-implausible-dropped') ?? '';
        // `Number(null)` is 0, so a missing header would otherwise read as a
        // perfectly valid zero-drop count. Assert the header text itself first.
        expect(motisCallsHeader, `${trip.name}: x-biyahey-motis-calls header`).toMatch(/^\d+$/);
        expect(
          implausibleDroppedHeader,
          `${trip.name}: x-biyahey-implausible-dropped header`,
        ).toMatch(/^\d+$/);
        const motisCalls = Number(motisCallsHeader);
        const implausibleDropped = Number(implausibleDroppedHeader);
        expect(motisCalls, `${trip.name}: fan-out made at least one call`).toBeGreaterThanOrEqual(1);
        expect(
          implausibleDropped,
          `${trip.name}: implausible-drop count is non-negative`,
        ).toBeGreaterThanOrEqual(0);

        expect(
          body.itineraries.length,
          `${trip.name}: itineraries >= ${trip.minItineraries}`,
        ).toBeGreaterThanOrEqual(trip.minItineraries);
        // Spec §9 / final-review item 5: the BFF serves the best 3–5 options,
        // never MOTIS's full 10–12, so the upper bound is part of the contract.
        expect(body.itineraries.length, `${trip.name}: itineraries <= 5`).toBeLessThanOrEqual(5);

        const modes = [...new Set(body.itineraries.flatMap((itinerary) => itinerary.modes))].sort();
        for (const required of trip.requiredModes) {
          expect(
            modes.includes(required),
            `${trip.name}: required mode "${required}" absent (saw ${modes.join(', ')})`,
          ).toBe(true);
        }

        for (const itinerary of body.itineraries) {
          const context = `${trip.name} itinerary ${itinerary.id}`;
          // The guard runs in the BFF; this assertion proves no impossible
          // geometry was served (and would catch a regression if it stopped).
          expect(implausibleTransitLegs(itinerary), `${context}: implausible transit legs`).toEqual([]);
          expect(isPlausibleItinerary(itinerary), `${context}: plausible`).toBe(true);
          expect(itinerary.fare.amount, `${context}: fare >= ${trip.fareBounds.min}`).toBeGreaterThanOrEqual(
            trip.fareBounds.min,
          );
          expect(itinerary.fare.amount, `${context}: fare <= ${trip.fareBounds.max}`).toBeLessThanOrEqual(
            trip.fareBounds.max,
          );
          expect(itinerary.sources.length, `${context}: sources[]`).toBeGreaterThan(0);
          expect(itinerary.fare.effective_from, `${context}: fare.effective_from`).toMatch(
            /^\d{4}-\d{2}-\d{2}$/,
          );
          expect(itinerary.durationMin, `${context}: total time`).toBeGreaterThan(0);
          expect(Number.isInteger(itinerary.transfers), `${context}: transfers`).toBe(true);
          expect(itinerary.walkDistanceM, `${context}: walk distance`).toBeGreaterThanOrEqual(0);
          expect(itinerary.legs.length, `${context}: legs`).toBeGreaterThan(0);
        }

        report.trips.push({
          name: trip.name,
          itineraries: body.itineraries.length,
          modes,
          fares: [...new Set(body.itineraries.map((itinerary) => itinerary.fare.amount))].sort(
            (a, b) => a - b,
          ),
          transfers: [...new Set(body.itineraries.map((itinerary) => itinerary.transfers))].sort(
            (a, b) => a - b,
          ),
          walkDistanceM: [...new Set(body.itineraries.map((itinerary) => itinerary.walkDistanceM))].sort(
            (a, b) => a - b,
          ),
          planMs,
          motisCalls,
          implausibleDropped,
        });
      }

      report.planP95Ms = p95(planLatencies);
      console.log(
        `golden: ${report.trips.length} trips, p95 plan ${report.planP95Ms} ms\n` +
          report.trips
            .map(
              (trip) =>
                `  ${trip.name}: ${trip.itineraries} itineraries, modes ${trip.modes.join('+')}, ` +
                `fares ${trip.fares.join('/')}, ${trip.motisCalls} MOTIS calls, ` +
                `${trip.implausibleDropped} implausible dropped, ${trip.planMs} ms`,
            )
            .join('\n'),
      );
      expect(report.planP95Ms, 'spec §3.3: p95 plan <= 1500 ms').toBeLessThanOrEqual(1500);
    },
    180_000,
  );

  it(
    'search p95 is within budget and grouped for six NCR queries',
    async () => {
      const samples: number[] = [];

      for (const query of SEARCH_QUERIES) {
        const started = performance.now();
        const response = await fetch(`${apiUrl}/search?q=${encodeURIComponent(query)}`);
        const ms = Math.round(performance.now() - started);
        samples.push(ms);

        expect(response.status, `${query}: GET /search status`).toBe(200);
        const body = (await response.json()) as SearchResponse;
        expect(body.partial, `${query}: search marked complete`).toBe(false);
        expect(
          body.groups.stops.length + body.groups.landmarks.length,
          `${query}: search returned results`,
        ).toBeGreaterThan(0);
        // The DTO always carries the four groups the PWA renders.
        expect(Object.keys(body.groups).sort()).toEqual(['landmarks', 'routes', 'saved', 'stops']);
        report.searchSamples.push({
          query,
          ms,
          stops: body.groups.stops.length,
          landmarks: body.groups.landmarks.length,
        });
      }

      report.searchP95Ms = p95(samples);
      console.log(
        `search: ${report.searchSamples.length} queries, p95 ${report.searchP95Ms} ms\n` +
          report.searchSamples
            .map((sample) => `  ${sample.query}: ${sample.ms} ms, ${sample.stops} stops + ${sample.landmarks} landmarks`)
            .join('\n'),
      );
      expect(report.searchP95Ms, 'spec §3.2: p95 search <= 1500 ms').toBeLessThanOrEqual(1500);

      // Spec §10: when the caller supplies a point, every result carries a
      // distance. Probe from the live Cubao stop coordinate.
      const nearResponse = await fetch(
        `${apiUrl}/search?q=Cubao&near=14.6195,121.051`,
      );
      expect(nearResponse.status, 'near: GET /search status').toBe(200);
      const nearBody = (await nearResponse.json()) as SearchResponse;
      const nearRows = [...nearBody.groups.stops, ...nearBody.groups.landmarks];
      expect(nearRows.length, 'near: search returned rows').toBeGreaterThan(0);
      for (const row of nearRows) {
        expect(typeof row.distanceM, `near: ${row.name} distanceM`).toBe('number');
        expect(row.distanceM, `near: ${row.name} distanceM >= 0`).toBeGreaterThanOrEqual(0);
      }
    },
    120_000,
  );
});

afterAll(() => {
  const target = process.env.GOLDEN_REPORT;
  if (apiUrl === undefined || target === undefined || target.length === 0) {
    return;
  }
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`golden report: ${target}`);
});
