import type { FastifyInstance } from 'fastify';
import type { ItineraryDto, PlanRequest, PlanResponse } from '@biyahey/shared';
import {
  assertKnownSources,
  provenanceFor,
  type DataSource,
  type ProvenanceRegistry,
  type SourceId,
} from '@biyahey/shared/provenance';
import { applyPreferences, dedupeItineraries, parsePlanRequest } from '../domain/itinerary.js';
import { loadCuratedData, type CuratedData } from '../domain/curated-data.js';
import { createMotisClient, type MotisClient } from '../routing/motis-client.js';
import {
  isPlausibleItinerary,
  itineraryKey,
  mapPlanItineraries,
} from '../routing/map-itinerary.js';

/** Fewer than this and the route asks MOTIS again with a shifted departure. */
const TARGET_ITINERARIES = 3;
/** Second attempt: leave ten minutes later, catching the next vehicle batch. */
const SHIFTED_DEPARTURE_MIN = 10;

/**
 * Response header carrying the number of logical MOTIS `/plan` calls the
 * fan-out made. Base, +10 min and direct-only are up to three calls; the stress
 * probe (`scripts/motis-stress.mjs`) asserts this is 3 so the R37 proof really
 * exercises the multi-call path instead of a corridor that answers in one call.
 */
export const MOTIS_CALLS_HEADER = 'x-biyahey-motis-calls';

/**
 * Response header carrying the number of unique itineraries dropped by the
 * plausibility guard (see `MAX_TRANSIT_SPEED_KMH` in `map-itinerary.ts`).
 * Exposed so acceptance can prove the guard ran and how much bad geometry the
 * current feed still contains (R10).
 */
export const IMPLAUSIBLE_DROPPED_HEADER = 'x-biyahey-implausible-dropped';

interface PlanAttempt {
  time: string;
  maxTransfers?: number;
}

interface CollectionResult {
  itineraries: ItineraryDto[];
  /** Logical MOTIS `/plan` calls made; each may retry once on transport error. */
  motisCalls: number;
  /** Unique itineraries the plausibility guard dropped, deduped across attempts. */
  implausibleDropped: number;
}

function shiftedDeparture(departAt: string, minutes: number): string {
  return new Date(Date.parse(departAt) + minutes * 60_000).toISOString();
}

async function collectItineraries(
  client: MotisClient,
  context: CuratedData,
  plan: PlanRequest,
  departAt: string,
): Promise<CollectionResult> {
  const maxTransfers = plan.preferences?.maxTransfers;
  const attempts: PlanAttempt[] = [
    { time: departAt, maxTransfers },
    { time: shiftedDeparture(departAt, SHIFTED_DEPARTURE_MIN), maxTransfers },
  ];
  if (maxTransfers !== 0) {
    // Third attempt: a direct-only query when the transfer itineraries are
    // sparse. It is redundant (and skipped) when the caller already capped at 0.
    attempts.push({ time: departAt, maxTransfers: 0 });
  }

  let itineraries: ItineraryDto[] = [];
  let motisCalls = 0;
  const dropped = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    try {
      motisCalls += 1;
      const payload = await client.plan({
        origin: plan.origin,
        destination: plan.destination,
        time: attempt.time,
        maxTransfers: attempt.maxTransfers,
      });
      // Drop impossible geometry before it can count toward the three-option
      // target or reach the fare engine (R10 feed defect; see map-itinerary.ts).
      const plausible: ItineraryDto[] = [];
      for (const itinerary of mapPlanItineraries(payload, context)) {
        if (isPlausibleItinerary(itinerary)) {
          plausible.push(itinerary);
        } else {
          dropped.add(itineraryKey(itinerary));
        }
      }
      itineraries = dedupeItineraries([...itineraries, ...plausible]);
    } catch (error) {
      // The base request is the plan. A failing enrichment call must not turn a
      // usable answer into a 502; if there is no usable answer either, surface
      // the router failure.
      if (index === 0 || itineraries.length === 0) {
        throw error;
      }
      break;
    }
    if (itineraries.length >= TARGET_ITINERARIES) {
      break;
    }
  }
  return { itineraries, motisCalls, implausibleDropped: dropped.size };
}

/**
 * `POST /plan` — MOTIS itineraries mapped to v1 DTOs, enriched with fares and
 * the provenance ids of every dataset actually used.
 *
 * `sources` deliberately never contains `motis`: the routing engine is software,
 * not a data source (R6).
 *
 * Source validation and the returned registry rows both use the `registry` that
 * `/sources` serves, so a plan can never cite a `DataSource` the BFF does not
 * publish when `BIYAHEY_DATA_DIR` points at an alternate registry.
 */
export function registerPlanRoutes(
  app: FastifyInstance,
  dataDir: string,
  registry: ProvenanceRegistry,
): void {
  const client = createMotisClient({ fetch: app.motisFetch });
  const curated = loadCuratedData(dataDir);

  app.post('/plan', async (request, reply) => {
    const plan = parsePlanRequest(request.body);
    const departAt = plan.departAt ?? new Date().toISOString();
    const collected = await collectItineraries(client, curated, plan, departAt);
    const itineraries = applyPreferences(collected.itineraries, plan.preferences);

    // Observable proof for the R37 stress probe and for the R10 guard: the
    // fan-out actually made N calls and the feed's bad geometry was dropped.
    reply.header(MOTIS_CALLS_HEADER, String(collected.motisCalls));
    reply.header(IMPLAUSIBLE_DROPPED_HEADER, String(collected.implausibleDropped));

    for (const itinerary of itineraries) {
      // Reject an id absent from the active registry with 422 through the
      // centralized handler. The adapter only emits registry ids, so this is a
      // contract check.
      itinerary.sources = assertKnownSources(itinerary.sources, registry);
    }
    const sourceIds: SourceId[] = assertKnownSources(
      itineraries.flatMap((itinerary) => itinerary.sources),
      registry,
    );
    const sources: DataSource[] = provenanceFor(sourceIds, registry);

    const response: PlanResponse = { v: 1, itineraries, sources };
    return response;
  });
}
