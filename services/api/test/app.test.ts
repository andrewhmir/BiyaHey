import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnknownSourceError } from '@biyahey/shared/provenance';
import { buildApp, corsOriginsFromEnv, DEFAULT_CORS_ORIGINS } from '../src/app.js';

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

  it('quotes a p2p fare from the operator route fare', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'p2p', distanceKm: 12, routeFare: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      amount: 115,
      currency: 'PHP',
      source_id: 'ltfrb-fares',
    });
    await app.close();
  });

  it('accepts a p2p free ride without a route fare', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'p2p', distanceKm: 12, freeRideOverride: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      amount: 0,
      currency: 'PHP',
      confidence: 'estimated',
    });
    await app.close();
  });

  it('rejects a p2p quote without a route fare unless it is a free ride', async () => {
    const app = buildApp();
    // Only `freeRideOverride: true` waives the route fare; an absent or false
    // override is still a client error rather than a 500 from the engine.
    for (const freeRideOverride of [undefined, false]) {
      const res = await app.inject({
        method: 'POST',
        url: '/fares/quote',
        payload: { mode: 'p2p', distanceKm: 12, freeRideOverride },
      });
      expect(res.statusCode, String(freeRideOverride)).toBe(400);
      expect(res.json().error.code).toBe('INVALID_BODY');
    }
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

describe('CORS (PWA browser boundary)', () => {
  it('defaults to the Vite dev origins and parses CORS_ORIGINS', () => {
    expect(corsOriginsFromEnv(undefined)).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(corsOriginsFromEnv('  ')).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(corsOriginsFromEnv('https://biyahey.example, http://localhost:4173')).toEqual([
      'https://biyahey.example',
      'http://localhost:4173',
    ]);
  });

  it('answers a preflight from the PWA origin with the CORS headers', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/plan',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    // @fastify/cors answers 204 by default; accept 200 for config robustness.
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'content-type',
    );
    await app.close();
  });

  it('allows the 127.0.0.1 spelling and grants it on a real POST', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { mode: 'jeepney', distanceKm: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    await app.close();
  });

  it('does not grant CORS to an unlisted origin', async () => {
    const app = buildApp();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/plan',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    const post = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      headers: { origin: 'https://evil.example' },
      payload: { mode: 'jeepney', distanceKm: 5 },
    });
    // The request still succeeds server-side (CORS is a browser read barrier),
    // but no ACAO header means the browser must block the response.
    expect(post.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('honours an injected allowlist for tests', async () => {
    const app = buildApp({ corsOrigins: ['https://biyahey.example'] });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/plan',
      headers: {
        origin: 'https://biyahey.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers['access-control-allow-origin']).toBe('https://biyahey.example');
    await app.close();
  });
});

describe('fare staleness', () => {
  it('flags a quote as stale after the 183-day window and fresh inside it', async () => {
    const app = buildApp();
    const fresh = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'jeepney', distanceKm: 10, today: '2026-11-01' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json()).toMatchObject({
      effective_from: '2026-09-28',
      stale: false,
    });

    const stale = await app.inject({
      method: 'POST',
      url: '/fares/quote',
      payload: { mode: 'jeepney', distanceKm: 10, today: '2027-04-01' },
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().stale).toBe(true);
    await app.close();
  });

  it('rejects an impossible today value instead of rolling it over', async () => {
    const app = buildApp();
    for (const today of ['2026-02-30', '2026-13-01', 'yesterday']) {
      const res = await app.inject({
        method: 'POST',
        url: '/fares/quote',
        payload: { mode: 'jeepney', distanceKm: 1, today },
      });
      expect(res.statusCode, today).toBe(400);
      expect(res.json().error.code, today).toBe('INVALID_BODY');
    }
    const status = await app.inject({ method: 'GET', url: '/fares/status?today=2026-02-30' });
    expect(status.statusCode).toBe(400);
    expect(status.json().error.code).toBe('INVALID_BODY');
    await app.close();
  });

  it('serves the matrix status with a stale flag and effective date', async () => {
    const app = buildApp();
    const fresh = await app.inject({ method: 'GET', url: '/fares/status?today=2026-11-01' });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json()).toEqual({
      effective_from: '2026-09-28',
      stale: false,
      stale_after_days: 183,
      checked_on: '2026-11-01',
    });

    const stale = await app.inject({ method: 'GET', url: '/fares/status?today=2027-04-01' });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ stale: true, checked_on: '2027-04-01' });
    await app.close();
  });
});
