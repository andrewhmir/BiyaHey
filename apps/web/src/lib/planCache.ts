import type { DataSource, ItineraryDto, PlanResponse } from '@biyahey/shared';

/** A plan lives in memory only: a reload falls back to the saved snapshot. */
export interface CachedTrip {
  itinerary: ItineraryDto;
  sources: DataSource[];
}

const cache = new Map<string, CachedTrip>();

export function rememberPlan(response: PlanResponse): void {
  cache.clear();
  for (const itinerary of response.itineraries) {
    cache.set(itinerary.id, { itinerary, sources: response.sources });
  }
}

export function cachedTrip(id: string): CachedTrip | undefined {
  return cache.get(id);
}

export function clearPlanCache(): void {
  cache.clear();
}
