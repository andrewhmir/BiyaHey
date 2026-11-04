import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ItineraryDto, PlanResponse } from '@biyahey/shared';
import { resolveDataDir } from '@biyahey/shared/provenance';
import { buildApp } from '../src/app.js';
import { isPlausibleItinerary } from '../src/routing/map-itinerary.js';
import {
  FALLBACK_HEADER,
  IMPLAUSIBLE_DROPPED_HEADER,
  MAX_ITINERARIES,
  MOTIS_CALLS_HEADER,
  UNSUPPORTED_DROPPED_HEADER,
} from '../src/routes/plan.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface FixtureLeg {
  mode: string;
  routeId?: string;
  routeShortName?: string;
  displayName?: string;
  from: { name: string; lat: number; lon: number; stopId?: string };
  to: { name: string; lat: number; lon: number; stopId?: string };
  [key: string]: unknown;
}

interface FixtureItinerary {
  startTime: string;
  endTime: string;
  duration: number;
  transfers?: number;
  legs: FixtureLeg[];
}

interface FixturePlan {
  itineraries: FixtureItinerary[];
  direct?: FixtureItinerary[];
}

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

const planFixture = loadFixture<FixturePlan>('motis-plan-cubao-ayala.json');
const walkOnlyFixture = loadFixture<FixturePlan>('motis-plan-walk-only.json');

const CUBAO = { lat: 14.619, lon: 121.053 };
const AYALA = { lat: 14.554, lon: 121.024 };
const DEPART_AT = '2026-11-02T08:00:00+08:00';

// Real pinned-feed stop ids (the form MOTIS `via` accepts); coordinates are the
// displayable pins the request contract keeps alongside them.
const STOP_A = { lat: 14.5995, lon: 121.0321, stopId: 'gtfs_rail-3:node:5397307750' };
const STOP_B = { lat: 14.5874, lon: 121.0369, stopId: 'gtfs_rail-1:node:4475471873' };

function planApp(fixture: unknown = planFixture) {
  return buildApp({ motisFetch: async () => fixture });
}

/**
 * Build an app whose MOTIS transport answers every call with `fixture` and
 * records each requested URL, so a test can assert the exact `via` list the
 * fan-out forwarded on every attempt.
 */
function capturingPlanApp(fixture: unknown = planFixture): {
  app: ReturnType<typeof buildApp>;
  urls: string[];
} {
  const urls: string[] = [];
  const app = buildApp({
    motisFetch: async (url) => {
      urls.push(url);
      return fixture;
    },
  });
  return { app, urls };
}

/** Parse the `/plan` URLs a capturing app recorded, in call order. */
function planCalls(urls: readonly string[]): URL[] {
  return urls.filter((url) => url.includes('/api/v6/plan')).map((url) => new URL(url));
}

async function postPlan(
  app: ReturnType<typeof buildApp>,
  payload: Record<string, unknown>,
): Promise<{
  statusCode: number;
  body: PlanResponse & { error?: { code: string; message: string } };
  headers: Record<string, unknown>;
}> {
  const res = await app.inject({ method: 'POST', url: '/plan', payload });
  return {
    statusCode: res.statusCode,
    body: res.json() as PlanResponse & { error?: { code: string; message: string } },
    headers: res.headers,
  };
}

/** Write an isolated provenance registry with one row per id. */
function writeRegistry(dataDir: string, ids: string[]): void {
  mkdirSync(join(dataDir, 'provenance'), { recursive: true });
  writeFileSync(
    join(dataDir, 'provenance', 'sources.yaml'),
    [
      'sources:',
      ...ids.flatMap((id) => [
        `  - id: "${id}"`,
        `    attribution: "Test attribution for ${id}"`,
      ]),
      '',
    ].join('\n'),
  );
}

