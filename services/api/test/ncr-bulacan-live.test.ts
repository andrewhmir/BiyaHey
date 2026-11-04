import { describe, expect, it } from 'vitest';
import type { PlanResponse } from '@biyahey/shared';
import { buildApp } from '../src/app.js';
import { FALLBACK_HEADER, IMPLAUSIBLE_DROPPED_HEADER } from '../src/routes/plan.js';

/**
 * Task 6B acceptance marker: NCR -> Bulacan (Lane A feed handoff).
 *
 * This was written as `it.fails` against the 2026-11-03 NCR feed, where every
 * raw MOTIS itinerary for Cubao -> Meycauayan carried at least one corrupt
 * transit leg (a `rail-1` shape whose 3,016 m pre-spur made an 8,553 m / 180 s
 * leg, and two-stop landmark routes scheduled in a fixed 2 minutes), so the
 * plausibility guard dropped all of them and `/plan` served only the
 * synthesised walk fallback (dropped=22, fallback=walk).
 *
 * The 2026-11-05 feed rebuild fixed both defects (shape trimmed to the served
 * stops; distance-derived segment times) and the same request now returns real
 * transit itineraries with `x-biyahey-implausible-dropped: 0` and no fallback
 * header (measured 2026-11-05 02:32 on the national graph: 5 itineraries,
 * first `walk > bus > lrt1`, 83 min). The `.fails` was removed at that point and
 * the assertions below are the acceptance row.
 *
 * Tagged `integration`, so `npm test` / `npm run ci` never require MOTIS.
 */
const motisUrl = process.env.MOTIS_URL;

describe.skipIf(motisUrl === undefined)(
  'NCR -> Bulacan acceptance marker (Task 6B)',
  { tags: ['integration'] },
  () => {
    it(
      'serves a transit itinerary Cubao -> Meycauayan and drops none (Lane A feed fix)',
      async () => {
        const app = buildApp();
        try {
          const res = await app.inject({
            method: 'POST',
            url: '/plan',
            payload: {
              origin: { lat: 14.6194, lon: 121.0531 },
              destination: { lat: 14.736, lon: 120.96 },
              departAt: '2026-11-05T00:00:00Z',
            },
          });
          expect(res.statusCode).toBe(200);
          const body = res.json() as PlanResponse;
          const transit = body.itineraries.filter((itinerary) =>
            itinerary.legs.some((leg) => leg.mode !== 'walk'),
          );
          console.log(
            `NCR->Bulacan marker: itineraries=${body.itineraries.length} transit=${transit.length} ` +
              `implausible=${String(res.headers[IMPLAUSIBLE_DROPPED_HEADER])} ` +
              `fallback=${String(res.headers[FALLBACK_HEADER])}`,
          );
          expect(res.headers[IMPLAUSIBLE_DROPPED_HEADER]).toBe('0');
          expect(res.headers[FALLBACK_HEADER]).toBeUndefined();
          expect(transit.length).toBeGreaterThan(0);
        } finally {
          await app.close();
        }
      },
      120_000,
    );
  },
);
