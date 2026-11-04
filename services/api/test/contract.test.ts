import { describe, expect, it } from 'vitest';
import type { ItineraryDto, LegDto, LegMode, PlanResponse } from '@biyahey/shared';
import { assertKnownSources, loadProvenance, provenanceFor } from '@biyahey/shared/provenance';

/**
 * Task 5 (PH-wide coverage): the additive contract fields the BFF/PWA will use
 * for the walk fallback, tricycle legs and unpublished-fare gaps, plus the
 * derived `walk-estimate` provenance row.
 *
 * These are shape/type tests only. The behaviour that populates the fields is
 * Task 6 (walk fallback) and Task 9 (tricycle legs, fare gaps, terminal hints);
 * this suite proves the shared vocabulary and the registry row they consume.
 */

const TRICYCLE: LegMode = 'tricycle';

function walkLeg(overrides: Partial<LegDto> = {}): LegDto {
  return {
    mode: 'walk',
    from: { name: 'Origin', lat: 14.676, lon: 121.0437 },
    to: { name: 'Cubao Tricycle Terminal', lat: 14.681, lon: 121.0507 },
    startTime: '2026-11-04T08:00:00+08:00',
    endTime: '2026-11-04T08:10:00+08:00',
    durationMin: 10,
    landmarkHint: null,
    distanceM: 780,
    sourceIds: ['walk-estimate'],
    ...overrides,
  };
}

describe('provenance registry: the derived walk-estimate row', () => {
  const registry = loadProvenance();

  it('registers walk-estimate and accepts it through assertKnownSources', () => {
    expect(registry.has('walk-estimate')).toBe(true);
    expect(assertKnownSources(['walk-estimate'], registry)).toEqual(['walk-estimate']);
    // Canonical registry order still wins over the order a caller passes ids in.
    expect(assertKnownSources(['walk-estimate', 'osm'], registry)).toEqual([
      'osm',
      'walk-estimate',
    ]);
  });

  it('describes a BiyaHey!-computed walking estimate rather than a dataset', () => {
    const row = registry.get('walk-estimate')!;

    expect(row.kind).toBe('derived');
    expect(row.attribution).toContain('BiyaHey!');
    expect(row.attribution).toMatch(/haversine/i);
    expect(row.attribution).toMatch(/4\.5\s*km\/h/);
    expect(row.method ?? '').toMatch(/haversine/i);
    expect(row.method ?? '').toMatch(/4\.5\s*km\/h/);
    expect(row.method ?? '').toMatch(/straight-line/i);
    // No dataset licence is claimed and no fake licence URL is invented: the
    // schema's derived branch requires SPDX's explicit "no licence asserted".
    expect(row.licence_spdx).toBe('NOASSERTION');
    expect(row.licence_url).toBeUndefined();
    // The registry already uses "—" as its no-URL sentinel (crowd-reports).
    expect(row.url).toBe('—');
    expect(row.used_for).toEqual(['walk fallback distance and duration estimates']);
  });
});

