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
});

describe('plausibility guard', () => {
  function transitItinerary(distanceM: number, durationMin: number, mode: LegMode = 'bus'): ItineraryDto {
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
