import type { FareQuote, ItineraryDto, LegDto, LegMode, LegPlaceDto } from '@biyahey/shared';

/**
 * Test-only itinerary builders shared by the UX v2 specs.
 *
 * Real payloads come from `src/test/fixtures/*.json`; these builders exist for
 * the small, exact shapes a component test wants (three legs, a walk-only trip,
 * a 15-leg provincial ride) without depending on the router's live data.
 */

export const TEST_FARE: FareQuote = {
  amount: 29,
  currency: 'PHP',
  confidence: 'official',
  effective_from: '2026-03-23',
  source_id: null,
  breakdown: [],
};

const START = '2026-11-03T05:25:00.000Z';

/** Google polyline chunk encoder (lat/lon deltas, zig-zag signed). */
function encodeChunk(value: number, chunks: number[]): void {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  while (encoded >= 0x20) {
    chunks.push((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  chunks.push(encoded + 63);
}

/** Encode a `[lat, lon]` path exactly the way MOTIS encodes `legGeometry`. */
export function encodePolyline(
  points: readonly (readonly [number, number])[],
  precision = 6,
): string {
  const factor = 10 ** precision;
  const chunks: number[] = [];
  let previousLat = 0;
  let previousLon = 0;
  for (const [lat, lon] of points) {
    const latValue = Math.round(lat * factor);
    const lonValue = Math.round(lon * factor);
    encodeChunk(latValue - previousLat, chunks);
    encodeChunk(lonValue - previousLon, chunks);
    previousLat = latValue;
    previousLon = lonValue;
  }
  return String.fromCharCode(...chunks);
}

/** A slightly bent three-point geometry, i.e. a routed-looking path. */
function makeGeometry(
  from: LegPlaceDto,
  to: LegPlaceDto,
): NonNullable<LegDto['geometry']> {
  const midLat = (from.lat + to.lat) / 2 + 0.0003;
  const midLon = (from.lon + to.lon) / 2 - 0.0002;
  return {
    points: encodePolyline([
      [from.lat, from.lon],
      [midLat, midLon],
      [to.lat, to.lon],
    ]),
    precision: 6,
  };
}

function place(name: string, lat: number, lon: number): LegPlaceDto {
  return { name, lat, lon };
}

let sequence = 0;

/** Build one leg; every field an assertion may read is overridable. */
export function makeLeg(overrides: Partial<LegDto> & Pick<LegDto, 'mode'>): LegDto {
  sequence += 1;
  const { mode, geometry: geometryOverride, ...rest } = overrides;
  const walk = mode === 'walk';
  const from = rest.from ?? place('Cubao', 14.6195, 121.0528);
  const to = rest.to ?? place('Ayala', 14.5547, 121.0244);
  return {
    mode,
    from,
    to,
    // Real MOTIS plans always carry a polyline; a fixture that omitted it would
    // look like the legacy/fallback chord the map draws dashed.
    geometry: geometryOverride ?? makeGeometry(from, to),
    startTime: START,
    endTime: '2026-11-03T05:29:00.000Z',
    durationMin: walk ? 4 : 20,
    routeShortName: walk ? undefined : 'MRT-3',
    headsign: walk ? undefined : 'Ayala',
    signage: walk ? undefined : 'Look for: MRT-3',
    landmarkHint: null,
    distanceM: walk ? 189 : 13400,
    sourceIds: [],
    ...rest,
  };
}

/** Build an itinerary whose legs are the argument. */
export function makeItinerary(
  legs: LegDto[],
  overrides: Partial<ItineraryDto> = {},
): ItineraryDto {
  sequence += 1;
  const walkM = legs
    .filter((leg) => leg.mode === 'walk')
    .reduce((sum, leg) => sum + leg.distanceM, 0);
  return {
    id: `itinerary-${sequence}`,
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    startTime: legs[0]?.startTime ?? START,
    endTime: legs[legs.length - 1]?.endTime ?? START,
    transfers: Math.max(0, legs.filter((leg) => leg.mode !== 'walk').length - 1),
    walkDistanceM: walkM,
    modes: [...new Set(legs.map((leg) => leg.mode))],
    fare: TEST_FARE,
    sources: [],
    legs,
    ...overrides,
  };
}

/** The canonical three-leg rail trip: walk → MRT-3 → walk. */
export function makeRailTrip(): ItineraryDto {
  return makeItinerary([
    makeLeg({ mode: 'walk', to: place('Cubao', 14.6195, 121.0528) }),
    makeLeg({
      mode: 'mrt3',
      from: place('Cubao', 14.6195, 121.0528),
      to: place('Ayala', 14.5547, 121.0244),
      stops: [
        { name: 'Cubao', lat: 14.6195, lon: 121.0528 },
        { name: 'Ortigas', lat: 14.5878, lon: 121.0568 },
        { name: 'Boni', lat: 14.5739, lon: 121.0484 },
        { name: 'Guadalupe', lat: 14.5647, lon: 121.0457 },
        { name: 'Ayala', lat: 14.5547, lon: 121.0244 },
      ],
    }),
    makeLeg({ mode: 'walk', from: place('Ayala', 14.5547, 121.0244) }),
  ]);
}

/** A trip that is only walking (no ride leg, no mode colour to rely on). */
export function makeWalkOnlyItinerary(): ItineraryDto {
  return makeItinerary([makeLeg({ mode: 'walk', durationMin: 18, distanceM: 1400 })]);
}

/** A 15-leg itinerary (the long provincial fixture's shape). */
export function makeLongItinerary(legCount = 15): ItineraryDto {
  const modes: LegMode[] = ['walk', 'jeepney', 'walk', 'bus', 'mrt3', 'walk'];
  return makeItinerary(
    Array.from({ length: legCount }, (_, index) =>
      makeLeg({
        mode: modes[index % modes.length]!,
        durationMin: (index % 5) + 1,
        distanceM: (index + 1) * 400,
      }),
    ),
  );
}
