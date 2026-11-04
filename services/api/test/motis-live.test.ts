import { describe, expect, it } from 'vitest';
import type { PlanResponse, SearchResponse } from '@biyahey/shared';
import { buildApp } from '../src/app.js';

/**
 * Live integration test. Tagged `integration`, so `npm test` / `npm run ci`
 * filter it out (see `vitest.config.ts`) and no ambient MOTIS_URL can make CI
 * depend on a running router. It is additionally skipped unless MOTIS_URL is
 * set; run it deliberately against the compose service with:
 *
 *   $env:MOTIS_URL = 'http://localhost:8080'
 *   npm run test:integration
 */
const motisUrl = process.env.MOTIS_URL;

/**
 * The live probe must depart inside MOTIS's loaded timetable window (the
 * service config starts at `first_day: TODAY`). A computed "next 08:00
 * Asia/Manila" keeps this test meaningful on any day; a pinned date eventually
 * falls outside the window and fails for an unrelated reason.
 */
function nextMorningDeparture(): string {
  const offsetMs = 8 * 3_600_000;
  const nowPht = Date.now() + offsetMs;
  const dayStartPht = Math.floor(nowPht / 86_400_000) * 86_400_000;
  let targetPht = dayStartPht + 8 * 3_600_000;
  if (targetPht <= nowPht) {
    targetPht += 86_400_000;
  }
  return new Date(targetPht - offsetMs).toISOString();
}

describe.skipIf(motisUrl === undefined)(
  'live MOTIS integration',
  { tags: ['integration'] },
  () => {
    it('plans Cubao -> Ayala from the real router', async () => {
      const app = buildApp();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/plan',
          payload: {
            origin: { lat: 14.619, lon: 121.053 },
            destination: { lat: 14.554, lon: 121.024 },
            departAt: nextMorningDeparture(),
          },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as PlanResponse;
        console.log(
          `live /plan: ${body.itineraries.length} itineraries, sources=${body.sources
            .map((source) => source.id)
            .join(',')}`,
        );
        expect(body.v).toBe(1);
        expect(body.itineraries.length).toBeGreaterThan(0);
        for (const itinerary of body.itineraries) {
          expect(itinerary.sources.length).toBeGreaterThan(0);
          expect(itinerary.fare.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(
          body.itineraries.some((itinerary) =>
            itinerary.legs.some((leg) => leg.mode !== 'walk'),
          ),
        ).toBe(true);
      } finally {
        await app.close();
      }
    });

    it('searches Cubao against the real router', async () => {
      const app = buildApp();
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/search?q=Cubao',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as SearchResponse;
        console.log(`live /search: ${body.groups.stops.length} stops for Cubao`);
        expect(body.partial).toBe(false);
        expect(body.groups.stops.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    });
  },
);
