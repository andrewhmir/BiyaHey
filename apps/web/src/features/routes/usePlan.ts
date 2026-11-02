import type { DataSource, ItineraryDto, PlanPlaceInput, PlanStopInput } from '@biyahey/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, planTrip } from '../../lib/api';
import { rememberPlan } from './planCache';

export type PlanStatus = 'loading' | 'success' | 'error';

export interface PlanOutcome {
  status: PlanStatus;
  itineraries: ItineraryDto[];
  /** Full provenance rows from the same plan response (R45). */
  sources: DataSource[];
  error: ApiError | null;
  retry: () => void;
}

/** Stable, comparable identity for the optional stop list (R89). */
function stopsQueryKey(stops: readonly PlanStopInput[]): string {
  return stops
    .map((stop) => `${stop.stopId}:${stop.lat},${stop.lon}`)
    .join('|');
}

/**
 * Server state for the route-options screen (Task 5 / trip-planner R89).
 *
 * One TanStack Query per origin/destination/stop list. The filter chips re-rank
 * the returned array locally, so the query key deliberately carries no
 * filter/preference state: changing a chip must never refetch (spec §9).
 *
 * `stops` is optional and additive: with no stops the request body is exactly
 * the v1 `{origin, destination}` (byte-identical), and with stops the same body
 * gains the `stops` array in travel order.
 */
export function usePlan(
  origin: PlanPlaceInput,
  destination: PlanPlaceInput,
  stops: readonly PlanStopInput[] = [],
): PlanOutcome {
  const stopsKey = stopsQueryKey(stops);
  const query = useQuery({
    queryKey: [
      'plan',
      origin.lat,
      origin.lon,
      destination.lat,
      destination.lon,
      stopsKey,
    ],
    queryFn: ({ signal }) =>
      planTrip(
        stops.length > 0
          ? {
              origin,
              destination,
              // Send exactly the contract shape: a display name lives in the
              // URL, never in `POST /plan`'s additive `stops` array.
              stops: stops.map(({ lat, lon, stopId }) => ({ lat, lon, stopId })),
            }
          : { origin, destination },
        { signal },
      ),
  });

  const status: PlanStatus = query.isError
    ? 'error'
    : query.data === undefined
      ? 'loading'
      : 'success';

  // R62: the route layer owns the plan response, so it is also the writer of
  // the in-memory cache `/trip/:id` reads. This is not a second fetch.
  useEffect(() => {
    if (query.data !== undefined) {
      rememberPlan(query.data);
    }
  }, [query.data]);

  return {
    status,
    itineraries: query.data?.itineraries ?? [],
    sources: query.data?.sources ?? [],
    error: query.error instanceof ApiError ? query.error : null,
    retry: () => {
      void query.refetch();
    },
  };
}
