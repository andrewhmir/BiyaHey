import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { usePanelDetent } from '../components/Panel';
import { ModeRibbon } from '../components/trip/ModeRibbon';
import { NoTripNotice } from '../components/trip/NoTripNotice';
import {
  endpointName,
  isWalkFallback,
  legInstruction,
  legStatText,
  signageText,
  type EndpointLabels,
} from '../components/trip/itinerary';
import { useScrollTopOnMount } from '../components/trip/useScrollTop';
import { useShowDetail } from '../components/trip/useShowDetail';
import { useTrip } from '../components/trip/useTrip';
import { useCopy } from '../i18n';
import {
  distanceLabel,
  durationLabel,
  fareLabel,
  formatFare,
  formatLongDate,
} from '../lib/format';
import { itineraryEndpoints } from '../lib/saved';
import { parseTripParams } from '../lib/trip';
import { modeLabel } from '../map/modes';
import { mapActions, useMapState } from '../map/store';

/** The leg-by-leg walkthrough. There is no real-time data; it never claims any. */
export function Live() {
  usePanelDetent('half');
  const { t } = useCopy();
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const params = useMemo(() => parseTripParams(searchParams), [searchParams]);
  const labels = useMemo(
    () => ({ from: params.fromName ?? undefined, to: params.destName ?? undefined }),
    [params],
  );
  const resolved = useTrip(id, labels);
  const { activeLegIndex } = useMapState();
  const [finished, setFinished] = useState(false);
  const scrollRef = useScrollTopOnMount(id);

  useShowDetail(resolved, 0);

  const lastIndex = resolved === undefined ? 0 : resolved.itinerary.legs.length - 1;

  // A map tap can focus any leg; that resumes the walkthrough on that leg.
  useEffect(() => {
    if (!finished) return;
    if (activeLegIndex !== lastIndex) setFinished(false);
  }, [activeLegIndex, finished, lastIndex]);

  if (resolved === undefined) {
    return (
      <NoTripNotice message={id === undefined ? t('plan.noIdMessage') : t('plan.expiredMessage')} />
    );
  }

  const trip = resolved.itinerary;
  const legs = trip.legs;
  const last = legs.length - 1;
  const step = activeLegIndex === null ? 0 : Math.min(Math.max(0, activeLegIndex), last);
  const currentLeg = legs[step]!;
  const walkFallback = isWalkFallback(trip);
  const storedEndpoints = itineraryEndpoints(trip);
  const from = params.fromName ?? resolved.fromLabel ?? storedEndpoints.from;
  const to = params.destName ?? resolved.toLabel ?? storedEndpoints.to;
  const endpointLabels: EndpointLabels = { from, to };
  const detailPath = `/trip/${trip.id}${location.search}`;
  const snapshotDate =
    resolved.snapshotAt === undefined
      ? null
      : (formatLongDate(resolved.snapshotAt) ?? resolved.snapshotAt);
  const announcement = finished
    ? t('trip.liveFinish')
    : t('trip.liveAnnounce', {
        index: step + 1,
        total: legs.length,
        title: legInstruction(currentLeg, t, endpointLabels),
      });

  const goNext = (): void => {
    if (step >= last) {
      setFinished(true);
      return;
    }
    setFinished(false);
    mapActions.focusLeg(step + 1);
  };

  const goPrev = (): void => {
    setFinished(false);
    if (step > 0) mapActions.focusLeg(step - 1);
  };

  const startOver = (): void => {
    setFinished(false);
    mapActions.focusLeg(0);
  };

  return (
    <div ref={scrollRef} className="flex flex-col pb-8">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white/95 px-5 py-3 backdrop-blur">
        <Link
          to={detailPath}
          aria-label={t('trip.liveExit')}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-md pr-2 text-sm font-semibold text-ink-soft transition hover:text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{t('trip.liveExit')}</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">
          {t('trip.liveTitle')}
        </h1>
      </div>

      <section aria-labelledby="live-summary-heading" className="px-5 pt-4">
        <h2
          id="live-summary-heading"
          className="break-words text-xl font-bold tracking-tight text-ink"
        >
          {to.length > 0 ? to : t('trip.liveTitle')}
        </h2>
        {from.length > 0 ? (
          <p className="mt-0.5 break-words text-sm text-ink-soft">
            {t('search.fromLabel')}: {from}
          </p>
        ) : null}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-ink">{durationLabel(trip.durationMin)}</span>
          <span className="text-ink-soft">
            {walkFallback
              ? t('walkFallback.stat', {
                  distance: distanceLabel(trip.walkDistanceM),
                  minutes: trip.durationMin,
                })
              : trip.fareIncomplete === true
                ? t('fare.partialTotal', { amount: formatFare(trip.fare.amount) })
                : fareLabel(trip.fare.amount)}
          </span>
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          {resolved.fresh ? t('trip.cachedPlan') : t('trip.savedSnapshot')}
        </p>
        {snapshotDate !== null ? (
          <p
            lang="en"
            className="mt-2 rounded-lg bg-brand-tint px-3 py-2 text-xs leading-relaxed text-brand-deep"
          >
            {t('trip.savedNote', { label: t('trip.savedRoute'), date: snapshotDate })}
          </p>
        ) : null}
      </section>

      <section
        role="status"
        aria-live="polite"
        aria-labelledby="live-banner-heading"
        className="mx-5 mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
      >
        <h2 id="live-banner-heading" lang="en" className="text-sm font-semibold text-ink">
          {t('trip.liveBanner')}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('trip.liveBody')}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('trip.liveHonesty')}</p>
      </section>

      {finished ? (
        <section
          aria-labelledby="live-finish-heading"
          className="mx-5 mt-4 rounded-lg border border-brand bg-brand-tint px-4 py-6 text-center"
        >
          <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-brand" />
          <h2 id="live-finish-heading" className="mt-2 text-xl font-bold text-ink">
            {t('trip.liveFinish')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('trip.liveFinishBody')}</p>
          <button
            type="button"
            onClick={startOver}
            className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-strong"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t('trip.liveStartOver')}
          </button>
          <Link
            to={detailPath}
            className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-md border border-line-strong bg-white px-5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
          >
            {t('trip.liveExit')}
          </Link>
        </section>
      ) : (
        <>
          <section aria-labelledby="live-progress-heading" className="mx-5 mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="live-progress-heading" className="text-sm font-bold text-ink">
                {t('trip.liveProgress', { index: step + 1, total: legs.length })}
              </h2>
              <span className="text-xs font-medium text-ink-faint">
                {modeLabel(currentLeg.mode, t)}
              </span>
            </div>
            <div className="mt-2">
              <ModeRibbon legs={legs} label={t('routes.ribbonLabel')} />
            </div>
          </section>

          <section
            aria-labelledby="live-current-heading"
            className="mx-5 mt-4 rounded-lg border border-line bg-white px-4 py-4 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              {t('trip.liveCurrent')} · {t('trip.legNumber', { index: step + 1 })}
            </p>
            <h2
              id="live-current-heading"
              className="mt-1 break-words text-xl font-bold leading-snug text-ink"
            >
              {legInstruction(currentLeg, t, endpointLabels)}
            </h2>
            <p className="mt-1 break-words text-sm text-ink-soft">{legStatText(currentLeg, t)}</p>
            {currentLeg.mode === 'walk' ? null : (
              <>
                <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-1 text-xs text-ink">
                  <span className="font-semibold uppercase tracking-wide text-ink-faint">
                    {t('trip.signageLabel')}
                  </span>
                  <span className="min-w-0 break-words font-medium">
                    {signageText(currentLeg, t)}
                  </span>
                </p>
                <p className="mt-1 break-words text-sm text-ink-soft">
                  {t('trip.alightAt', {
                    place: endpointName(currentLeg, 'to', endpointLabels),
                  })}
                </p>
                {currentLeg.stops !== undefined && currentLeg.stops.length > 1 ? (
                  <p className="mt-1 break-words text-xs text-ink-faint">
                    {t('trip.stopCounter', {
                      count: currentLeg.stops.length - 1,
                      place: endpointName(currentLeg, 'to', endpointLabels),
                    })}
                  </p>
                ) : null}
              </>
            )}
            {walkFallback ? (
              <p className="mt-2 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-soft">
                {t('walkFallback.body')} {t('walkFallback.provenance')}
              </p>
            ) : null}
            <p aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </section>

          <div className="mx-5 mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={step === 0}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1 rounded-md border border-line-strong bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {t('trip.livePrev')}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
            >
              {step >= last ? t('trip.liveFinish') : t('trip.liveNext')}
              {step >= last ? (
                <CheckCircle2 aria-hidden="true" className="size-4" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
