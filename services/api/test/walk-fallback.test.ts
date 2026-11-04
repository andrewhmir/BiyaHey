import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePolyline } from '@biyahey/shared';
import type { PlanResponse } from '@biyahey/shared';
import { buildApp } from '../src/app.js';
import { haversineM } from '../src/domain/geo.js';
import { polylineLengthM } from '../src/routing/map-itinerary.js';
import {
  buildWalkFallback,
  mapRoutedWalk,
  walkRouteMaxDirectTime,
} from '../src/routing/walk-fallback.js';
import { FALLBACK_HEADER, MOTIS_CALLS_HEADER } from '../src/routes/plan.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface RawLegGeometry {
  points: string;
  precision: number;
}

interface WalkOnlyFixture {
  direct: Array<{ duration: number; legs: Array<{ legGeometry: RawLegGeometry }> }>;
}

/**
 * The pinned-feed walk-only payload carries a real 26-vertex `legGeometry`
 * (precision 6) and a 152 s duration. Reusing it here keeps the routed-walk
 * fixture honest instead of inventing an encoding.
 */
const walkOnlyFixture = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'motis-plan-walk-only.json'), 'utf8'),
) as WalkOnlyFixture;
const WALK_DIRECT = walkOnlyFixture.direct[0];
const WALK_GEOMETRY = WALK_DIRECT.legs[0].legGeometry;

const DEPART_AT = '2026-11-02T08:00:00+08:00';
const CUBAO = { lat: 14.619, lon: 121.053 };
const AYALA = { lat: 14.554, lon: 121.024 };
/** ~300 m from Cubao: the short-pair case. */
const NEAR = { lat: 14.6217, lon: 121.053 };
/** ~30 km from Cubao: beyond the walk-route ceiling. */
const FAR = { lat: 14.85, lon: 121.2 };
/** ~6 km from Cubao: the `maxDirectTime` safety-factor case. */
const SIX_KM = { lat: 14.673, lon: 121.053 };
/** ~19 km from Cubao: the ceiling-clamp case. */
const NINETEEN_KM = { lat: 14.79, lon: 121.053 };

const EMPTY_PLAN = { itineraries: [], direct: [] };

type Place = { lat: number; lon: number };

function distanceBetween(origin: Place, destination: Place): number {
  return haversineM([origin.lat, origin.lon], [destination.lat, destination.lon]);
}

/** Straight-line estimate: haversine divided by the documented 4.5 km/h walk. */
function expectedWalkMinutes(distanceM: number): number {
  return Math.ceil(distanceM / (4.5 * 1000 / 3600) / 60);
}

/** F1 sizing: 1.2 m/s x 1.6, floor 3600 s, ceiling 21600 s (seconds, not minutes). */
function expectedMaxDirectTime(distanceM: number): number {
  return Math.min(21_600, Math.max(3_600, Math.ceil((distanceM / 1.2) * 1.6)));
}

function isWalkUrl(url: string): boolean {
  return new URL(url).searchParams.get('directModes') === 'WALK';
}

/**
 * Build an app whose injected transport records every URL and answers through
 * `handler`. A thrown handler error is the transport-failure case.
 */
function stubApp(handler: (url: string) => unknown): {
  app: ReturnType<typeof buildApp>;
  urls: string[];
} {
  const urls: string[] = [];
  const app = buildApp({
    motisFetch: async (url) => {
      urls.push(url);
      return handler(url);
    },
  });
  return { app, urls };
}

async function postPlan(
  app: ReturnType<typeof buildApp>,
  origin: Place,
  destination: Place,
): Promise<{
  statusCode: number;
  body: PlanResponse & { error?: { code: string; message: string } };
  headers: Record<string, unknown>;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/plan',
    payload: { origin, destination, departAt: DEPART_AT },
  });
  return {
    statusCode: res.statusCode,
    body: res.json() as PlanResponse & { error?: { code: string; message: string } },
    headers: res.headers,
  };
}

