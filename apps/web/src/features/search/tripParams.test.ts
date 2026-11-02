import { describe, expect, it } from 'vitest';
import {
  MAX_TRIP_STOPS,
  buildPlanPath,
  buildSearchPath,
  buildTripQuery,
  parseCoordinatePair,
  parseStops,
  parseTripParams,
  type TripDraft,
  type TripStop,
} from './tripParams';

/** Read a built path back through a real URL parser, as the app does. */
function paramsFrom(path: string): URLSearchParams {
  return new URL(path, 'https://app.test').searchParams;
}

const firstStop: TripStop = {
  lat: 14.58,
  lon: 121.04,
  stopId: 'stop-one',
  name: 'One Ayala',
};
const secondStop: TripStop = {
  lat: 14.6,
  lon: 121.05,
  stopId: 'stop-two',
  name: 'Kamuning',
};
const thirdStop: TripStop = {
  lat: 14.61,
  lon: 121.06,
  stopId: 'stop-three',
  name: 'Cubao',
};

const trip: TripDraft = {
  from: { lat: 14.549272, lon: 121.029103 },
  fromName: 'Ayala Terminal, Makati',
  dest: { lat: 14.6194, lon: 121.0531 },
  destName: 'Cubao, Quezon City',
  stops: [firstStop, secondStop],
};

