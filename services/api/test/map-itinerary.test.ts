import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ItineraryDto, LegMode } from '@biyahey/shared';
import {
  MAX_TRANSIT_SPEED_KMH,
  decodePolyline,
  implausibleTransitLegs,
  isPlausibleItinerary,
  mapPlanItineraries,
  mapPlanItinerariesDetailed,
  modeFromRouteId,
  polylineLengthM,
} from '../src/routing/map-itinerary.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface Geometry {
  points: string;
  precision?: number;
}

interface WalkLeg {
  mode: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  distance: number;
  legGeometry: Geometry;
}

interface FixturePlan {
  itineraries: { legs: WalkLeg[] }[];
}

const planFixture = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'motis-plan-cubao-ayala.json'), 'utf8'),
) as FixturePlan;

describe('modeFromRouteId', () => {
  it('maps both the current rail ids and the alternative rail-mrt3 aliases', () => {
    expect(modeFromRouteId('gtfs_rail-3')).toBe('mrt3');
    expect(modeFromRouteId('rail-mrt3')).toBe('mrt3');
    expect(modeFromRouteId('gtfs_rail-2')).toBe('lrt2');
    expect(modeFromRouteId('rail-lrt2')).toBe('lrt2');
    expect(modeFromRouteId('gtfs_rail-1')).toBe('lrt1');
    expect(modeFromRouteId('rail-lrt1')).toBe('lrt1');
  });

  it('uses the GTFS route-id prefix as the mode contract', () => {
    expect(modeFromRouteId('gtfs_bus-59')).toBe('bus');
    expect(modeFromRouteId('gtfs_jeep-t101')).toBe('jeepney');
    expect(modeFromRouteId('uv-c20')).toBe('uv-express');
    expect(modeFromRouteId('ferry-prfsguadelupeescolta')).toBe('ferry');
  });

  it('returns undefined for rail lines v1 has no fare mode for', () => {
    expect(modeFromRouteId('gtfs_rail-ss')).toBeUndefined();
    expect(modeFromRouteId('rail-mnc')).toBeUndefined();
    expect(modeFromRouteId('rail-mrt9')).toBeUndefined();
    expect(modeFromRouteId('taxi-1')).toBeUndefined();
  });

  it('prices only the MMDA PRFS ferry family, not long-distance ferries', () => {
    expect(modeFromRouteId('gtfs_ferry-prfsescoltapinagbuhatan')).toBe('ferry');
    expect(modeFromRouteId('ferry-prfsguadelupeescolta')).toBe('ferry');
    expect(modeFromRouteId('gtfs_ferry-manilacoron')).toBeUndefined();
    expect(modeFromRouteId('ferry-maniladavaocitygeneralsantosiloilomanila')).toBeUndefined();
  });
});

describe('plausibility guard', () => {
  function transitItinerary(
    distanceM: number,
    durationMin: number,
    mode: LegMode = 'bus',
  ): ItineraryDto {
    const startTime = '2026-11-02T08:00:00+08:00';
    const endTime = '2026-11-02T09:30:00+08:00';
    return {
      id: 'it-test',
      durationMin,
      startTime,
      endTime,
      transfers: 0,
      walkDistanceM: 0,
      modes: [mode],
      fare: {
        amount: 0,
        currency: 'PHP',
        confidence: 'official',
        effective_from: '2026-09-28',
        source_id: null,
        breakdown: [],
      },
      sources: ['osm'],
      legs: [
        {
          mode,
          from: { name: 'A', lat: 14.6, lon: 121.0 },
          to: { name: 'B', lat: 14.7, lon: 121.1 },
          startTime,
          endTime,
          durationMin,
          landmarkHint: null,
          distanceM,
          sourceIds: ['osm'],
        },
      ],
    };
  }

  it('flags the live 70 km-in-2-min through-bus shape as impossible', () => {
    const impossible = transitItinerary(70_231, 2);
    expect(isPlausibleItinerary(impossible)).toBe(false);
    const flagged = implausibleTransitLegs(impossible);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.impliedSpeedKmh).toBeGreaterThan(1_000);
  });

  it('does not prune a legitimate long-distance provincial bus', () => {
    expect(MAX_TRANSIT_SPEED_KMH).toBe(120);
    // 100 km in 90 min = 67 km/h: a real provincial run.
    expect(isPlausibleItinerary(transitItinerary(100_000, 90))).toBe(true);
    // The observed Cubao-Balayan shape: 40.6 km claimed in 2 min.
    expect(isPlausibleItinerary(transitItinerary(40_625, 2))).toBe(false);
  });

  it('evaluates a sub-minute leg with a 30-second floor, not a division by zero', () => {
    expect(isPlausibleItinerary(transitItinerary(400, 0))).toBe(true); // 48 km/h
    expect(isPlausibleItinerary(transitItinerary(1_400, 0))).toBe(false); // 168 km/h
  });

  it('never flags a walk leg', () => {
    expect(isPlausibleItinerary(transitItinerary(10_000, 1, 'walk'))).toBe(true);
  });
});