describe('POST /plan', () => {
  it('maps MOTIS itineraries and attaches fares and sources', async () => {
    const app = planApp();
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(body.v).toBe(1);
    expect(body.itineraries.length).toBeGreaterThan(0);

    const mrt = body.itineraries
      .flatMap((itinerary) => itinerary.legs)
      .find((leg) => leg.mode === 'mrt3');
    expect(mrt).toBeDefined();
    expect(mrt?.signage).toBe('Look for: 3');
    expect(mrt?.distanceM).toBeGreaterThan(8000);
    expect(mrt?.sourceIds).toEqual(expect.arrayContaining(['osm', 'rail-fares']));

    const mrtItinerary = body.itineraries.find((itinerary) =>
      itinerary.legs.some((leg) => leg.mode === 'mrt3'),
    );
    expect(mrtItinerary?.fare.effective_from).toBe('2026-03-23');
    // 9.26 km on MRT-3: ₱21 published band, 50% discount → ₱10.50.
    expect(mrtItinerary?.fare.amount).toBe(10.5);
    expect(mrtItinerary?.fare.source_id).toBe('rail-fares');
    expect(mrtItinerary?.sources).toEqual(expect.arrayContaining(['osm', 'rail-fares']));
    expect(mrtItinerary?.walkDistanceM).toBe(484 + 913);
    expect(mrtItinerary?.modes).toContain('walk');
    expect(mrtItinerary?.modes).toContain('mrt3');

    // `sources` is the provenance registry, not MOTIS software ids.
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources.map((source) => source.id)).not.toContain('motis');
    expect(body.sources.every((source) => source.attribution.length > 0)).toBe(true);
  });

  it('keeps a walk-only trip with zero fare and a null source', async () => {
    const app = planApp(walkOnlyFixture);
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: { lat: 14.618, lon: 121.054 },
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    const walkOnly = body.itineraries[0];
    expect(walkOnly.fare.amount).toBe(0);
    expect(walkOnly.fare.source_id).toBeNull();
    expect(walkOnly.fare.effective_from).toBe('2026-09-28');
    expect(walkOnly.fare.confidence).toBe('official');
    expect(walkOnly.fare.breakdown).toEqual([]);
    expect(walkOnly.sources).toEqual(['osm']);
    expect(walkOnly.legs).toHaveLength(1);
    expect(walkOnly.legs[0].mode).toBe('walk');
    expect(walkOnly.legs[0].sourceIds).toEqual(['osm']);
  });

  it('sorts cheapest first when the preference is set', async () => {
    const app = planApp();
    const { body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      preferences: { cheapest: true },
    });

    const amounts = body.itineraries.map((itinerary) => itinerary.fare.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it('re-ranks by fewest transfers and honours maxTransfers', async () => {
    const app = planApp();
    const { body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      preferences: { fewestTransfers: true, maxTransfers: 1 },
    });

    const transfers = body.itineraries.map((itinerary) => itinerary.transfers);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((count) => count <= 1)).toBe(true);
    expect(transfers).toEqual([...transfers].sort((a, b) => a - b));
  });

  it('adds bufferMin to every transfer walk leg', async () => {
    // A synthetic two-transit itinerary: MRT-3 -> walk transfer -> bus. The
    // real fixture's transfers are the through-bus options the plausibility
    // guard now drops, so the buffer path needs a plausible transfer.
    const synthetic = structuredClone(planFixture.itineraries[0]);
    const mrt = synthetic.legs[1];
    const originalWalk = synthetic.legs[2];
    const transferWalk = { ...structuredClone(originalWalk), duration: 180, distance: 200 };
    const bus = {
      ...structuredClone(originalWalk),
      mode: 'BUS',
      routeId: 'gtfs_bus-999',
      routeShortName: '999',
      displayName: '999',
      duration: 900,
      distance: 5_000,
    };
    synthetic.legs = [synthetic.legs[0], mrt, transferWalk, bus];
    delete (transferWalk as { legGeometry?: unknown }).legGeometry;
    delete (bus as { legGeometry?: unknown }).legGeometry;

    const app = planApp({ itineraries: [synthetic] });
    const base = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });
    const buffered = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      preferences: { bufferMin: 5 },
    });

    const isTransferWalk = (itinerary: ItineraryDto, index: number): boolean =>
      itinerary.legs[index].mode === 'walk' &&
      itinerary.legs.slice(0, index).some((leg) => leg.mode !== 'walk') &&
      itinerary.legs.slice(index + 1).some((leg) => leg.mode !== 'walk');

    const byId = new Map(buffered.body.itineraries.map((itinerary) => [itinerary.id, itinerary]));
    let checked = 0;
    for (const original of base.body.itineraries) {
      const bufferedItinerary = byId.get(original.id);
      expect(bufferedItinerary).toBeDefined();
      const transferIndexes = original.legs
        .map((_leg, index) => (isTransferWalk(original, index) ? index : -1))
        .filter((index) => index >= 0);
      if (transferIndexes.length === 0) {
        continue;
      }
      checked += 1;
      expect(bufferedItinerary?.durationMin).toBe(
        original.durationMin + 5 * transferIndexes.length,
      );
      for (const index of transferIndexes) {
        expect(bufferedItinerary?.legs[index].durationMin).toBe(
          original.legs[index].durationMin + 5,
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('issues up to three plan calls and dedupes sparse results', async () => {
    // Use the plausible MRT-3 itineraries: the through-bus options in the
    // fixture are the implausible ones the guard now drops.
    const payloads: FixturePlan[] = [
      { itineraries: [planFixture.itineraries[0]] },
      { itineraries: [planFixture.itineraries[3]] },
      { itineraries: [planFixture.itineraries[6]] },
    ];
    const urls: string[] = [];
    const app = buildApp({
      motisFetch: async (url) => {
        urls.push(url);
        return payloads[Math.min(urls.length - 1, payloads.length - 1)];
      },
    });

    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(urls).toHaveLength(3);
    expect(new Set(body.itineraries.map((itinerary) => itinerary.id)).size).toBe(3);
    expect(urls[1]).not.toBe(urls[0]);
    const third = new URL(urls[2]);
    expect(third.searchParams.get('maxTransfers')).toBe('0');
  });

  it('never emits an itinerary without sources or an effective fare date', async () => {
    const app = planApp();
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(body.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of body.itineraries) {
      expect(Array.isArray(itinerary.sources)).toBe(true);
      expect(itinerary.sources.length).toBeGreaterThan(0);
      expect(itinerary.fare.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(itinerary.legs.length).toBeGreaterThan(0);
      for (const leg of itinerary.legs) {
        expect(Array.isArray(leg.sourceIds)).toBe(true);
        expect(leg.sourceIds.length).toBeGreaterThan(0);
        expect(leg.sourceIds).not.toContain('motis');
      }
    }
  });

  it('exposes the MOTIS fan-out and implausible-drop counts as headers', async () => {
    const app = planApp();
    const { statusCode, headers, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    // The base fixture carries 4 MRT-3 itineraries plus 6 provincial through-bus
    // options whose shapes claim 40–70 km in 2–4 minutes (the R10 defect). The
    // 4 plausible options already meet the target, so no extra MOTIS call is
    // made; the 6 impossible ones are dropped and counted.
    expect(headers[MOTIS_CALLS_HEADER]).toBe('1');
    expect(headers[IMPLAUSIBLE_DROPPED_HEADER]).toBe('6');
    expect(body.itineraries).toHaveLength(4);
    expect(body.itineraries.every((itinerary) => isPlausibleItinerary(itinerary))).toBe(true);
    expect(body.itineraries.map((itinerary) => itinerary.fare.amount)).toEqual([
      10.5, 10.5, 10.5, 10.5,
    ]);
  });

  it('never adds a walk fallback when a usable itinerary exists', async () => {
    const { app, urls } = capturingPlanApp();
    const { statusCode, headers, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(4);
    expect(body.itineraries.some((itinerary) => itinerary.fallback === 'walk')).toBe(false);
    expect(headers[FALLBACK_HEADER]).toBeUndefined();
    // The happy path adds no walking-graph request: the fixture already met the
    // three-option target on its first plan call.
    expect(headers[MOTIS_CALLS_HEADER]).toBe('1');
    expect(urls.every((url) => !url.includes('directModes=WALK'))).toBe(true);
  });

  it('drops an implausible itinerary and labels the resulting walk fallback', async () => {
    const app = planApp({ itineraries: [planFixture.itineraries[1]] });
    const { statusCode, headers, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    // Nothing usable survived the guard, so the response is a labelled walking
    // estimate rather than an empty list.
    expect(body.itineraries).toHaveLength(1);
    expect(body.itineraries[0].fallback).toBe('walk');
    expect(body.itineraries[0].legs[0].approximate).toBe(true);
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    expect(headers[IMPLAUSIBLE_DROPPED_HEADER]).toBe('1');
    // Nothing plausible arrived, so the fan-out ran all three attempts and the
    // same bad itinerary was counted once (deduped across attempts); the walk
    // fallback then made one direct-walk request (the fixture has no direct).
    expect(headers[MOTIS_CALLS_HEADER]).toBe('4');
  });

  it('drops an itinerary whose rail line v1 cannot price', async () => {
    const unsupported = structuredClone(planFixture.itineraries[0]);
    const transit = unsupported.legs.find((leg) => leg.mode === 'SUBWAY');
    expect(transit).toBeDefined();
    if (transit !== undefined) {
      transit.routeId = 'gtfs_rail-ss';
    }
    const app = planApp({ itineraries: [unsupported] });
    const { statusCode, headers, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });
    expect(statusCode).toBe(200);
    // The mode gate is observable: one unsupported option was dropped, and the
    // empty result is filled with the labelled walk fallback.
    expect(body.itineraries).toHaveLength(1);
    expect(body.itineraries[0].fallback).toBe('walk');
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    expect(headers[UNSUPPORTED_DROPPED_HEADER]).toBe('1');
  });

  it('drops and counts a non-PRFS ferry instead of pricing it as the free MMDA ferry', async () => {
    const unsupported = structuredClone(planFixture.itineraries[0]);
    const transit = unsupported.legs.find((leg) => leg.mode === 'SUBWAY');
    expect(transit).toBeDefined();
    if (transit !== undefined) {
      transit.mode = 'FERRY';
      transit.routeId = 'gtfs_ferry-manilacoron';
      transit.routeShortName = 'Manila - Coron';
      transit.displayName = 'Manila - Coron';
    }
    const app = planApp({ itineraries: [unsupported] });
    const { statusCode, headers, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });
    expect(statusCode).toBe(200);
    expect(body.itineraries).toHaveLength(1);
    expect(body.itineraries[0].fallback).toBe('walk');
    expect(headers[FALLBACK_HEADER]).toBe('walk');
    expect(headers[UNSUPPORTED_DROPPED_HEADER]).toBe('1');
    // Nothing plausible arrived, so the fan-out ran all three attempts and the
    // same unsupported itinerary was counted once (deduped across attempts),
    // plus the walk fallback's direct-walk request.
    expect(headers[MOTIS_CALLS_HEADER]).toBe('4');
  });

  it('caps a crowded corridor at five ranked itineraries', async () => {
    // The walk-only fixture is a MOTIS `direct` entry, not an itinerary.
    const base = (walkOnlyFixture.direct ?? walkOnlyFixture.itineraries)[0];
    if (base === undefined) {
      throw new Error('walk-only fixture has no entry');
    }
    expect(base).toBeDefined();
    const crowded = Array.from({ length: 7 }, (_, index) => {
      const itinerary = structuredClone(base);
      const start = Date.parse(base.startTime) + index * 60_000;
      const end = Date.parse(base.endTime) + index * 60_000;
      itinerary.startTime = new Date(start).toISOString();
      itinerary.endTime = new Date(end).toISOString();
      return itinerary;
    });

    const app = planApp({ itineraries: crowded });
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: { lat: 14.618, lon: 121.054 },
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(MAX_ITINERARIES).toBe(5);
    expect(body.itineraries).toHaveLength(5);
    // The cap preserves the incoming (ETA) order: the five earliest departures.
    expect(body.itineraries.map((itinerary) => itinerary.startTime)).toEqual(
      crowded.slice(0, 5).map((itinerary) => itinerary.startTime),
    );
  });

  it('marks only walk legs between two transit legs as informal transfers', async () => {
    const start = '2026-11-02T08:00:00Z';
    const legs = [
      { mode: 'WALK', from: { name: 'START', lat: 14.619, lon: 121.053 }, to: { name: 'Stop A', lat: 14.62, lon: 121.054 }, startTime: start, endTime: start, duration: 300, distance: 400 },
      { mode: 'BUS', routeId: 'gtfs_bus-1', routeShortName: '1', from: { name: 'Stop A', lat: 14.62, lon: 121.054 }, to: { name: 'Stop B', lat: 14.63, lon: 121.06 }, startTime: start, endTime: start, duration: 600, distance: 6_000 },
      { mode: 'WALK', from: { name: 'Stop B', lat: 14.63, lon: 121.06 }, to: { name: 'Stop C', lat: 14.631, lon: 121.061 }, startTime: start, endTime: start, duration: 180, distance: 200 },
      { mode: 'BUS', routeId: 'gtfs_bus-2', routeShortName: '2', from: { name: 'Stop C', lat: 14.631, lon: 121.061 }, to: { name: 'END', lat: 14.64, lon: 121.07 }, startTime: start, endTime: start, duration: 500, distance: 5_000 },
    ];
    const app = planApp({ itineraries: [{ duration: 1_580, startTime: start, endTime: start, transfers: 1, legs }] });
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    const itinerary = body.itineraries[0];
    expect(itinerary).toBeDefined();
    expect(itinerary?.legs).toHaveLength(4);
    // Access walk is not a transfer; the middle walk is the informal transfer.
    expect(itinerary?.legs[0]?.informalTransfer).toBeUndefined();
    expect(itinerary?.legs[2]?.informalTransfer).toBe(true);
  });

  it('maps a curated jeepney leg to its landmark and inventory source', async () => {
    const synthetic = structuredClone(planFixture.itineraries[0]);
    const transit = synthetic.legs.find((leg) => leg.mode === 'SUBWAY');
    expect(transit).toBeDefined();
    if (transit !== undefined) {
      transit.mode = 'BUS';
      transit.routeId = 'gtfs_jeep-t101';
      transit.routeShortName = 'T101';
      transit.displayName = 'T101';
      transit.from.name = 'Bagong Silang';
      transit.to.name = 'Novaliches';
    }
    const app = planApp({ itineraries: [synthetic] });
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    const jeep = body.itineraries[0]?.legs.find((leg) => leg.mode === 'jeepney');
    expect(jeep).toBeDefined();
    expect(jeep?.signage).toBe('Look for: T101');
    expect(jeep?.landmarkHint).toBe('Novaliches');
    expect(jeep?.sourceIds).toEqual(
      expect.arrayContaining(['osm', 'osm-wiki-jeepney', 'ltfrb-fares']),
    );
  });

  it('does not claim the wiki inventory for an OSM-derived jeepney route', async () => {
    const synthetic = structuredClone(planFixture.itineraries[0]);
    const transit = synthetic.legs.find((leg) => leg.mode === 'SUBWAY');
    expect(transit).toBeDefined();
    if (transit !== undefined) {
      transit.mode = 'BUS';
      transit.routeId = 'gtfs_jeep-cubaocalumpang';
      transit.routeShortName = 'CUBAOCALUMAPANG';
      transit.displayName = 'CUBAOCALUMAPANG';
    }
    const app = planApp({ itineraries: [synthetic] });
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    const itinerary = body.itineraries[0];
    const jeep = itinerary?.legs.find((leg) => leg.mode === 'jeepney');
    expect(jeep).toBeDefined();
    // Only a route listed in the curated inventory may claim
    // `osm-wiki-jeepney`; this live OSM-relation-derived id is not one of them.
    expect(jeep?.sourceIds).toEqual(['osm', 'ltfrb-fares']);
    expect(itinerary?.sources).toEqual(['osm', 'ltfrb-fares']);
    expect(jeep?.landmarkHint).toBeNull();
  });

  it('validates and serves plan sources from the injected registry', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'biyahey-plan-registry-'));
    try {
      writeRegistry(dataDir, ['osm']);
      const app = buildApp({ dataDir, motisFetch: async () => walkOnlyFixture });

      const sourcesRes = await app.inject({ method: 'GET', url: '/sources' });
      const registryIds = (sourcesRes.json() as Array<{ id: string }>).map((source) => source.id);
      expect(registryIds).toEqual(['osm']);

      const { statusCode, body } = await postPlan(app, {
        origin: CUBAO,
        destination: { lat: 14.618, lon: 121.054 },
        departAt: DEPART_AT,
      });

      expect(statusCode).toBe(200);
      expect(body.itineraries[0]?.sources).toEqual(['osm']);
      // The plan's DataSource rows come from the same registry `/sources`
      // serves, not from the repository's ten-row registry.
      expect(body.sources.map((source) => source.id)).toEqual(registryIds);
      expect(body.sources[0]?.attribution).toBe('Test attribution for osm');
      for (const itinerary of body.itineraries) {
        for (const sourceId of itinerary.sources) {
          expect(registryIds).toContain(sourceId);
        }
      }
      await app.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects an emitted source id absent from the injected registry with 422', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'biyahey-plan-registry-'));
    try {
      // The walk-only itinerary only uses `osm`, which this registry omits.
      writeRegistry(dataDir, ['psgc']);
      const app = buildApp({ dataDir, motisFetch: async () => walkOnlyFixture });

      const { statusCode, body } = await postPlan(app, {
        origin: CUBAO,
        destination: { lat: 14.618, lon: 121.054 },
        departAt: DEPART_AT,
      });

      expect(statusCode).toBe(422);
      expect(body.error?.code).toBe('UNKNOWN_SOURCE');
      expect(body.error?.message).toContain('osm');
      await app.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('prices a listed free-ride route at zero with estimated confidence', async () => {
    const synthetic = structuredClone(planFixture.itineraries[0]);
    const transit = synthetic.legs.find((leg) => leg.mode === 'SUBWAY');
    expect(transit).toBeDefined();
    if (transit !== undefined) {
      transit.mode = 'BUS';
      transit.routeId = 'gtfs_jeep-t101';
      transit.routeShortName = 'T101';
      transit.displayName = 'T101';
    }

    const dataDir = mkdtempSync(join(tmpdir(), 'biyahey-free-ride-'));
    try {
      mkdirSync(join(dataDir, 'provenance'), { recursive: true });
      copyFileSync(
        join(resolveDataDir(), 'provenance', 'sources.yaml'),
        join(dataDir, 'provenance', 'sources.yaml'),
      );
      mkdirSync(join(dataDir, 'fares'), { recursive: true });
      writeFileSync(
        join(dataDir, 'fares', 'free-ride-routes.yaml'),
        [
          'routes:',
          '  - route_id: "jeep-t101"',
          '    source_url: "https://example.gov.ph/free-ride-notice"',
          '    verified_on: "2026-11-01"',
          '',
        ].join('\n'),
      );

      const app = buildApp({
        dataDir,
        motisFetch: async () => ({ itineraries: [synthetic] }),
      });
      const { statusCode, body } = await postPlan(app, {
        origin: CUBAO,
        destination: AYALA,
        departAt: DEPART_AT,
      });

      expect(statusCode).toBe(200);
      const jeepItinerary = body.itineraries.find((itinerary) =>
        itinerary.legs.some((leg) => leg.mode === 'jeepney'),
      );
      expect(jeepItinerary?.fare.amount).toBe(0);
      expect(jeepItinerary?.fare.confidence).toBe('estimated');
      expect(jeepItinerary?.fare.source_id).toBe('ltfrb-fares');
      expect(jeepItinerary?.fare.breakdown[0]?.label).toContain('Free-ride');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('returns 502 ROUTER_UNAVAILABLE when MOTIS cannot be reached, after one retry', async () => {
    let attempts = 0;
    const app = buildApp({
      motisFetch: async () => {
        attempts += 1;
        throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
      },
    });
    const { statusCode, body, headers } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(attempts).toBe(2);
    expect(statusCode).toBe(502);
    expect(body.error?.code).toBe('ROUTER_UNAVAILABLE');
    expect(body.error?.message).toContain('ECONNREFUSED');
    // A failed base plan keeps its 502: the walk fallback never papers over it.
    expect(headers[FALLBACK_HEADER]).toBeUndefined();
  });

  it('returns 502 ROUTER_ERROR with details when MOTIS rejects the request', async () => {
    let attempts = 0;
    const app = buildApp({
      motisFetch: async () => {
        attempts += 1;
        return new Response('fromPlace is invalid', { status: 400 });
      },
    });
    const { statusCode, body, headers } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(attempts).toBe(1);
    expect(statusCode).toBe(502);
    expect(body.error?.code).toBe('ROUTER_ERROR');
    expect(body.error?.message).toContain('400');
    expect(body.error?.message).toContain('fromPlace is invalid');
    expect(headers[FALLBACK_HEADER]).toBeUndefined();
  });

  it('rejects malformed user input with 400, never 500', async () => {
    const app = planApp();
    const invalid: Record<string, unknown>[] = [
      { origin: CUBAO },
      { origin: { lat: 95, lon: 121.053 }, destination: AYALA },
      { origin: CUBAO, destination: { lat: 14.554, lon: 181 } },
      { origin: CUBAO, destination: AYALA, departAt: 'tomorrow morning' },
      { origin: CUBAO, destination: AYALA, preferences: { maxTransfers: -1 } },
      { origin: CUBAO, destination: AYALA, preferences: { bufferMin: 1.5 } },
      { origin: CUBAO, destination: AYALA, preferences: { cheapest: 'yes' } },
    ];
    for (const payload of invalid) {
      const { statusCode, body } = await postPlan(app, payload);
      expect(statusCode, JSON.stringify(payload)).toBe(400);
      expect(body.error?.code, JSON.stringify(payload)).toBe('INVALID_BODY');
    }
  });

  it('forwards two stops as one comma-joined via on every plan attempt', async () => {
    // A single plausible itinerary per response keeps the fan-out below its
    // three-option target, so all three attempts run and each one is checked.
    const { app, urls } = capturingPlanApp({ itineraries: [planFixture.itineraries[0]] });
    const { statusCode } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      stops: [STOP_A, STOP_B],
    });

    expect(statusCode).toBe(200);
    expect(urls).toHaveLength(3);
    const calls = planCalls(urls);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.searchParams.get('via')).toBe(`${STOP_A.stopId},${STOP_B.stopId}`);
    }
  });

  it('forwards a single stop as via', async () => {
    const { app, urls } = capturingPlanApp({ itineraries: [planFixture.itineraries[0]] });
    const { statusCode } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      stops: [STOP_A],
    });

    expect(statusCode).toBe(200);
    const calls = planCalls(urls);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.searchParams.get('via')).toBe(STOP_A.stopId);
    }
  });

  it('adds no via parameter when the request carries no stops', async () => {
    const { app, urls } = capturingPlanApp({ itineraries: [planFixture.itineraries[0]] });
    const { statusCode } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });

    expect(statusCode).toBe(200);
    expect(urls).toHaveLength(3);
    for (const call of planCalls(urls)) {
      expect(call.searchParams.get('via')).toBeNull();
    }
  });

  it('rejects three stops with 400 INVALID_BODY', async () => {
    const app = planApp();
    const { statusCode, body } = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      stops: [STOP_A, STOP_B, { lat: 14.62, lon: 121.0, stopId: 'gtfs_bus-1:node:1' }],
    });

    expect(statusCode).toBe(400);
    expect(body.error?.code).toBe('INVALID_BODY');
  });

  it('rejects malformed stops with 400 INVALID_BODY', async () => {
    const app = planApp();
    const invalid: Record<string, unknown>[] = [
      { origin: CUBAO, destination: AYALA, stops: 'nope' },
      // Missing / empty / whitespace-only stop id.
      { origin: CUBAO, destination: AYALA, stops: [{ lat: 14.6, lon: 121.0 }] },
      { origin: CUBAO, destination: AYALA, stops: [{ lat: 14.6, lon: 121.0, stopId: '' }] },
      { origin: CUBAO, destination: AYALA, stops: [{ lat: 14.6, lon: 121.0, stopId: '   ' }] },
      // Out-of-range stop coordinates.
      { origin: CUBAO, destination: AYALA, stops: [{ lat: 95, lon: 121.0, stopId: 'a' }] },
      { origin: CUBAO, destination: AYALA, stops: [{ lat: 14.6, lon: 181, stopId: 'a' }] },
    ];
    for (const payload of invalid) {
      const { statusCode, body } = await postPlan(app, payload);
      expect(statusCode, JSON.stringify(payload)).toBe(400);
      expect(body.error?.code, JSON.stringify(payload)).toBe('INVALID_BODY');
    }
  });

  it('does not change the mapped itineraries when stops are forwarded', async () => {
    const app = planApp();
    const base = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
    });
    const withStops = await postPlan(app, {
      origin: CUBAO,
      destination: AYALA,
      departAt: DEPART_AT,
      stops: [STOP_A, STOP_B],
    });

    expect(base.statusCode).toBe(200);
    expect(withStops.statusCode).toBe(200);
    expect(withStops.body.itineraries.map((itinerary) => itinerary.id)).toEqual(
      base.body.itineraries.map((itinerary) => itinerary.id),
    );
  });
});
