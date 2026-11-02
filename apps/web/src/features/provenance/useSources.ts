import type { DataSource } from '@biyahey/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchSources } from '../../lib/api';

export type SourcesStatus = 'loading' | 'success' | 'error';

export interface SourcesOutcome {
  status: SourcesStatus;
  datasets: DataSource[];
  error: ApiError | null;
  retry: () => void;
}

/**
 * Server state for the About-data screen (Task 7).
 *
 * One TanStack Query for `GET /sources`; the response is the registry in the
 * BFF's canonical order, rendered as returned. The query key carries no screen
 * state because the list has no filters.
 */
export function useSources(): SourcesOutcome {
  const query = useQuery({
    queryKey: ['sources'],
    queryFn: ({ signal }) => fetchSources({ signal }),
  });

  const status: SourcesStatus = query.isError
    ? 'error'
    : query.data === undefined
      ? 'loading'
      : 'success';

  return {
    status,
    datasets: query.data ?? [],
    error: query.error instanceof ApiError ? query.error : null,
    retry: () => {
      void query.refetch();
    },
  };
}
