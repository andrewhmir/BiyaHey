import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnknownSourceError } from '@biyahey/shared/provenance';
import { buildApp } from '../src/app.js';

describe('api', () => {
  it('reports health', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('serves the provenance registry', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/sources' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(10);
    expect(res.json()[0]).toMatchObject({ id: 'osm' });
    await app.close();
  });

  it('quotes a jeepney fare', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'jeepney', distanceKm: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      amount: 26,
      currency: 'PHP',
      source_id: 'ltfrb-fares',
      effective_from: '2026-09-28',
    });
    await app.close();
  });

  it('rejects an unknown mode with 400 INVALID_MODE', async () => {
    const app = buildApp();
    for (const mode of ['hovercraft', 'toString']) {
      const res = await app.inject({
        method: 'POST',
        url: '/fares/quote',
        payload: { mode, distanceKm: 1 },
      });
      expect(res.statusCode, mode).toBe(400);
      expect(res.json(), mode).toEqual({
        error: { code: 'INVALID_MODE', message: `Unknown fare mode: ${mode}` },
      });
    }
    await app.close();
  });

  it('rejects a malformed body with 400 INVALID_BODY', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'jeepney' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_BODY');
    await app.close();
  });

  it('maps an unknown source id to 422 UNKNOWN_SOURCE', async () => {
    // Task 10's routes will resolve itinerary source ids; assert the
    // centralized mapping now with a probe route so it cannot silently regress.
    const app = buildApp();
    app.get('/probe-sources', async () => {
      throw new UnknownSourceError('Unknown source id(s): nope');
    });
    const res = await app.inject({ method: 'GET', url: '/probe-sources' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: 'UNKNOWN_SOURCE', message: 'Unknown source id(s): nope' },
    });
    await app.close();
  });

  it('loads the registry from an injected data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'biyahey-api-'));
    try {
      mkdirSync(join(dataDir, 'provenance'), { recursive: true });
      writeFileSync(
        join(dataDir, 'provenance', 'sources.yaml'),
        ['sources:', '  - id: "osm"', '    attribution: "Test attribution"', ''].join('\n'),
      );
      const app = buildApp({ dataDir });
      const res = await app.inject({ method: 'GET', url: '/sources' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0]).toMatchObject({ id: 'osm', attribution: 'Test attribution' });
      await app.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