describe('plausibility guard raw durations', () => {
  const context = {
    freeRideRouteIds: new Set<string>(),
    curatedLandmarks: new Map<string, readonly string[]>(),
    curatedRouteIds: new Set<string>(),
  };

  /** Map one synthetic 2.1 km bus leg that really takes `durationSeconds`. */
  function mappedPlan(durationSeconds: number): ItineraryDto | undefined {
    const startMs = Date.parse('2026-11-02T08:00:00+08:00');
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(startMs + durationSeconds * 1_000).toISOString();
    return mapPlanItineraries(
      {
        itineraries: [
          {
            duration: durationSeconds,
            legs: [
              {
                mode: 'BUS',
                routeId: 'gtfs_bus-61',
                from: { name: 'A', lat: 14.6, lon: 121.0 },
                to: { name: 'B', lat: 14.7, lon: 121.1 },
                startTime,
                endTime,
                duration: durationSeconds,
                distance: 2_100,
              },
            ],
          },
        ],
      },
      context,
    )[0];
  }

  it('judges the raw 84 s, not the rounded 1 min (90 km/h kept, not 126 dropped)', () => {
    const itinerary = mappedPlan(84);
    expect(itinerary).toBeDefined();
    // The served DTO carries only the rounded minute, which would read 126 km/h.
    expect(itinerary?.legs[0]?.durationMin).toBe(1);
    expect(isPlausibleItinerary(itinerary!)).toBe(true);
  });

  it('still drops the same 2.1 km claimed in 60 s (126 km/h)', () => {
    const itinerary = mappedPlan(60);
    expect(itinerary).toBeDefined();
    expect(isPlausibleItinerary(itinerary!)).toBe(false);
  });
});

describe('decodePolyline', () => {
  it('decodes MOTIS precision-6 geometry and matches its own walk distance', () => {
    const leg = planFixture.itineraries[0].legs[0];
    const points = decodePolyline(leg.legGeometry.points, leg.legGeometry.precision);

    expect(points.length).toBeGreaterThan(1);
    expect(points[0][0]).toBeCloseTo(leg.from.lat, 4);
    expect(points[0][1]).toBeCloseTo(leg.from.lon, 4);
    // MOTIS snaps the encoded geometry to the road, so the final vertex is near
    // the stop but not necessarily identical to it.
    expect(points[points.length - 1][0]).toBeCloseTo(leg.to.lat, 3);
    expect(points[points.length - 1][1]).toBeCloseTo(leg.to.lon, 3);

    const lengthM = polylineLengthM(points);
    expect(Math.abs(lengthM - leg.distance)).toBeLessThan(10);
  });
});

