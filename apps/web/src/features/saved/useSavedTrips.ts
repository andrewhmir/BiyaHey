import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchFareStatus } from '../../lib/api';
import { useOnlineStatus } from '../../lib/online';
import {
  deleteSavedTrip,
  readRecentTrips,
  readSavedTrips,
  renameSavedTrip,
  restoreSavedTrip,
  type SavedTrip,
} from '../../lib/savedTripsStore';

/**
 * State for the saved/recent screen (plan Task 8).
 *
 * The lists are device data, not server state: nothing here polls, and a failed
 * or silent fare-matrix request can only change the staleness label — it can
 * never clear the lists (the plan's "network silent for 60 s must not blank the
 * screen" budget). The only network call is `GET /fares/status`, which supplies
 * the current matrix date for {@link isStale}; the hook never fetches a fare or
 * recomputes one (R45).
 */

export type FareMatrixState =
  | { status: 'loading' }
  | { status: 'ready'; effectiveFrom: string }
  | { status: 'unavailable' };

export interface SavedTripsController {
  saved: SavedTrip[];
  recents: SavedTrip[];
  online: boolean;
  fareMatrix: FareMatrixState;
  /** Current matrix date, or `undefined` while loading/offline/unavailable. */
  currentMatrixEffectiveFrom: string | undefined;
  remove(id: string): boolean;
  restore(trip: SavedTrip): boolean;
  rename(id: string, nickname: string): boolean;
  reload(): void;
}

function readLists(now: Date | undefined): { saved: SavedTrip[]; recents: SavedTrip[] } {
  const at = now ?? new Date();
  return { saved: readSavedTrips(), recents: readRecentTrips(at) };
}

export function useSavedTrips(now?: Date): SavedTripsController {
  const online = useOnlineStatus();
  const [lists, setLists] = useState(() => readLists(now));
  const [fareMatrix, setFareMatrix] = useState<FareMatrixState>({ status: 'loading' });

  const reload = useCallback(() => {
    setLists(readLists(now));
  }, [now]);

  useEffect(() => {
    if (!online) {
      // Offline: no request is made and no freshness is claimed. The saved
      // snapshot's own `effective_from` is all the screen can honestly show.
      setFareMatrix({ status: 'unavailable' });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setFareMatrix({ status: 'loading' });
    fetchFareStatus({ signal: controller.signal })
      .then((status) => {
        if (active) {
          setFareMatrix({ status: 'ready', effectiveFrom: status.effective_from });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.code === 'aborted') {
          return;
        }
        // A failed check is "unknown", never "fresh" and never an empty list.
        setFareMatrix({ status: 'unavailable' });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [online]);

  const remove = useCallback(
    (id: string): boolean => {
      const removed = deleteSavedTrip(id);
      reload();
      return removed;
    },
    [reload],
  );

  const restore = useCallback(
    (trip: SavedTrip): boolean => {
      const restored = restoreSavedTrip(trip);
      reload();
      return restored;
    },
    [reload],
  );

  const rename = useCallback(
    (id: string, nickname: string): boolean => {
      const updated = renameSavedTrip(id, nickname);
      reload();
      return updated !== null;
    },
    [reload],
  );

  return {
    saved: lists.saved,
    recents: lists.recents,
    online,
    fareMatrix,
    currentMatrixEffectiveFrom:
      fareMatrix.status === 'ready' ? fareMatrix.effectiveFrom : undefined,
    remove,
    restore,
    rename,
    reload,
  };
}
