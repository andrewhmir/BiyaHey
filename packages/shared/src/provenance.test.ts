import { describe, expect, it } from 'vitest';
import {
  assertKnownSources,
  attributionFor,
  loadProvenance,
  provenanceFor,
  UnknownSourceError,
} from './provenance.js';

describe('provenance', () => {
  it('loads exactly the 10 registered sources', () => {
    expect([...loadProvenance().keys()]).toHaveLength(10);
  });
  it('uses the OSM attribution string fixed by the spec', () => {
    expect(loadProvenance().get('osm')!.attribution)
      .toBe('© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0');
  });
  it('dedupes and orders attribution', () => {
    expect(attributionFor(['ltfrb-fares', 'osm', 'osm'])).toBe(
      '© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0 · Fares per LTFRB fare matrix effective 28 September 2026');
  });
  it('rejects unknown source ids', () => {
    expect(() => attributionFor(['made-up' as never])).toThrow(UnknownSourceError);
  });
  it('returns provenance entries in registry order without duplicates', () => {
    expect(provenanceFor(['ltfrb-fares', 'osm', 'osm']).map((source) => source.id))
      .toEqual(['osm', 'ltfrb-fares']);
  });
  it('validates ids and returns them in registry order', () => {
    expect(assertKnownSources(['crowd-reports', 'osm', 'osm'])).toEqual(['osm', 'crowd-reports']);
    expect(() => assertKnownSources(['made-up'])).toThrow(UnknownSourceError);
  });
});