describe('unsupported-mode gate and informal transfers', () => {
  const emptyContext = {
    freeRideRouteIds: new Set<string>(),
    curatedLandmarks: new Map<string, readonly string[]>(),
    curatedRouteIds: new Set<string>(),
  };
  const start = '2026-11-02T08:00:00Z';

  function busLeg(routeId: string, from: string, to: string, distance = 5_000) {
    return {
      mode: 'BUS',
      routeId,
      routeShortName: routeId.split('-').pop(),
      from: { name: from, lat: 14.62, lon: 121.05 },
      to: { name: to, lat: 14.63, lon: 121.06 },
      startTime: start,
      endTime: start,
      duration: 600,
      distance,
    };
  }

  it('reports an unsupported rail itinerary instead of mapping it', () => {
    const { itineraries, unsupportedKeys } = mapPlanItinerariesDetailed(
      { itineraries: [{ startTime: start, legs: [busLeg('gtfs_rail-ss', 'A', 'B')] }] },
      emptyContext,
    );
    expect(itineraries).toEqual([]);
    expect(unsupportedKeys).toHaveLength(1);
  });

  it('reports a non-PRFS ferry itinerary as unsupported', () => {
    const { itineraries, unsupportedKeys } = mapPlanItinerariesDetailed(
      {
        itineraries: [{ startTime: start, legs: [busLeg('gtfs_ferry-manilacoron', 'A', 'B')] }],
      },
      emptyContext,
    );
    expect(itineraries).toEqual([]);
    expect(unsupportedKeys).toHaveLength(1);
  });

  it('keeps a PRFS ferry itinerary and prices it free', () => {
    const { itineraries } = mapPlanItinerariesDetailed(
      {
        itineraries: [
          {
            startTime: start,
            legs: [busLeg('gtfs_ferry-prfsescoltapinagbuhatan', 'A', 'B', 12_000)],
          },
        ],
      },
      emptyContext,
    );
    expect(itineraries).toHaveLength(1);
    const leg = itineraries[0]?.legs[0];
    expect(leg?.mode).toBe('ferry');
    expect(itineraries[0]?.fare.amount).toBe(0);
    expect(itineraries[0]?.fare.source_id).toBe('mmda-ferry');
  });

  it('marks a walk between two transit legs as an informal transfer', () => {
    const payload = {
      itineraries: [
        {
          duration: 2_000,
          startTime: start,
          endTime: start,
          transfers: 1,
          legs: [
            {
              mode: 'WALK',
              from: { name: 'START', lat: 14.61, lon: 121.05 },
              to: { name: 'A', lat: 14.62, lon: 121.05 },
              startTime: start,
              endTime: start,
              duration: 240,
              distance: 300,
            },
            busLeg('gtfs_bus-1', 'A', 'B'),
            {
              mode: 'WALK',
              from: { name: 'B', lat: 14.63, lon: 121.06 },
              to: { name: 'C', lat: 14.631, lon: 121.061 },
              startTime: start,
              endTime: start,
              duration: 180,
              distance: 150,
            },
            busLeg('gtfs_bus-2', 'C', 'END'),
          ],
        },
      ],
    };
    const itinerary = mapPlanItineraries(payload, emptyContext)[0];
    expect(itinerary?.legs).toHaveLength(4);
    expect(itinerary?.legs[0]?.informalTransfer).toBeUndefined();
    expect(itinerary?.legs[2]?.informalTransfer).toBe(true);
  });

  it('does not label a walk-only trip as an informal transfer', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              {
                mode: 'WALK',
                from: { name: 'START', lat: 14.61, lon: 121.05 },
                to: { name: 'END', lat: 14.62, lon: 121.05 },
                startTime: start,
                endTime: start,
                duration: 240,
                distance: 300,
              },
            ],
          },
        ],
      },
      emptyContext,
    )[0];
    expect(itinerary?.legs[0]?.informalTransfer).toBeUndefined();
  });
});

