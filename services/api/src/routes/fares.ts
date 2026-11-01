import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FARE_MODES, quoteFareForLeg } from '@biyahey/shared';
import type { FareMode } from '@biyahey/shared';
import { InvalidBodyError, InvalidModeError } from '../errors.js';

/** Distance/route fares must be real, non-negative money or kilometre values. */
const finiteNonNegative = z
  .number()
  .refine(Number.isFinite, { message: 'must be a finite number' })
  .refine((value) => value >= 0, { message: 'must be non-negative' });

const quoteBodySchema = z
  .object({
    mode: z.string().min(1),
    distanceKm: finiteNonNegative,
    routeFare: finiteNonNegative.optional(),
    freeRideOverride: z.boolean().optional(),
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

/**
 * `POST /fares/quote` — price one leg with the shared 2026 fare engine.
 *
 * Unknown modes are rejected with `INVALID_MODE` before the engine is called,
 * so `toString` and friends cannot reach the fare table.
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
    return quoteFareForLeg({
      mode: body.mode as FareMode,
      distanceKm: body.distanceKm,
      routeFare: body.routeFare,
      freeRideOverride: body.freeRideOverride,
    });
  });
}
