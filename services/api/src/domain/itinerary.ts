import { z } from 'zod';
import type { ItineraryDto, PlanPreferences, PlanRequest } from '@biyahey/shared';
import { InvalidBodyError } from '../errors.js';
import { itineraryKey } from '../routing/map-itinerary.js';

const latitude = z
  .number()
  .refine(Number.isFinite, { message: 'must be a finite number' })
  .refine((value) => value >= -90 && value <= 90, { message: 'must be between -90 and 90' });

const longitude = z
  .number()
  .refine(Number.isFinite, { message: 'must be a finite number' })
  .refine((value) => value >= -180 && value <= 180, { message: 'must be between -180 and 180' });

const placeSchema = z.object({ lat: latitude, lon: longitude });

/**
 * One optional intermediate stop (trip-planner R89).
 *
 * The router only routes through stop ids, so a stop carries the served id
 * (the `id` of a `type: 'stop'` search result) next to the coordinates the
 * caller displays. Whitespace is trimmed here so a stray space can never reach
 * the router's comma-joined `via` list as a different stop id.
 */
const stopSchema = placeSchema.extend({ stopId: z.string().trim().min(1) });

const preferencesSchema = z.object({
  cheapest: z.boolean().optional(),
  fewestTransfers: z.boolean().optional(),
  maxTransfers: z.number().int().min(0).max(20).optional(),
  bufferMin: z.number().int().min(0).max(120).optional(),
});

const planRequestSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  // MOTIS accepts at most two `via` stops; a longer list is a client error.
  stops: z.array(stopSchema).max(2).optional(),
  departAt: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'must be an ISO 8601 date-time',
    })
    .optional(),
  preferences: preferencesSchema.optional(),
});

/**
 * Validate a `POST /plan` body.
 *
 * @throws InvalidBodyError with a field-level detail list; the centralized error
 *   handler turns it into 400 INVALID_BODY, never 500.
 */
export function parsePlanRequest(body: unknown): PlanRequest {
  const parsed = planRequestSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new InvalidBodyError(`Invalid request body: ${detail}`);
  }
  return parsed.data;
}

/**
 * Drop duplicate itineraries, keeping the first occurrence.
 *
 * Alternatives requested by the route (departure +10 min, `maxTransfers: 0`)
 * often repeat an itinerary already returned by the base call; dedupe keeps the
 * response stable and the React keys unique.
 */
export function dedupeItineraries(itineraries: readonly ItineraryDto[]): ItineraryDto[] {
  const seen = new Set<string>();
  const unique: ItineraryDto[] = [];
  for (const itinerary of itineraries) {
    const key = itineraryKey(itinerary);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(itinerary);
  }
  return unique;
}

function withBuffer(itinerary: ItineraryDto, bufferMin: number): ItineraryDto {
  if (bufferMin <= 0) {
    return itinerary;
  }
  let added = 0;
  const legs = itinerary.legs.map((leg, index) => {
    if (leg.mode !== 'walk') {
      return leg;
    }
    const before = itinerary.legs.slice(0, index).some((other) => other.mode !== 'walk');
    const after = itinerary.legs.slice(index + 1).some((other) => other.mode !== 'walk');
    if (!before || !after) {
      return leg;
    }
    added += bufferMin;
    return { ...leg, durationMin: leg.durationMin + bufferMin };
  });
  if (added === 0) {
    return itinerary;
  }
  return { ...itinerary, legs, durationMin: itinerary.durationMin + added };
}

/**
 * R33: a `fareIncomplete` itinerary's amount is a partial sum, so it is never
 * ranked as the cheapest fare. Complete itineraries sort first and the partial
 * ones after them; within each group the existing fare/duration order applies.
 */
function completenessRank(itinerary: ItineraryDto): number {
  return itinerary.fareIncomplete === true ? 1 : 0;
}

function byFare(a: ItineraryDto, b: ItineraryDto): number {
  return (
    completenessRank(a) - completenessRank(b) ||
    a.fare.amount - b.fare.amount ||
    a.durationMin - b.durationMin
  );
}

function byTransfers(a: ItineraryDto, b: ItineraryDto): number {
  return a.transfers - b.transfers || a.durationMin - b.durationMin;
}

function byFareThenTransfers(a: ItineraryDto, b: ItineraryDto): number {
  return (
    completenessRank(a) - completenessRank(b) ||
    a.fare.amount - b.fare.amount ||
    a.transfers - b.transfers ||
    a.durationMin - b.durationMin
  );
}

/**
 * Apply the client-selectable ranking and presentation preferences.
 *
 * Filters run before sorting and before the transfer buffer so a buffered walk
 * leg cannot change whether an itinerary is eligible.
 */
export function applyPreferences(
  itineraries: readonly ItineraryDto[],
  preferences: PlanPreferences = {},
): ItineraryDto[] {
  let ranked = [...itineraries];
  if (preferences.maxTransfers !== undefined) {
    const cap = preferences.maxTransfers;
    ranked = ranked.filter((itinerary) => itinerary.transfers <= cap);
  }
  const bufferMin = preferences.bufferMin;
  if (bufferMin !== undefined && bufferMin > 0) {
    ranked = ranked.map((itinerary) => withBuffer(itinerary, bufferMin));
  }
  if (preferences.cheapest === true && preferences.fewestTransfers === true) {
    ranked.sort(byFareThenTransfers);
  } else if (preferences.cheapest === true) {
    ranked.sort(byFare);
  } else if (preferences.fewestTransfers === true) {
    ranked.sort(byTransfers);
  }
  return ranked;
}