describe('tripParams build and parse', () => {
  it('round-trips the whole trip through the /plan URL', () => {
    const path = buildPlanPath(trip);
    expect(path.startsWith('/plan?')).toBe(true);

    const parsed = parseTripParams(paramsFrom(path));
    expect(parsed.from).toEqual(trip.from);
    expect(parsed.fromName).toBe(trip.fromName);
    expect(parsed.dest).toEqual(trip.dest);
    expect(parsed.destName).toBe(trip.destName);
    expect(parsed.stops).toEqual(trip.stops);
    expect(parsed.hasFrom).toBe(true);
    expect(parsed.hasDest).toBe(true);
  });

  it('encodes via exactly once and keeps the stops in travel order', () => {
    const path = buildPlanPath(trip);
    // encodeURIComponent(JSON.stringify(...)) starts with `[{"lat":`.
    expect(path).toContain(`via=${encodeURIComponent(JSON.stringify(trip.stops))}`);
    // One URLSearchParams read is the only decode the reader performs.
    expect(paramsFrom(path).get('via')).toBe(JSON.stringify(trip.stops));
    expect(parseTripParams(paramsFrom(path)).stops.map((stop) => stop.stopId)).toEqual([
      'stop-one',
      'stop-two',
    ]);
  });

  it('caps via at the router limit, keeping the earliest stops', () => {
    const path = buildPlanPath({ ...trip, stops: [firstStop, secondStop, thirdStop] });
    expect(parseTripParams(paramsFrom(path)).stops).toHaveLength(MAX_TRIP_STOPS);
    expect(parseTripParams(paramsFrom(path)).stops.map((stop) => stop.stopId)).toEqual([
      'stop-one',
      'stop-two',
    ]);

    const handWritten = paramsFrom(
      `/plan?via=${encodeURIComponent(JSON.stringify([firstStop, secondStop, thirdStop]))}`,
    );
    expect(parseStops(handWritten.get('via'))).toHaveLength(MAX_TRIP_STOPS);
  });

  it('drops malformed via payloads instead of throwing', () => {
    expect(parseStops('not-json')).toEqual([]);
    expect(parseStops('{"stops":[]}')).toEqual([]);
    expect(parseStops('null')).toEqual([]);
    expect(parseStops('')).toEqual([]);
    expect(parseStops(null)).toEqual([]);
    expect(parseStops(undefined)).toEqual([]);
    expect(parseTripParams(paramsFrom('/search?via=%7Bbroken')).stops).toEqual([]);
  });

  it('keeps valid via entries and drops the invalid ones', () => {
    const raw = JSON.stringify([
      firstStop,
      { lat: 95, lon: 121.05, stopId: 'bad-lat', name: 'Bad latitude' },
      { lat: 14.6, lon: 121.05, stopId: '   ', name: 'No stop id' },
      { lat: 14.6, lon: 121.05, stopId: 'stop-two' },
      null,
      'not-an-object',
    ]);

    expect(parseStops(raw)).toEqual([firstStop, { ...secondStop, name: '' }]);
  });

  it('validates coordinate pairs and their ranges', () => {
    expect(parseCoordinatePair('14.6,121.0')).toEqual({ lat: 14.6, lon: 121 });
    expect(parseCoordinatePair('-90,-180')).toEqual({ lat: -90, lon: -180 });
    expect(parseCoordinatePair('90,180')).toEqual({ lat: 90, lon: 180 });

    expect(parseCoordinatePair('91,0')).toBeNull();
    expect(parseCoordinatePair('0,181')).toBeNull();
    expect(parseCoordinatePair('0,-181')).toBeNull();
    expect(parseCoordinatePair('abc')).toBeNull();
    expect(parseCoordinatePair('1,2,3')).toBeNull();
    expect(parseCoordinatePair('1,')).toBeNull();
    expect(parseCoordinatePair(',2')).toBeNull();
    expect(parseCoordinatePair('14.6abc,121')).toBeNull();
    expect(parseCoordinatePair('')).toBeNull();
    expect(parseCoordinatePair(null)).toBeNull();
    expect(parseCoordinatePair(undefined)).toBeNull();
  });

  it('returns a safe empty state for an absent query string', () => {
    const empty = {
      from: null,
      fromName: null,
      dest: null,
      destName: null,
      stops: [],
      hasFrom: false,
      hasDest: false,
    };
    expect(parseTripParams(null)).toEqual(empty);
    expect(parseTripParams(undefined)).toEqual(empty);
    expect(parseTripParams(new URLSearchParams())).toEqual(empty);
  });

  it('drops an out-of-range end but still reports that the parameter existed', () => {
    const parsed = parseTripParams(
      paramsFrom('/plan?from=91,0&fromName=Nowhere&dest=14.6,121.0&name=Ayala'),
    );

    expect(parsed.from).toBeNull();
    expect(parsed.fromName).toBeNull();
    expect(parsed.hasFrom).toBe(true);
    expect(parsed.dest).toEqual({ lat: 14.6, lon: 121 });
    expect(parsed.destName).toBe('Ayala');
    expect(parsed.hasDest).toBe(true);
  });

  it('builds the search prefill path and falls back to the bare paths', () => {
    expect(buildSearchPath(trip)).toBe(`/search?${buildTripQuery(trip)}`);
    expect(buildPlanPath(trip)).toBe(`/plan?${buildTripQuery(trip)}`);

    const blank: TripDraft = {
      from: null,
      fromName: null,
      dest: null,
      destName: null,
      stops: [],
    };
    expect(buildSearchPath(blank)).toBe('/search');
    expect(buildPlanPath(blank)).toBe('/plan');
  });

  it('round-trips names that need URL encoding', () => {
    const awkward: TripDraft = {
      from: { lat: 14.55, lon: 121.02 },
      fromName: 'A & B "terminal" / 50%',
      dest: { lat: 14.62, lon: 121.05 },
      destName: 'Ñuñez, Makati',
      stops: [{ ...firstStop, name: 'EdSA & 50% “corner”' }],
    };

    const parsed = parseTripParams(paramsFrom(buildPlanPath(awkward)));
    expect(parsed.fromName).toBe('A & B "terminal" / 50%');
    expect(parsed.destName).toBe('Ñuñez, Makati');
    expect(parsed.stops[0]?.name).toBe('EdSA & 50% “corner”');
  });

  it('never builds a via key for blank or invalid stop slots', () => {
    const invalidStops = [
      { lat: 100, lon: 121, stopId: 'out-of-range', name: 'Bad' },
      { lat: 14.6, lon: 121, stopId: '', name: 'No id' },
    ];
    expect(buildPlanPath({ ...trip, stops: invalidStops })).not.toContain('via=');
  });
});
