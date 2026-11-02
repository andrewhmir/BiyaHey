import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageNotice } from '../components/layout/PageNotice';
import { cachedTrip } from '../features/routes/planCache';
import { TripDetailScreen } from '../features/trip/TripDetailScreen';
import { TripLiveScreen } from '../features/trip/TripLiveScreen';
import { useT } from '../i18n/useT';
import { findSavedTrip, recordRecentTrip } from '../lib/savedTripsStore';
import { useBackTo } from '../lib/useBackTo';

/**
 * `/trip/:id` and `/trip/:id/live` — split into their own chunk by `routes.tsx`
 * (Task 10). The detail screen is not needed to render Home or the route list,
 * so its icons, fare breakdown and timeline stay out of the first payload.
 */

/**
 * `/trip/:id` — trip detail from the in-memory plan cache (R62), falling back
 * to the saved-trips store (Task 8).
 *
 * The plan response is the only source of a fresh itinerary; there is no
 * plan-by-id endpoint. A reload or offline deep link therefore has no cache, so
 * the saved snapshot is the honest fallback: it opens the full timeline and
 * labels the header "Saved route (no live data)" with its snapshot date. When
 * neither the cache nor the store has the id, the honest "wala nang ruta"
 * notice stays.
 */
export function TripRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useT();
  const goBack = useBackTo('/search');
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
    />
  );
}

/** `/trip/:id/live` — static tracking placeholder; never claims live data. */
export function TripLiveRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <TripLiveScreen
      itineraryId={id}
      onBack={() => navigate(id === undefined ? '/search' : `/trip/${id}`)}
    />
  );
}