describe('transit stop lists (R61)', () => {
  const emptyContext = {
    freeRideRouteIds: new Set<string>(),
    curatedLandmarks: new Map<string, readonly string[]>(),
    curatedRouteIds: new Set<string>(),
  };
  const start = '2026-11-02T08:00:00Z';
  const end = '2026-11-02T08:30:00Z';

  function transitLeg(overrides: Record<string, unknown> = {}) {
    return {
      mode: 'SUBWAY',
      routeId: 'gtfs_rail-3',
      routeShortName: '3',
      displayName: 'MRT-3',
      headsign: 'Ayala',
      from: {
        name: 'Cubao',
        stopId: 'gtfs_rail-3:node:board',
        lat: 14.6194,
        lon: 121.0531,
        departure: '2026-11-02T08:02:00Z',
      },
      to: {
        name: 'Ayala',
        stopId: 'gtfs_rail-3:node:alight',
        lat: 14.5487,
        lon: 121.0275,
        arrival: '2026-11-02T08:28:00Z',
      },
      startTime: start,
      endTime: end,
      duration: 1_800,
      distance: 9_260,
      intermediateStops: [
        {
          name: 'Santolan-Annapolis',
          stopId: 'gtfs_rail-3:node:santolan',
          lat: 14.6075,
          lon: 121.0566,
          arrival: '2026-11-02T08:10:00Z',
          departure: '2026-11-02T08:10:00Z',
        },
        {
          name: 'Ortigas',
          stopId: 'gtfs_rail-3:node:ortigas',
          lat: 14.5873,
          lon: 121.0565,
          arrival: '2026-11-02T08:17:00Z',
          departure: '2026-11-02T08:18:00Z',
        },
      ],
      ...overrides,
    };
  }

  it('maps board first, intermediates in order, alight last with times', () => {
    const itinerary = mapPlanItineraries(
      { itineraries: [{ startTime: start, legs: [transitLeg()] }] },
      emptyContext,
    )[0];
    const stops = itinerary?.legs[0]?.stops;

    expect(stops?.map((stop) => stop.name)).toEqual([
      'Cubao',
      'Santolan-Annapolis',
      'Ortigas',
      'Ayala',
    ]);
    expect(stops?.[0]).toMatchObject({
      stopId: 'gtfs_rail-3:node:board',
      departureTime: '2026-11-02T08:02:00Z',
    });
    expect(stops?.[0]?.arrivalTime).toBeUndefined();
    expect(stops?.[1]).toMatchObject({
      stopId: 'gtfs_rail-3:node:santolan',
      arrivalTime: '2026-11-02T08:10:00Z',
      departureTime: '2026-11-02T08:10:00Z',
    });
    expect(stops?.[3]).toMatchObject({
      name: 'Ayala',
      stopId: 'gtfs_rail-3:node:alight',
      arrivalTime: '2026-11-02T08:28:00Z',
    });
    expect(stops?.[3]?.departureTime).toBeUndefined();
  });

  it('deduplicates by stop id and keeps the alight stop pinned last', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              transitLeg({
                intermediateStops: [
                  // Same served stop as the board endpoint.
                  {
                    name: 'Cubao',
                    stopId: 'gtfs_rail-3:node:board',
                    lat: 14.6194,
                    lon: 121.0531,
                  },
                  {
                    name: 'Ortigas',
                    stopId: 'gtfs_rail-3:node:ortigas',
                    lat: 14.5873,
                    lon: 121.0565,
                  },
                  // Same served stop as the alight endpoint: must not displace it.
                  {
                    name: 'Ayala',
                    stopId: 'gtfs_rail-3:node:alight',
                    lat: 14.5487,
                    lon: 121.0275,
                  },
                ],
              }),
            ],
          },
        ],
      },
      emptyContext,
    )[0];

    expect(itinerary?.legs[0]?.stops?.map((stop) => stop.name)).toEqual([
      'Cubao',
      'Ortigas',
      'Ayala',
    ]);
  });

  it('deduplicates by name and coordinates when the router sends no stop id', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              transitLeg({
                from: { name: 'Cubao', lat: 14.6194, lon: 121.0531, departure: start },
                to: {
                  name: 'Ayala',
                  lat: 14.5487,
                  lon: 121.0275,
                  arrival: '2026-11-02T08:28:00Z',
                },
                intermediateStops: [
                  { name: 'Cubao', lat: 14.6194, lon: 121.0531 },
                  { name: 'Ortigas', lat: 14.5873, lon: 121.0565 },
                  { name: 'Ayala', lat: 14.5487, lon: 121.0275 },
                ],
              }),
            ],
          },
        ],
      },
      emptyContext,
    )[0];

    const stops = itinerary?.legs[0]?.stops;
    expect(stops?.map((stop) => stop.name)).toEqual(['Cubao', 'Ortigas', 'Ayala']);
    expect(stops?.every((stop) => stop.stopId === undefined)).toBe(true);
    // The alight endpoint still keeps its role: last row, arrival only.
    expect(stops?.[2]?.arrivalTime).toBe('2026-11-02T08:28:00Z');
  });

  it('omits stops when intermediateStops is an empty list', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [transitLeg({ intermediateStops: [] })],
          },
        ],
      },
      emptyContext,
    )[0];

    expect(itinerary?.legs[0]?.mode).toBe('mrt3');
    expect(itinerary?.legs[0]).not.toHaveProperty('stops');
  });

  it('omits stops when every intermediate stop is malformed', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              transitLeg({
                intermediateStops: [
                  null,
                  { name: 'Name only' },
                  { lat: 14.6, lon: 121.0 },
                  'not-an-object',
                ],
              }),
            ],
          },
        ],
      },
      emptyContext,
    )[0];

    expect(itinerary?.legs[0]?.mode).toBe('mrt3');
    expect(itinerary?.legs[0]).not.toHaveProperty('stops');
  });

  it('falls back to the leg start and end when MOTIS omits endpoint times', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              transitLeg({
                from: {
                  name: 'Cubao',
                  stopId: 'gtfs_rail-3:node:board',
                  lat: 14.6194,
                  lon: 121.0531,
                },
                to: {
                  name: 'Ayala',
                  stopId: 'gtfs_rail-3:node:alight',
                  lat: 14.5487,
                  lon: 121.0275,
                },
              }),
            ],
          },
        ],
      },
      emptyContext,
    )[0];

    const stops = itinerary?.legs[0]?.stops;
    expect(stops?.[0]?.departureTime).toBe(start);
    expect(stops?.[0]?.arrivalTime).toBeUndefined();
    expect(stops?.at(-1)?.arrivalTime).toBe(end);
    expect(stops?.at(-1)?.departureTime).toBeUndefined();
  });

  it('omits stops on a walk leg', () => {
    const itinerary = mapPlanItineraries(
      {
        itineraries: [
          {
            startTime: start,
            legs: [
              {
                mode: 'WALK',
                from: { name: 'START', lat: 14.61, lon: 121.05 },
                to: { name: 'END', lat: 14.62, lon: 121.05 },
                startTime: start,
                endTime: end,
                duration: 600,
                distance: 300,
              },
            ],
          },
        ],
      },
      emptyContext,
    )[0];

    expect(itinerary?.legs[0]?.mode).toBe('walk');
    expect(itinerary?.legs[0]).not.toHaveProperty('stops');
  });

  it('still maps a response whose legs carry no intermediateStops field', () => {
    const leg = transitLeg();
    delete (leg as { intermediateStops?: unknown }).intermediateStops;

    const itinerary = mapPlanItineraries(
      { itineraries: [{ startTime: start, legs: [leg] }] },
      emptyContext,
    )[0];

    expect(itinerary?.legs[0]?.mode).toBe('mrt3');
    expect(itinerary?.legs[0]).not.toHaveProperty('stops');
  });

  it('maps the checked-in MOTIS fixture rail stops with the alight stop last', () => {
    const itinerary = mapPlanItineraries(planFixture, emptyContext).find((candidate) =>
      candidate.legs.some((leg) => leg.mode === 'mrt3'),
    );
    const railLeg = itinerary?.legs.find((leg) => leg.mode === 'mrt3');

    // The live-shaped fixture has 8 intermediate stops; the DTO adds the board
    // and alight endpoints around them.
    expect(railLeg?.stops).toHaveLength(10);
    expect(railLeg?.stops?.at(0)?.name).toBe('Platform 793338664');
    expect(railLeg?.stops?.at(-1)?.name).toBe('Ayala');
    expect(railLeg?.stops?.at(-1)?.arrivalTime).toBe('2026-11-02T00:36:00Z');
  });
});

