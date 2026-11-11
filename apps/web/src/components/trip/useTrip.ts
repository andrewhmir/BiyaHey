import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { useEffect, useMemo } from 'react';
import { cachedTrip } from '../../lib/planCache';
import {
  findSaved,
  itineraryEndpoints,
  listRecents,
  recordRecent,
  type TripLabels,
} from '../../lib/saved';

/** One trip as the trip/live screens found it: fresh plan cache, saved, or recent. */
export interface ResolvedTrip {
  itinerary: ItineraryDto;
  sources: DataSource[];
  /** True only for an itinerary still in the in-memory plan cache. */
  fresh: boolean;
  /** Snapshot date when the itinerary came from device storage. */
  snapshotAt?: string;
  /** Rider's labels, when the stored row kept them. */
  fromLabel?: string;
  toLabel?: string;
}

function resolve(id: string | undefined): ResolvedTrip | undefined {
  if (id === undefined) return undefined;
  const cached = cachedTrip(id);
  if (cached !== undefined) {
    return { itinerary: cached.itinerary, sources: cached.sources, fresh: true };
  }
  const stored = findSaved(id) ?? listRecents().find((row) => row.itinerary.id === id);
  if (stored === undefined) return undefined;
  return {
    itinerary: stored.itinerary,
    sources: stored.sources,
    fresh: false,
    snapshotAt: stored.savedAt,
    fromLabel: stored.fromLabel,
    toLabel: stored.toLabel,
  };
}

/**
 * Resolve one trip id and record a fresh cache hit as a recent trip, carrying
 * the rider's place labels from the `/trip/:id?from=…&dest=…` URL.
 */
export function useTrip(
  id: string | undefined,
  labels: TripLabels = {},
): ResolvedTrip | undefined {
  const resolved = useMemo(() => resolve(id), [id]);
  const { from, to } = labels;

  useEffect(() => {
    if (resolved?.fresh !== true) return;
    const fallback = itineraryEndpoints(resolved.itinerary);
    recordRecent(resolved.itinerary, resolved.sources, {
      from: from ?? fallback.from,
      to: to ?? fallback.to,
    });
  }, [resolved, from, to]);

  return resolved;
}
