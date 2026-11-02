import type { DataSource, ItineraryDto, PlanResponse } from '@biyahey/shared';

/**
 * In-memory plan cache for the trip-detail route (R62).
 *
 * `/plan` owns the plan response; the route layer stores it here when the
 * response arrives, keyed by itinerary id. `/trip/:id` reads from this cache
 * instead of inventing a plan-by-id endpoint: there is no such endpoint, so a
 * deep link with no cached plan must show the honest "wala nang ruta" notice.
 *
 * Deliberately not persisted: a page reload loses the cache and therefore
 * falls back to the notice rather than rendering a stale plan as current.
 */
export interface CachedTrip {
  itinerary: ItineraryDto;
  /** Full provenance rows from the same plan response. */
  sources: DataSource[];
}

const cache = new Map<string, CachedTrip>();

/** Replace the cache with one plan response; only the latest plan is kept. */
export function rememberPlan(response: PlanResponse): void {
  cache.clear();
  for (const itinerary of response.itineraries) {
    cache.set(itinerary.id, { itinerary, sources: response.sources });
  }
}

/** The itinerary and provenance rows for `id`, or `undefined` when uncached. */
export function cachedTrip(id: string): CachedTrip | undefined {
  return cache.get(id);
}

/** Test/maintenance hook: forget every cached plan. */
export function clearPlanCache(): void {
  cache.clear();
}