describe('walk fallback synthesis', () => {
  it('returns exactly one labelled straight-line walk when MOTIS finds nothing', async () => {
    const { app, urls } = stubApp(() => EMPTY_PLAN);
    const { statusCode, body, headers } = await postPlan(app, CUBAO, AYALA);
    const haversine = distanceBetween(CUBAO, AYALA);

    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    const itinerary = body.itineraries[0];
    expect(itinerary.fallback).toBe('walk');
    expect(itinerary.transfers).toBe(0);
    expect(itinerary.modes).toEqual(['walk']);
    expect(itinerary.fare.amount).toBe(0);
    expect(itinerary.fare.source_id).toBeNull();
    expect(itinerary.sources).toContain('walk-estimate');
    // The straight line did not consult OSM's walking graph.
    expect(itinerary.sources).not.toContain('osm');

    expect(itinerary.legs).toHaveLength(1);
    const leg = itinerary.legs[0];
    expect(leg.mode).toBe('walk');
    expect(leg.approximate).toBe(true);
    expect(leg.geometry).toBeDefined();
    expect(leg.geometry?.precision).toBe(6);
    const points = decodePolyline(leg.geometry?.points ?? '', leg.geometry?.precision ?? 5);
    expect(points).toHaveLength(2);
    expect(points[0][0]).toBeCloseTo(CUBAO.lat, 6);
    expect(points[0][1]).toBeCloseTo(CUBAO.lon, 6);
    expect(points[1][0]).toBeCloseTo(AYALA.lat, 6);
    expect(points[1][1]).toBeCloseTo(AYALA.lon, 6);
    expect(polylineLengthM(points)).toBeCloseTo(haversine, 0);

    expect(itinerary.walkDistanceM).toBe(leg.distanceM);
    expect(leg.distanceM).toBe(Math.round(haversine));
    // 4.5 km/h straight-line estimate, rounded up to whole minutes.
    expect(itinerary.durationMin).toBe(expectedWalkMinutes(haversine));
    expect(leg.durationMin).toBe(itinerary.durationMin);
    expect(itinerary.startTime).toBe(DEPART_AT);
    expect(leg.startTime).toBe(DEPART_AT);
    expect(Date.parse(itinerary.endTime) - Date.parse(DEPART_AT)).toBe(
      Math.ceil(haversine / (4.5 * 1000 / 3600)) * 1000,
    );

    expect(headers[FALLBACK_HEADER]).toBe('walk');
    expect(body.sources.map((source) => source.id)).toContain('walk-estimate');

    // Three itinerary attempts plus one direct-walk request.
    expect(urls.filter((url) => !isWalkUrl(url))).toHaveLength(3);
    const walkUrls = urls.filter(isWalkUrl);
    expect(walkUrls).toHaveLength(1);
    const walkCall = new URL(walkUrls[0]);
    expect(walkCall.searchParams.get('transitModes')).toBe('');
    expect(walkCall.searchParams.get('maxDirectTime')).toBe(
      String(expectedMaxDirectTime(haversine)),
    );
    expect(walkCall.searchParams.get('time')).toBe(DEPART_AT);
    expect(headers[MOTIS_CALLS_HEADER]).toBe('4');

    // Zero transit legs: the fallback never pretends to be a served service.
    expect(itinerary.legs.filter((candidate) => candidate.mode !== 'walk')).toEqual([]);
    expect(leg.routeShortName).toBeUndefined();
    expect(leg.headsign).toBeUndefined();
    expect(leg.signage).toBeUndefined();

    // The id is deterministic across identical requests.
    const second = await postPlan(app, CUBAO, AYALA);
    expect(second.body.itineraries[0]?.id).toBe(itinerary.id);
  });

  it('still returns the fallback for a ~300 m pair, with at least one minute', async () => {
    const { app } = stubApp(() => EMPTY_PLAN);
    const { statusCode, body } = await postPlan(app, CUBAO, NEAR);
    const haversine = distanceBetween(CUBAO, NEAR);

    expect(haversine).toBeGreaterThan(250);
    expect(haversine).toBeLessThan(350);
    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    expect(body.itineraries[0]?.fallback).toBe('walk');
    expect(body.itineraries[0]?.walkDistanceM).toBe(Math.round(haversine));
    expect(body.itineraries[0]?.durationMin).toBeGreaterThanOrEqual(1);
    expect(body.itineraries[0]?.durationMin).toBe(expectedWalkMinutes(haversine));
  });

  it('uses the routed road geometry when the walk request returns one', async () => {
    const routedWalk = {
      direct: [
        {
          duration: WALK_DIRECT.duration,
          legs: [
            { mode: 'WALK', duration: WALK_DIRECT.duration, legGeometry: WALK_GEOMETRY },
          ],
        },
      ],
    };
    const { app, urls } = stubApp((url) => (isWalkUrl(url) ? routedWalk : EMPTY_PLAN));
    const { statusCode, body, headers } = await postPlan(app, CUBAO, AYALA);

    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    const itinerary = body.itineraries[0];
    const leg = itinerary.legs[0];
    const expectedLength = polylineLengthM(
      decodePolyline(WALK_GEOMETRY.points, WALK_GEOMETRY.precision),
    );

    expect(itinerary.fallback).toBe('walk');
    expect(leg.geometry?.points).toBe(WALK_GEOMETRY.points);
    expect(leg.geometry?.precision).toBe(WALK_GEOMETRY.precision);
    // Routed geometry is not a straight-line approximation.
    expect(leg.approximate).toBeUndefined();
    expect(leg.distanceM).toBeGreaterThanOrEqual(Math.floor(expectedLength * 0.99));
    expect(leg.distanceM).toBeLessThanOrEqual(Math.ceil(expectedLength * 1.01));
    expect(itinerary.sources).toContain('osm');
    expect(itinerary.sources).toContain('walk-estimate');
    expect(leg.sourceIds).toContain('osm');
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    expect(urls.filter(isWalkUrl)).toHaveLength(1);

    // MOTIS reports the direct duration in SECONDS: 152 s -> 3 whole minutes.
    expect(itinerary.durationMin).toBe(Math.ceil(WALK_DIRECT.duration / 60));
    expect(itinerary.durationMin).toBe(3);
    expect(Date.parse(leg.endTime) - Date.parse(leg.startTime)).toBe(
      WALK_DIRECT.duration * 1000,
    );
  });

  it('degrades to the straight-line estimate when the walk request fails', async () => {
    const { app, urls } = stubApp((url) => {
      if (isWalkUrl(url)) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
      }
      return EMPTY_PLAN;
    });
    const { statusCode, body, headers } = await postPlan(app, CUBAO, AYALA);

    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    const itinerary = body.itineraries[0];
    expect(itinerary.fallback).toBe('walk');
    expect(itinerary.legs[0].approximate).toBe(true);
    expect(itinerary.legs[0].geometry).toBeDefined();
    expect(itinerary.sources).toEqual(['walk-estimate']);
    expect(itinerary.walkDistanceM).toBe(Math.round(distanceBetween(CUBAO, AYALA)));
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    // The client retries a transport failure once; both failures are swallowed
    // here because the base plan already answered (with zero options).
    expect(urls.filter(isWalkUrl)).toHaveLength(2);
  });

  it('surfaces a base plan transport failure as 502 and never fabricates a walk', async () => {
    const { app, urls } = stubApp(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    });
    const { statusCode, body, headers } = await postPlan(app, CUBAO, AYALA);

    expect(statusCode).toBe(502);
    expect(body.error?.code).toBe('ROUTER_UNAVAILABLE');
    expect(headers[FALLBACK_HEADER]).toBeUndefined();
    // The fallback only runs after `collectItineraries` returns; a failing base
    // call therefore keeps its existing 502 and never asks for walking geometry.
    expect(urls.some(isWalkUrl)).toBe(false);
  });

  it('keeps a >25 km fallback with the true distance and skips the walk graph', async () => {
    const { app, urls } = stubApp(() => EMPTY_PLAN);
    const haversine = distanceBetween(CUBAO, FAR);
    const { statusCode, body, headers } = await postPlan(app, CUBAO, FAR);

    expect(haversine).toBeGreaterThan(25_000);
    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    const itinerary = body.itineraries[0];
    expect(itinerary.fallback).toBe('walk');
    // The warning about a >25 km walk is UI copy; the API states the true
    // straight-line distance instead of suppressing the estimate.
    expect(itinerary.walkDistanceM).toBe(Math.round(haversine));
    expect(itinerary.durationMin).toBe(expectedWalkMinutes(haversine));
    expect(itinerary.legs[0].approximate).toBe(true);
    expect(itinerary.sources).toEqual(['walk-estimate']);
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    // Haversine already implies more than the 6 h ceiling: no request is sent.
    expect(urls.some(isWalkUrl)).toBe(false);
    expect(headers[MOTIS_CALLS_HEADER]).toBe('3');
  });

  it('never rounds a positive distance down to zero minutes', () => {
    const itinerary = buildWalkFallback({
      origin: CUBAO,
      destination: { lat: CUBAO.lat + 0.0001, lon: CUBAO.lon },
      departAt: DEPART_AT,
    });
    expect(itinerary.legs[0].distanceM).toBeGreaterThan(0);
    expect(itinerary.durationMin).toBe(1);
  });

  it('reports zero distance and zero minutes only when the points coincide', () => {
    const itinerary = buildWalkFallback({
      origin: CUBAO,
      destination: CUBAO,
      departAt: DEPART_AT,
    });
    expect(itinerary.legs[0].distanceM).toBe(0);
    expect(itinerary.durationMin).toBe(0);
  });

  it('gives identical input a deterministic id', () => {
    const first = buildWalkFallback({ origin: CUBAO, destination: AYALA, departAt: DEPART_AT });
    const second = buildWalkFallback({ origin: CUBAO, destination: AYALA, departAt: DEPART_AT });
    expect(first.id).toBe(second.id);
    expect(first.id.length).toBeGreaterThan(0);
  });

  it('treats a routed direct duration as seconds, not minutes', () => {
    // 8052 s is the probed Cubao -> Ayala walk duration (Lead finding F1); if
    // it were mistaken for minutes this assertion would read 8052.
    const itinerary = buildWalkFallback({
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      routedWalk: {
        points: WALK_GEOMETRY.points,
        precision: WALK_GEOMETRY.precision,
        distanceM: 177,
        durationSeconds: 8_052,
      },
    });
    expect(itinerary.durationMin).toBe(135);
    expect(itinerary.legs[0].durationMin).toBe(135);
    expect(Date.parse(itinerary.endTime) - Date.parse(DEPART_AT)).toBe(8_052_000);
    expect(itinerary.legs[0].approximate).toBeUndefined();
    expect(itinerary.sources).toEqual(['osm', 'walk-estimate']);
  });
});

