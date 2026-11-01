import type { DataSource, ItineraryDto, PlanPlaceInput } from '@biyahey/shared';
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

/**
 * Server state for the route-options screen (Task 5).
 *
 * One TanStack Query per origin/destination pair. The filter chips re-rank the
 * returned array locally, so the query key deliberately carries no
 * filter/preference state: changing a chip must never refetch (spec §9).
 */
export function usePlan(origin: PlanPlaceInput, destination: PlanPlaceInput): PlanOutcome {
  const query = useQuery({
    queryKey: ['plan', origin.lat, origin.lon, destination.lat, destination.lon],
    queryFn: ({ signal }) => planTrip({ origin, destination }, { signal }),
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
