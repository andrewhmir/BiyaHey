import type { ItineraryDto } from '@biyahey/shared';
import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapView } from '../components/map/MapView';
import { RoutePathLayer } from '../components/map/RoutePathLayer';
import { PageNotice } from '../components/layout/PageNotice';
import { cachedTrip } from '../features/routes/planCache';
import { TripDetailScreen, type TripMapRenderer } from '../features/trip/TripDetailScreen';
import { TripLiveScreen } from '../features/trip/TripLiveScreen';
import { useT } from '../i18n/useT';
import { findSavedTrip, recordRecentTrip } from '../lib/savedTripsStore';
import { useBackTo } from '../lib/useBackTo';

/**
 * `/trip/:id` and `/trip/:id/live` — split into their own chunk by `routes.tsx`.
 *
 * UX v2: both screens receive a `renderMap` renderer that draws the itinerary
 * through `RoutePathLayer` (`variant="detail"`), so the chosen route is visible
 * leg-by-leg and the map shares the screen's leg-focus state:
 *
 * - detail: `activeLegIndex === null` shows the whole route; a focused leg fits
 *   and emphasises just that leg;
 * - live: the walkthrough's current leg is the emphasised one, and tapping a leg
 *   on the map jumps the walkthrough to it.
 *
 * The renderer must fill the screen's map container (`h-full w-full`); the
 * screens own the sticky header/height and the back/save controls.
 */

/** Renderer for `/trip/:id`: fits the focused leg, else the whole itinerary. */
function useDetailMapRenderer(): TripMapRenderer {
  return useCallback<TripMapRenderer>(
    ({ itinerary, activeLegIndex, onSelectLeg }) => (
      <MapView showLocate={false}>
        <RoutePathLayer
          itineraries={[itinerary]}
          variant="detail"
          selectedId={itinerary.id}
          activeLegIndex={activeLegIndex}
          onSelectLeg={onSelectLeg}
          fit={activeLegIndex === null ? 'selected' : 'active-leg'}
        />
      </MapView>
    ),
    [],
  );
}

/** Renderer for `/trip/:id/live`: the whole route stays visible (context), with
 * the walkthrough's current leg emphasised. Fitting only the current leg made a
 * short walk leg fill the strip and hid the rest of the trip. */
function useLiveMapRenderer(): TripMapRenderer {
  return useCallback<TripMapRenderer>(
    ({ itinerary, activeLegIndex, onSelectLeg }) => (
      <MapView showLocate={false}>
        <RoutePathLayer
          itineraries={[itinerary]}
          variant="detail"
          selectedId={itinerary.id}
          activeLegIndex={activeLegIndex}
          onSelectLeg={onSelectLeg}
          fit="selected"
        />
      </MapView>
    ),
    [],
  );
}

/**
 * `/trip/:id` — trip detail from the in-memory plan cache (R62), falling back
 * to the saved-trips store (Task 8).
 *
 * The plan response is the only source of a fresh itinerary; there is no
 * plan-by-id endpoint. A reload or offline deep link therefore has no cache, so
 * the saved snapshot is the honest fallback: it opens the full timeline and the
 * mapped route, labelled "Saved route (no live data)" with its snapshot date.
 * Neither source present → the honest "wala nang ruta" notice.
 */
export function TripRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useT();
  const goBack = useBackTo('/search');
  const renderMap = useDetailMapRenderer();
  const cached = id === undefined ? undefined : cachedTrip(id);
  const stored = id === undefined ? undefined : findSavedTrip(id);

  // Opening a fresh plan makes it a recent trip; opening a saved snapshot does
  // not, so an old fare can never be re-stamped as newly updated.
  useEffect(() => {
    if (cached !== undefined) {
      recordRecentTrip(cached.itinerary, cached.sources);
    }
  }, [cached]);

  if (id === undefined) {
    return (
      <PageNotice
        title={t('plan.noRouteTitle')}
        message={t('plan.noIdMessage')}
        primary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
      />
    );
  }

  if (cached === undefined && stored === undefined) {
    return (
      <PageNotice
        title={t('plan.noRouteTitle')}
        message={t('plan.expiredMessage')}
        primary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
      />
    );
  }

  if (cached !== undefined) {
    return (
      <TripDetailScreen
        itinerary={cached.itinerary}
        sources={cached.sources}
        onBack={goBack}
        onStartTrip={() => navigate(`/trip/${cached.itinerary.id}/live`)}
        renderMap={renderMap}
      />
    );
  }

  // Unreachable per the guard above, but keeps the store branch fully typed.
  if (stored === undefined) {
    return null;
  }

  return (
    <TripDetailScreen
      itinerary={stored.itinerary}
      sources={stored.sources}
      savedSnapshotAt={stored.savedAt}
      onBack={goBack}
      onStartTrip={() => navigate(`/trip/${stored.itinerary.id}/live`)}
      renderMap={renderMap}
    />
  );
}

/**
 * `/trip/:id/live` — the leg-by-leg walkthrough.
 *
 * The itinerary is resolved here (plan cache first, saved snapshot second) and
 * passed explicitly so the screen renders the mapped walkthrough rather than
 * falling back to its cache lookup; the honest no-route notice is unchanged.
 */
export function TripLiveRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useT();
  const renderMap = useLiveMapRenderer();
  const cached = id === undefined ? undefined : cachedTrip(id);
  const stored = id === undefined ? undefined : findSavedTrip(id);
  const itinerary: ItineraryDto | undefined = cached?.itinerary ?? stored?.itinerary;

  if (id === undefined) {
    return (
      <PageNotice
        title={t('plan.noRouteTitle')}
        message={t('plan.noIdMessage')}
        primary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
      />
    );
  }

  return (
    <TripLiveScreen
      itineraryId={id}
      itinerary={itinerary}
      // Only label the walkthrough as a saved snapshot when the plan cache did
      // not supply the itinerary; a fresh cached plan must keep saying
      // "naka-cache na plano" even when the same trip also exists in the store.
      savedSnapshotAt={cached !== undefined ? undefined : stored?.savedAt}
      onBack={() => navigate(`/trip/${id}`)}
      renderMap={renderMap}
    />
  );
}