describe('leg geometry carry-through', () => {
  const emptyContext = {
    freeRideRouteIds: new Set<string>(),
    curatedLandmarks: new Map<string, readonly string[]>(),
    curatedRouteIds: new Set<string>(),
  };
  const start = '2026-11-02T08:00:00Z';
  const end = '2026-11-02T08:30:00Z';

  function walkLeg(overrides: Record<string, unknown> = {}) {
    return {
      mode: 'WALK',
      from: { name: 'START', lat: 14.555813, lon: 121.022334 },
      to: { name: 'END', lat: 14.554013, lon: 121.023973 },
      startTime: start,
      endTime: end,
      duration: 600,
      distance: 300,
      ...overrides,
    };
  }

  function mapSingleLeg(legGeometry: unknown): ItineraryDto | undefined {
    return mapPlanItineraries(
      { itineraries: [{ startTime: start, legs: [walkLeg({ legGeometry })] }] },
      emptyContext,
    )[0];
  }

  it('copies the fixture leg geometry through untouched at precision 6', () => {
    const fixtureGeometry = planFixture.itineraries[0].legs[0].legGeometry;
    const itinerary = mapPlanItineraries(planFixture, emptyContext)[0];
    const geometry = itinerary?.legs[0]?.geometry;

    expect(geometry).toEqual({ points: fixtureGeometry.points, precision: 6 });
    // The copied encoding is the same drawable shape the API measured: decoding
    // it again must yield more than the two endpoint vertices.
    expect(decodePolyline(geometry!.points, geometry!.precision).length).toBeGreaterThan(2);
  });

  it('leaves the additive field absent when MOTIS sends no legGeometry', () => {
    const itinerary = mapSingleLeg(undefined);
    expect(itinerary?.legs[0]?.mode).toBe('walk');
    expect(itinerary?.legs[0]).not.toHaveProperty('geometry');
  });

  it('leaves the additive field absent for malformed or undrawable geometry', () => {
    const malformed: unknown[] = [
      'not-an-object',
      { precision: 6 }, // no points
      { points: '', precision: 6 }, // empty encoding
      { points: 42, precision: 6 }, // non-string encoding
      { points: 'AA', precision: 6 }, // decodes to one vertex, not a line
    ];
    for (const legGeometry of malformed) {
      const itinerary = mapSingleLeg(legGeometry);
      expect(itinerary?.legs[0], JSON.stringify(legGeometry)).not.toHaveProperty('geometry');
    }
  });

  it('falls back to the polyline default precision 5 when precision is invalid', () => {
    const points = planFixture.itineraries[0].legs[0].legGeometry.points;
    for (const precision of [undefined, 'six', 6.5, -1, 12]) {
      const itinerary = mapSingleLeg({ points, precision });
      expect(itinerary?.legs[0]?.geometry).toEqual({ points, precision: 5 });
    }
  });
});