describe('shared DTO additions', () => {
  it('round-trips a labelled walk fallback without losing its additive fields', () => {
    const fallback: ItineraryDto = {
      id: 'walk-fallback-1',
      durationMin: 62,
      startTime: '2026-11-04T08:00:00+08:00',
      endTime: '2026-11-04T09:02:00+08:00',
      transfers: 0,
      walkDistanceM: 4650,
      modes: ['walk'],
      fare: {
        amount: 0,
        currency: 'PHP',
        confidence: 'estimated',
        effective_from: '2026-11-04',
        source_id: null,
        breakdown: [],
      },
      sources: ['walk-estimate'],
      fallback: 'walk',
      legs: [
        walkLeg({
          approximate: true,
          tricycleHint: { terminalName: 'Cubao Tricycle Terminal', distanceM: 120 },
          sourceIds: ['walk-estimate'],
        }),
      ],
    };

    const roundTripped = JSON.parse(JSON.stringify(fallback)) as ItineraryDto;

    expect(roundTripped).toEqual(fallback);
    expect(roundTripped.fallback).toBe('walk');
    expect(roundTripped.legs[0]?.approximate).toBe(true);
    expect(roundTripped.legs[0]?.tricycleHint).toEqual({
      terminalName: 'Cubao Tricycle Terminal',
      distanceM: 120,
    });

    // The wire version does not move: the new fields ride an unchanged `v: 1`
    // response, and the derived row is served as the registry wrote it — no
    // invented licence URL.
    const response: PlanResponse = {
      v: 1,
      itineraries: [fallback],
      sources: provenanceFor(['walk-estimate']),
    };
    const wire = JSON.parse(JSON.stringify(response)) as PlanResponse;

    expect(wire.v).toBe(1);
    expect(wire.sources.map((source) => source.id)).toEqual(['walk-estimate']);
    expect(wire.sources[0]?.kind).toBe('derived');
    expect('licence_url' in (wire.sources[0] ?? {})).toBe(false);
  });

  it('round-trips a tricycle leg whose fare has no published source', () => {
    const itinerary: ItineraryDto = {
      id: 'tricycle-1',
      durationMin: 24,
      startTime: '2026-11-04T08:00:00+08:00',
      endTime: '2026-11-04T08:24:00+08:00',
      transfers: 1,
      walkDistanceM: 320,
      modes: ['walk', TRICYCLE],
      fare: {
        amount: 15,
        currency: 'PHP',
        confidence: 'official',
        effective_from: '2026-09-28',
        source_id: 'ltfrb-fares',
        breakdown: [{ label: 'Jeepney', amount: 15 }],
      },
      sources: ['ltfrb-fares', 'walk-estimate'],
      fareIncomplete: true,
      legs: [
        walkLeg(),
        {
          mode: TRICYCLE,
          from: { name: 'Cubao Tricycle Terminal', lat: 14.681, lon: 121.0507 },
          to: { name: 'Aurora Blvd', lat: 14.688, lon: 121.0561 },
          startTime: '2026-11-04T08:10:00+08:00',
          endTime: '2026-11-04T08:24:00+08:00',
          durationMin: 14,
          landmarkHint: null,
          distanceM: 1650,
          sourceIds: ['walk-estimate'],
          fareNotPublished: true,
        },
      ],
    };

    const roundTripped = JSON.parse(JSON.stringify(itinerary)) as ItineraryDto;

    expect(roundTripped).toEqual(itinerary);
    expect(roundTripped.fareIncomplete).toBe(true);
    expect(roundTripped.legs[1]?.mode).toBe('tricycle');
    expect(roundTripped.legs[1]?.fareNotPublished).toBe(true);
  });

  it('keeps the new fields absent on a payload that does not use them', () => {
    const plain: ItineraryDto = {
      id: 'plain-1',
      durationMin: 10,
      startTime: '2026-11-04T08:00:00+08:00',
      endTime: '2026-11-04T08:10:00+08:00',
      transfers: 0,
      walkDistanceM: 780,
      modes: ['walk'],
      fare: {
        amount: 0,
        currency: 'PHP',
        confidence: 'official',
        effective_from: '2026-09-28',
        source_id: null,
        breakdown: [],
      },
      sources: ['osm'],
      legs: [walkLeg({ sourceIds: ['osm'] })],
    };

    const roundTripped = JSON.parse(JSON.stringify(plain)) as ItineraryDto;

    expect(roundTripped).toEqual(plain);
    expect('fallback' in roundTripped).toBe(false);
    expect('fareIncomplete' in roundTripped).toBe(false);
    expect('approximate' in (roundTripped.legs[0] ?? {})).toBe(false);
    expect('fareNotPublished' in (roundTripped.legs[0] ?? {})).toBe(false);
    expect('tricycleHint' in (roundTripped.legs[0] ?? {})).toBe(false);
  });
});
