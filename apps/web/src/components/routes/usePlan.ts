import type { PlanRequest, PlanResponse } from '@biyahey/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, planTrip } from '../../lib/api';
import { rememberPlan } from '../../lib/planCache';

export type PlanStatus = 'loading' | 'success' | 'error';

export interface PlanOutcome {
  status: PlanStatus;
  data: PlanResponse | null;
  error: ApiError | null;
  retry: () => void;
}

/**
 * `POST /plan` for the trip in the URL. `requestKey` is the request's stable
 * identity: the plan is fetched once per trip, and a filter chip never refetches.
 */
export function usePlan(request: PlanRequest | null, requestKey: string): PlanOutcome {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    status: PlanStatus;
    data: PlanResponse | null;
    error: ApiError | null;
  }>({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (request === null) {
      setState({ status: 'error', data: null, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });
    planTrip(request, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        // `/trip/:id` reads its plan from this in-memory cache.
        rememberPlan(data);
        setState({ status: 'success', data, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          data: null,
          error: error instanceof ApiError ? error : null,
        });
      },
    );
    return () => controller.abort();
  }, [requestKey, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { ...state, retry };
}
