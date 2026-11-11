import { useEffect, useRef } from 'react';
import { mapActions, useMapState } from '../../map/store';
import { mapEndpoints } from './itinerary';
import type { ResolvedTrip } from './useTrip';

const DESKTOP_QUERY = '(min-width: 1024px)';
/** The Panel's `half` detent: 58dvh. */
const HALF_DETENT = 0.58;
const SETTLE_TOLERANCE_PX = 64;
const SETTLE_TIMEOUT_MS = 450;

/**
 * Draw the resolved trip on the persistent map once the panel has settled.
 *
 * The bottom sheet animates its height (~300 ms) when a screen requests a new
 * detent, and the map's fit padding follows the panel's measured inset. Fitting
 * before that settles leaves the route fit for the wrong sheet height (or the
 * previous screen's), so wait for the inset to reach the half detent.
 */
export function useShowDetail(
  resolved: ResolvedTrip | undefined,
  activeLegIndex: number | null = null,
): void {
  const insetBottom = useMapState().inset.bottom;
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    if (resolved === undefined || shownId.current === resolved.itinerary.id) return;

    const show = (): void => {
      shownId.current = resolved.itinerary.id;
      mapActions.showDetail({
        itinerary: resolved.itinerary,
        sources: resolved.sources,
        endpoints: mapEndpoints(resolved.itinerary),
        activeLegIndex,
      });
    };

    const desktop = window.matchMedia(DESKTOP_QUERY).matches;
    const settled =
      insetBottom > 0 &&
      Math.abs(insetBottom - window.innerHeight * HALF_DETENT) <= SETTLE_TOLERANCE_PX;
    if (desktop || settled) {
      show();
      return;
    }

    const timer = window.setTimeout(show, SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resolved, activeLegIndex, insetBottom]);
}
