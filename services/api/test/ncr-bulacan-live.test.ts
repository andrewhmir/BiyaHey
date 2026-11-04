import { describe, expect, it } from 'vitest';
import type { PlanResponse } from '@biyahey/shared';
import { buildApp } from '../src/app.js';
import { FALLBACK_HEADER, IMPLAUSIBLE_DROPPED_HEADER } from '../src/routes/plan.js';

/**
 * Task 6B acceptance marker: NCR -> Bulacan (Lane A feed handoff).
 *
 * `it.fails` is deliberate. On the NCR feed built 2026-11-03 (sha256 pinned in
 * `data/build/gtfs/manifest.json`) every raw MOTIS itinerary for
 * Cubao -> Meycauayan carries at least one corrupt transit leg, so the
 * plausibility guard drops all of them and `/plan` serves only the synthesised
 * walk fallback:
 *
 *   itineraries=1 (walk, 288 min), x-biyahey-implausible-dropped=22,
 *   x-biyahey-motis-calls=4, x-biyahey-fallback=walk
 *
 * Two feed defects account for it (evidence: `ncr-bulacan-feed-defect.test.ts`
 * and the Task 6B report):
 *  1. `rail-1:shape:0` starts 3,016 m before its first stop, so MOTIS's leg
 *     geometry prepends the jump: 8,553 m in 180 s = 171 km/h. Eight unique
 *     itineraries are blocked by this alone.
 *  2. Routes with only two synthesized landmark stops (`jeep-101`, `jeep-t165`,
 *     `uv-m01`, `bus-victoryliner`, `bus-pitxmtng`, `bus-cubaobalayan`, ...) get
 *     one fixed 2-minute segment (`SEGMENT_MINUTES` in `pipeline/gtfs.py`), so
 *     the whole route is scheduled in two minutes.
 *
 * When Lane A rebuilds the feed, this test starts passing -- Vitest then
 * reports `it.fails` as a failure ("expected test to fail, but it passed").
 * Delete `.fails` at that point and keep the assertions as the acceptance row.
 * Tagged `integration`, so `npm test` / `npm run ci` never require MOTIS.
 */
const motisUrl = process.env.MOTIS_URL;

describe.skipIf(motisUrl === undefined)(
  'NCR -> Bulacan acceptance marker (Task 6B)',
  { tags: ['integration'] },
  () => {
    it.fails(
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