describe('walkRouteMaxDirectTime', () => {
  it('sizes maxDirectTime in seconds with the 1.6 safety factor', () => {
    const haversine = distanceBetween(CUBAO, SIX_KM);
    const sized = walkRouteMaxDirectTime(CUBAO, SIX_KM);
    expect(sized).toBe(Math.ceil((haversine / 1.2) * 1.6));
    expect(sized).toBeGreaterThan(3_600);
    expect(sized).toBeLessThan(21_600);
  });

  it('floors small pairs at one hour', () => {
    expect(walkRouteMaxDirectTime(CUBAO, NEAR)).toBe(3_600);
  });

  it('clamps long pairs to the six-hour ceiling', () => {
    const haversine = distanceBetween(CUBAO, NINETEEN_KM);
    expect(haversine / 1.2).toBeLessThan(21_600);
    expect(walkRouteMaxDirectTime(CUBAO, NINETEEN_KM)).toBe(21_600);
  });

  it('returns undefined once the haversine walk exceeds the ceiling', () => {
    expect(walkRouteMaxDirectTime(CUBAO, FAR)).toBeUndefined();
  });
});

describe('mapRoutedWalk', () => {
  const routedPayload = (legs: unknown[], duration = 152) => ({
    direct: [{ duration, legs }],
  });

  it('returns undefined when the direct walk is absent', () => {
    expect(mapRoutedWalk({ itineraries: [], direct: [] })).toBeUndefined();
    expect(mapRoutedWalk(EMPTY_PLAN)).toBeUndefined();
    expect(mapRoutedWalk(undefined)).toBeUndefined();
    expect(mapRoutedWalk(routedPayload([]))).toBeUndefined();
  });

  it('returns undefined when the direct walk has no drawable geometry', () => {
    expect(
      mapRoutedWalk(
        routedPayload([{ mode: 'WALK', duration: 152, legGeometry: { points: '??', precision: 6 } }]),
      ),
    ).toBeUndefined();
  });

  it('measures the distance from the routed polyline and keeps the seconds duration', () => {
    const mapped = mapRoutedWalk(
      routedPayload([{ mode: 'WALK', duration: 152, legGeometry: WALK_GEOMETRY }]),
    );
    const expectedLength = polylineLengthM(
      decodePolyline(WALK_GEOMETRY.points, WALK_GEOMETRY.precision),
    );
    expect(mapped).toBeDefined();
    expect(mapped?.points).toBe(WALK_GEOMETRY.points);
    expect(mapped?.precision).toBe(WALK_GEOMETRY.precision);
    expect(mapped?.distanceM).toBeCloseTo(expectedLength, 5);
    expect(mapped?.durationSeconds).toBe(152);
  });
});
