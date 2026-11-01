import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '@biyahey/shared';
import { buildApp } from '../src/app.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

const cubaoFixture = loadFixture<unknown>('motis-geocode-cubao.json');
const quezonCityFixture = loadFixture<unknown>('motis-geocode-quezon-city.json');

async function search(
  app: ReturnType<typeof buildApp>,
  query: string,
): Promise<{ statusCode: number; body: SearchResponse }> {
  const res = await app.inject({
    method: 'GET',
    url: `/search?q=${encodeURIComponent(query)}`,
  });
  return { statusCode: res.statusCode, body: res.json() as SearchResponse };
}

describe('GET /search', () => {
  it('maps MOTIS STOP results into the stops group with OSM provenance', async () => {
    const app = buildApp({ motisFetch: async () => cubaoFixture });
    const { statusCode, body } = await search(app, 'Cubao');

    expect(statusCode).toBe(200);
    expect(body.partial).toBe(false);
    // The live Cubao result mixes four GTFS stops with six OSM places.
    expect(body.groups.stops).toHaveLength(4);
    expect(body.groups.landmarks).toHaveLength(6);
    expect(body.groups.routes).toEqual([]);
    expect(body.groups.saved).toEqual([]);

    const cubao = body.groups.stops[0];
    expect(cubao).toMatchObject({
      name: 'Cubao',
      type: 'stop',
      source_id: 'osm',
      locality: 'Quezon City',
    });
    expect(typeof cubao?.id).toBe('string');
    expect(cubao?.lat).toBeCloseTo(14.6195, 3);
    expect(cubao?.lon).toBeCloseTo(121.051, 3);
    expect(cubao?.label).toContain('Cubao');
  });

  it('maps PLACE results into the landmarks group', async () => {
    const app = buildApp({ motisFetch: async () => quezonCityFixture });
    const { statusCode, body } = await search(app, 'Quezon City');

    expect(statusCode).toBe(200);
    expect(body.partial).toBe(false);
    expect(body.groups.stops).toHaveLength(5);
    expect(body.groups.landmarks).toHaveLength(5);
    expect(body.groups.landmarks[0]).toMatchObject({
      name: 'Quezon City',
      type: 'landmark',
      source_id: 'osm',
    });
    expect(body.groups.landmarks[0]?.locality).toBe('Quezon City');
  });

  it('returns 200 partial with empty groups for an unknown place', async () => {
    const app = buildApp({ motisFetch: async () => [] });
    const { statusCode, body } = await search(app, 'Barangay Walang Ganito 12345');

    expect(statusCode).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.groups).toEqual({ stops: [], landmarks: [], routes: [], saved: [] });
  });

  it('does not call the router for a query shorter than three characters', async () => {
    let calls = 0;
    const app = buildApp({
      motisFetch: async () => {
        calls += 1;
        return cubaoFixture;
      },
    });

    for (const query of ['', 'a', 'ab']) {
      const { statusCode, body } = await search(app, query);
      expect(statusCode).toBe(200);
      expect(body.partial).toBe(true);
      expect(body.groups.stops).toEqual([]);
    }
    expect(calls).toBe(0);
  });

  it('treats a missing q parameter as an empty, partial result', async () => {
    const app = buildApp({ motisFetch: async () => cubaoFixture });
    const res = await app.inject({ method: 'GET', url: '/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ partial: true });
  });

  it('returns 200 partial when MOTIS returns an unexpected payload', async () => {
    const app = buildApp({ motisFetch: async () => ({ unexpected: true }) });
    const { statusCode, body } = await search(app, 'Cubao');
    expect(statusCode).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.groups.stops).toEqual([]);
  });

  it('never 500s when the router is unavailable', async () => {
    const app = buildApp({
      motisFetch: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
      },
    });
    const { statusCode, body } = await search(app, 'Cubao');
    expect(statusCode).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.groups).toEqual({ stops: [], landmarks: [], routes: [], saved: [] });
  });
});
