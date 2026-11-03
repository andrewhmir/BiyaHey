import { describe, expect, it } from 'vitest';
import {
  makeItinerary,
  makeLeg,
  makeRailTrip,
  makeWalkOnlyItinerary,
} from '../test/fixtures/itinerary';
import { itineraryEndpoints, legsTotalMinutes, rideLegCount } from './itinerary';

describe('itineraryEndpoints', () => {
  it('reads the first leg origin and the last leg destination', () => {
    const itinerary = makeRailTrip();
    expect(itineraryEndpoints(itinerary)).toEqual({ from: 'Cubao', to: 'Ayala' });
  });

  it('falls back to the other endpoint when one leg name is blank', () => {
    const itinerary = makeItinerary([
      makeLeg({ mode: 'walk', from: { name: '  ', lat: 0, lon: 0 } }),
      makeLeg({ mode: 'bus', to: { name: 'Ortigas', lat: 0, lon: 0 } }),
    ]);
    expect(itineraryEndpoints(itinerary)).toEqual({ from: 'Ortigas', to: 'Ortigas' });
  });

  it('returns empty strings for a nameless itinerary instead of inventing a title', () => {
    const itinerary = makeItinerary([
      makeLeg({
        mode: 'walk',
        from: { name: '', lat: 0, lon: 0 },
        to: { name: '', lat: 0, lon: 0 },
      }),
    ]);
    expect(itineraryEndpoints(itinerary)).toEqual({ from: '', to: '' });
  });

  it('works for a walk-only itinerary', () => {
    expect(itineraryEndpoints(makeWalkOnlyItinerary()).to).toBe('Ayala');
  });
});

describe('itinerary leg helpers', () => {
  it('counts only the ridden legs', () => {
    expect(rideLegCount(makeRailTrip())).toBe(1);
    expect(rideLegCount(makeWalkOnlyItinerary())).toBe(0);
  });

  it('sums the scheduled minutes', () => {
    const itinerary = makeRailTrip();
    expect(legsTotalMinutes(itinerary.legs)).toBe(4 + 20 + 4);
  });
});
