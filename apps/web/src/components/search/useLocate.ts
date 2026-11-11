import { useCallback, useEffect, useRef, useState } from 'react';

/** One bounded geolocation read: the browser has to answer inside this window. */
export const GEOLOCATION_TIMEOUT_MS = 8_000;

export type LocateFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export type LocateState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'failed'; reason: LocateFailure };

export const LOCATE_FAILURE_KEYS: Record<LocateFailure, string> = {
  denied: 'search.locateDenied',
  unavailable: 'search.locateUnavailable',
  timeout: 'search.locateTimeout',
  unsupported: 'search.locateUnsupported',
};

interface LocateOutcome {
  state: LocateState;
  locate: () => void;
}

/**
 * A single device fix per tap, never automatic. Every failure is reported by
 * reason so the form can show honest copy instead of inventing a start point.
 */
export function useLocate(onLocated: (point: { lat: number; lon: number }) => void): LocateOutcome {
  const [state, setState] = useState<LocateState>({ status: 'idle' });
  const timer = useRef<number | null>(null);
  const callback = useRef(onLocated);
  callback.current = onLocated;

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const locate = useCallback(() => {
    let settled = false;
    const finish = (next: LocateState) => {
      if (settled) return;
      settled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setState(next);
    };

    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      finish({ status: 'failed', reason: 'unsupported' });
      return;
    }

    setState({ status: 'locating' });
    timer.current = window.setTimeout(
      () => finish({ status: 'failed', reason: 'timeout' }),
      GEOLOCATION_TIMEOUT_MS,
    );
    navigator.geolocation.getCurrentPosition(
      (position) => {
        callback.current({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        finish({ status: 'idle' });
      },
      (error) => {
        const reason: LocateFailure =
          error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        finish({ status: 'failed', reason });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: GEOLOCATION_TIMEOUT_MS },
    );
  }, []);

  return { state, locate };
}
