import { ArrowLeft } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { formatFare } from '../routes/RouteCard';
import { cachedTrip } from '../routes/planCache';

export interface TripLiveScreenProps {
  itineraryId?: string;
  onBack?: () => void;
}

/**
 * Static trip-tracking placeholder (plan Task 6, spec §9 "No real-time").
 *
 * v1 has no GTFS-RT feed, so this screen makes no live claim at all: it states
 * the expected wait and shows the cached plan summary. It is deliberately not a
 * fake progress tracker.
 *
 * The mandated "no live data — expected wait" sentence is English inside the
 * Taglish UI, so its paragraph carries `lang="en"` for screen readers (R44).
 */
export function TripLiveScreen({ itineraryId, onBack }: TripLiveScreenProps) {
  const { t } = useT();
  const cached = itineraryId === undefined ? undefined : cachedTrip(itineraryId);

  return (
    <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+2rem)] text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
          {onBack !== undefined ? (
            <button
              type="button"
              aria-label={t('common.back')}
              onClick={onBack}
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <h1 className="text-lg font-semibold tracking-tight">{t('trip.liveTitle')}</h1>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
        <section
          role="status"
          aria-live="polite"
          data-testid="live-banner"
          className="rounded-card border border-outline-variant bg-surface-container-low px-4 py-4"
        >
          <p lang="en" className="text-base font-semibold">
            {t('trip.liveBanner')}
          </p>
          <p className="mt-1 text-sm text-on-surface-variant">{t('trip.liveBody')}</p>
        </section>

        {cached !== undefined ? (
          <p data-testid="live-trip-summary" className="text-sm text-on-surface-variant">
            {cached.itinerary.durationMin} min · ₱{formatFare(cached.itinerary.fare.amount)} ·{' '}
            {t('trip.cachedPlan')}
          </p>
        ) : (
          <p className="text-sm text-on-surface-variant">{t('trip.noCached')}</p>
        )}
      </div>
    </main>
  );
}
