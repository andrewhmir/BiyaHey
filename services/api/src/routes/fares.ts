import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FARE_MATRIX_EFFECTIVE_FROM,
  FARE_MODES,
  FARE_STALE_AFTER_DAYS,
  isFareStale,
  quoteFareForLeg,
} from '@biyahey/shared';
import type { FareMode, FareQuoteResponse, FareStatusDto } from '@biyahey/shared';
import { InvalidBodyError, InvalidModeError } from '../errors.js';
import { REGISTRY_CACHE_CONTROL, ifNoneMatchHits, weakEtag } from './sources.js';

/** Distance/route fares must be real, non-negative money or kilometre values. */
const finiteNonNegative = z
  .number()
  .refine(Number.isFinite, { message: 'must be a finite number' })
  .refine((value) => value >= 0, { message: 'must be non-negative' });

/** `YYYY-MM-DD`; the engine does the real calendar validation. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'must be an ISO date (YYYY-MM-DD)',
});

const quoteBodySchema = z
  .object({
    mode: z.string().min(1),
    distanceKm: finiteNonNegative,
    routeFare: finiteNonNegative.optional(),
    freeRideOverride: z.boolean().optional(),
    /**
     * Test/CI hook for the staleness check: check `effective_from` against this
     * date instead of the server clock. The echoed `stale` flag is computed by
     * the same `isFareStale` rule the CI script uses.
     */
    today: isoDate.optional(),
  })
  .superRefine((body, ctx) => {
    // P2P is priced from the operator's route fare; reject it here as a client
    // error instead of letting the engine's RangeError become a 500. A free
    // ride short-circuits before route-fare validation in the engine, so it
    // legitimately has no route fare (see quoteFareForLeg).
    if (body.mode === 'p2p' && body.routeFare === undefined && body.freeRideOverride !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['routeFare'],
        message: 'p2p quotes require routeFare',
      });
    }
  });

function parseToday(value: string | undefined): Date {
  if (value === undefined) {
    return new Date();
  }
  const date = new Date(`${value}T00:00:00Z`);
  // `2026-02-30` parses by rolling over to March; reject a non-round-trip date
  // rather than checking the matrix against a day the caller did not ask about.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidBodyError(`today is not a real calendar date: "${value}"`);
  }
  return date;
}

/**
 * Evaluate the 183-day staleness rule, mapping the engine's RangeError (an
 * impossible date such as `2026-02-30`) to the API's 400 contract.
 */
function staleFor(effectiveFrom: string, today: Date): boolean {
  try {
    return isFareStale(effectiveFrom, today);
  } catch (error) {
    throw new InvalidBodyError(
      error instanceof Error ? error.message : 'invalid fare staleness input',
    );
  }
}

/** How many distinct `checked_on:stale` bodies to keep (one per day of traffic). */
const STATUS_BODIES_LIMIT = 8;

/**
 * Serialized `/fares/status` bodies keyed by `checked_on:stale`.
 *
 * The body only changes when the calendar date (or a test's `today=`) crosses
 * a staleness boundary, so the JSON and its validator are computed once per
 * outcome instead of per request. Bounded so repeated `today=` probes cannot
 * grow the map without limit.
 */
const statusBodies = new Map<string, { payload: string; etag: string }>();

/**
 * Build (or reuse) the byte-identical JSON body and weak validator for one
 * fare-matrix status outcome.
 */
function statusBody(checkedOn: string, stale: boolean): { payload: string; etag: string } {
  const key = `${checkedOn}:${String(stale)}`;
  const cached = statusBodies.get(key);
  if (cached !== undefined) return cached;
  const dto: FareStatusDto = {
    effective_from: FARE_MATRIX_EFFECTIVE_FROM,
    stale,
    stale_after_days: FARE_STALE_AFTER_DAYS,
    checked_on: checkedOn,
  };
  const payload = JSON.stringify(dto);
  const entry = { payload, etag: weakEtag(payload) };
  if (statusBodies.size >= STATUS_BODIES_LIMIT) {
    const oldest = statusBodies.keys().next().value;
    if (oldest !== undefined) statusBodies.delete(oldest);
  }
  statusBodies.set(key, entry);
  return entry;
}

/**
 * `POST /fares/quote` — price one leg with the shared 2026 fare engine.
 *
 * Unknown modes are rejected with `INVALID_MODE` before the engine is called,
 * so `toString` and friends cannot reach the fare table. The response adds
 * `stale` (spec §8.3's >6-month rule) so the client never shows an old fare as
 * current; `today` exists so the check is deterministic in tests.
 */
export function registerFaresRoutes(app: FastifyInstance): void {
  app.post('/fares/quote', async (request) => {
    const parsed = quoteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new InvalidBodyError(`Invalid request body: ${detail}`);
    }
    const body = parsed.data;
    if (!FARE_MODES.includes(body.mode as FareMode)) {
      throw new InvalidModeError(`Unknown fare mode: ${body.mode}`);
    }
    const quote = quoteFareForLeg({
      mode: body.mode as FareMode,
      distanceKm: body.distanceKm,
      routeFare: body.routeFare,
      freeRideOverride: body.freeRideOverride,
    });
    const today = parseToday(body.today);
    const response: FareQuoteResponse = {
      ...quote,
      stale: staleFor(quote.effective_from, today),
    };
    return response;
  });

  /**
   * `GET /fares/status` — the fare matrix's effectivity and staleness.
   *
   * The About-data/fare footer can flag an old matrix without loading the YAML
   * or reimplementing the date rule. `today` is accepted for deterministic CI
   * and tests; it is optional in normal use.
   *
   * Deploy-static payload: ETag + a short public max-age let a repeat visit
   * revalidate to a bodyless 304 while the client keeps painting the last
   * status it saw (see lib/api.ts).
   */
  app.get('/fares/status', async (request, reply) => {
    const query = request.query as Record<string, unknown> | undefined;
    const rawToday = query?.today;
    if (rawToday !== undefined && typeof rawToday !== 'string') {
      throw new InvalidBodyError('Invalid query parameter today: expected YYYY-MM-DD');
    }
    if (rawToday !== undefined) {
      const parsed = isoDate.safeParse(rawToday);
      if (!parsed.success) {
        throw new InvalidBodyError('Invalid query parameter today: expected YYYY-MM-DD');
      }
    }
    const today = parseToday(rawToday);
    const stale = staleFor(FARE_MATRIX_EFFECTIVE_FROM, today);
    const checkedOn = Number.isNaN(today.getTime())
      ? ''
      : today.toISOString().slice(0, 10);
    const { payload, etag } = statusBody(checkedOn, stale);
    reply.header('cache-control', REGISTRY_CACHE_CONTROL);
    reply.header('etag', etag);
    if (ifNoneMatchHits(request.headers['if-none-match'], etag)) {
      reply.code(304);
      return;
    }
    reply.type('application/json; charset=utf-8');
    return payload;
  });
}
