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
  mapPlanItinerariesDetailed,
} from '../routing/map-itinerary.js';

/** Fewer than this and the route asks MOTIS again with a shifted departure. */
const TARGET_ITINERARIES = 3;
/**
 * Spec §9 asks for the best 3–5 options, never MOTIS's full 10–12. The cap is
 * applied after ranking and dedupe, so it keeps the order the client's
 * preference chose (cheapest / fewest transfers / MOTIS ETA order) intact.
 */
export const MAX_ITINERARIES = 5;
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

/**
 * Response header carrying the number of unique itineraries dropped because
 * they use a mode/route family v1 cannot price: PNR lines (`rail-ss`,
 * `rail-mnc`), the proposed MRT-9 (`rail-mrt9`), and ferries that are not the
 * free MMDA PRFS service. The publish stage also excludes them from the feed,
 * so a non-zero count here means an unexpected feed reached the router.
 */
export const UNSUPPORTED_DROPPED_HEADER = 'x-biyahey-unsupported-dropped';

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
  /** Unique itineraries dropped for a mode/route family v1 cannot price. */
  unsupportedDropped: number;
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
  // Every attempt must constrain routing to the same intermediate stops, or the
  // enrichment calls would answer a different (origin -> destination) question.
  // The schema already trimmed the ids; forward them verbatim.
  const via = plan.stops?.map((stop) => stop.stopId);
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
  const unsupported = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    try {
      motisCalls += 1;
      const payload = await client.plan({
        origin: plan.origin,
        destination: plan.destination,
        time: attempt.time,
        maxTransfers: attempt.maxTransfers,
        via,
      });
      // Drop impossible geometry before it can count toward the three-option
      // target or reach the fare engine (R10 feed defect; see map-itinerary.ts).
      // Unsupported modes (PNR, non-PRFS ferry, P2P) are counted separately so
      // the feed gap is visible instead of looking like an empty corridor.
      const mapped = mapPlanItinerariesDetailed(payload, context);
      for (const key of mapped.unsupportedKeys) {
        unsupported.add(key);
      }
      const plausible: ItineraryDto[] = [];
      for (const itinerary of mapped.itineraries) {
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
  return {
    itineraries,
    motisCalls,
    implausibleDropped: dropped.size,
    unsupportedDropped: unsupported.size,
  };
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
    // Spec §9 / final-review item 5: rank and dedupe first, then serve the best
    // 3–5 options. The cap never drops below the three-option target because a
    // corridor with fewer options already triggered the extra MOTIS attempts.
    const itineraries = applyPreferences(collected.itineraries, plan.preferences).slice(
      0,
      MAX_ITINERARIES,
    );

    // Observable proof for the R37 stress probe, the R10 guard and the mode
    // gate: the fan-out actually made N calls and both drop counts are visible.
    reply.header(MOTIS_CALLS_HEADER, String(collected.motisCalls));
    reply.header(IMPLAUSIBLE_DROPPED_HEADER, String(collected.implausibleDropped));
    reply.header(UNSUPPORTED_DROPPED_HEADER, String(collected.unsupportedDropped));

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
