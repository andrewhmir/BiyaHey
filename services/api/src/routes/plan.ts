import type { FastifyInstance } from 'fastify';
import type { ItineraryDto, PlanRequest, PlanResponse } from '@biyahey/shared';
import {
  assertKnownSources,
  provenanceFor,
  type DataSource,
  type SourceId,
} from '@biyahey/shared/provenance';
import { applyPreferences, dedupeItineraries, parsePlanRequest } from '../domain/itinerary.js';
import { loadCuratedData, type CuratedData } from '../domain/curated-data.js';
import { createMotisClient, type MotisClient } from '../routing/motis-client.js';
import { mapPlanItineraries } from '../routing/map-itinerary.js';

/** Fewer than this and the route asks MOTIS again with a shifted departure. */
const TARGET_ITINERARIES = 3;
/** Second attempt: leave ten minutes later, catching the next vehicle batch. */
const SHIFTED_DEPARTURE_MIN = 10;

interface PlanAttempt {
  time: string;
  maxTransfers?: number;
}

function shiftedDeparture(departAt: string, minutes: number): string {
  return new Date(Date.parse(departAt) + minutes * 60_000).toISOString();
}

async function collectItineraries(
  client: MotisClient,
  context: CuratedData,
  plan: PlanRequest,
  departAt: string,
): Promise<ItineraryDto[]> {
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
  for (const [index, attempt] of attempts.entries()) {
    try {
      const payload = await client.plan({
        origin: plan.origin,
        destination: plan.destination,
        time: attempt.time,
        maxTransfers: attempt.maxTransfers,
      });
      itineraries = dedupeItineraries([
        ...itineraries,
        ...mapPlanItineraries(payload, context),
      ]);
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
  return itineraries;
}

/**
 * `POST /plan` — MOTIS itineraries mapped to v1 DTOs, enriched with fares and
 * the provenance ids of every dataset actually used.
 *
 * `sources` deliberately never contains `motis`: the routing engine is software,
 * not a data source (R6).
 */
export function registerPlanRoutes(app: FastifyInstance, dataDir: string): void {
  const client = createMotisClient({ fetch: app.motisFetch });
  const curated = loadCuratedData(dataDir);

  app.post('/plan', async (request) => {
    const plan = parsePlanRequest(request.body);
    const departAt = plan.departAt ?? new Date().toISOString();
    const collected = await collectItineraries(client, curated, plan, departAt);
    const itineraries = applyPreferences(collected, plan.preferences);

    for (const itinerary of itineraries) {
      // Reject an unknown id with 422 through the centralized handler. The
      // adapter only emits registry ids, so this is a contract check.
      itinerary.sources = assertKnownSources(itinerary.sources);
    }
    const sourceIds: SourceId[] = assertKnownSources(
      itineraries.flatMap((itinerary) => itinerary.sources),
    );
    const sources: DataSource[] = provenanceFor(sourceIds);

    const response: PlanResponse = { v: 1, itineraries, sources };
    return response;
  });
}
