import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
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
