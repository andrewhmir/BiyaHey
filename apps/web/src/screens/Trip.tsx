import { ArrowLeft, Bookmark, BookmarkCheck, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { usePanelDetent } from '../components/Panel';
import { FareBreakdown } from '../components/trip/FareBreakdown';
import { LegTimeline } from '../components/trip/LegTimeline';
import { ModeRibbon } from '../components/trip/ModeRibbon';
import { NoTripNotice } from '../components/trip/NoTripNotice';
import { isWalkFallback, planPathFor } from '../components/trip/itinerary';
import { useScrollTopOnMount } from '../components/trip/useScrollTop';
import { useShowDetail } from '../components/trip/useShowDetail';
import { useTrip } from '../components/trip/useTrip';
import { useCopy } from '../i18n';
import {
  distanceLabel,
  durationLabel,
  fareLabel,
  formatClockTime,
  formatFare,
  formatLongDate,
  transfersLabel,
} from '../lib/format';
import { deleteSaved, isSaved, itineraryEndpoints, saveTrip } from '../lib/saved';
import { buildPlanPath, parseTripParams } from '../lib/trip';
import { mapActions, useMapState } from '../map/store';

/** Trip detail: the selected itinerary timeline plus the saved-snapshot fallback. */
export function Trip() {
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
  const [saved, setSaved] = useState(() => id !== undefined && isSaved(id));
  const [status, setStatus] = useState<string | null>(null);
  const scrollRef = useScrollTopOnMount(id);

  useShowDetail(resolved);

  useEffect(() => {
    setSaved(id !== undefined && isSaved(id));
  }, [id]);

  if (resolved === undefined) {
    return (
      <NoTripNotice message={id === undefined ? t('plan.noIdMessage') : t('plan.expiredMessage')} />
    );
  }

  const trip = resolved.itinerary;
  const tripSources = resolved.sources;
  const storedEndpoints = itineraryEndpoints(trip);
  const from = params.fromName ?? resolved.fromLabel ?? storedEndpoints.from;
  const to = params.destName ?? resolved.toLabel ?? storedEndpoints.to;
  const arrival = formatClockTime(trip.endTime);
  const walkFallback = isWalkFallback(trip);
  const fare = trip.fare;
  const fareSource =
    fare.source_id === null ? undefined : tripSources.find((row) => row.id === fare.source_id);
  const confidence = fare.confidence === 'estimated' ? t('common.estimate') : 'official';
  const active =
    activeLegIndex !== null && activeLegIndex >= 0 && activeLegIndex < trip.legs.length
      ? activeLegIndex
      : null;
  const fareAmount =
    trip.fareIncomplete === true
      ? t('fare.partialTotal', { amount: formatFare(fare.amount) })
      : fareLabel(fare.amount);
  const snapshotDate =
    resolved.snapshotAt === undefined
      ? null
      : (formatLongDate(resolved.snapshotAt) ?? resolved.snapshotAt);
  const backPath =
    params.hasFrom && params.hasDest ? buildPlanPath(params) : planPathFor(trip);
  const tripLabels = {
    from: from.length > 0 ? from : undefined,
    to: to.length > 0 ? to : undefined,
  };

  const focusLeg = (index: number): void => {
    mapActions.focusLeg(active === index ? null : index);
  };

  const toggleSave = (): void => {
    if (id === undefined) return;
    if (saved) {
      if (deleteSaved(id)) {
        setSaved(false);
        setStatus(t('saved.deletedToast'));
      } else {
        setStatus(t('saved.deleteFailed'));
      }
      return;
    }
    if (saveTrip(trip, tripSources, tripLabels)) {
      setSaved(true);
      setStatus(t('trip.saveOk'));
    } else {
      setStatus(t('trip.saveFailed'));
    }
  };

  return (
    <div ref={scrollRef} className="flex flex-col pb-8">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-white/95 px-5 py-3 backdrop-blur">
        <Link
          to={backPath}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-md pr-2 text-sm font-semibold text-ink-soft transition hover:text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('common.back')}
        </Link>
        <button
          type="button"
          onClick={toggleSave}
          aria-pressed={saved}
          aria-label={saved ? t('trip.unsave') : t('common.save')}
          className={`inline-flex min-h-12 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition ${
            saved
              ? 'border-brand bg-brand-tint text-brand-deep'
              : 'border-line-strong bg-white text-ink hover:border-brand hover:text-brand'
          }`}
        >
          {saved ? (
            <BookmarkCheck aria-hidden="true" className="size-4" />
          ) : (
            <Bookmark aria-hidden="true" className="size-4" />
          )}
          {saved ? t('common.saved') : t('common.save')}
        </button>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 px-5 pt-2 text-xs text-ink-faint">
        {status}
      </p>

      <section aria-labelledby="trip-heading" className="px-5 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{t('trip.title')}</p>
        <h1
          id="trip-heading"
          className="mt-1 break-words text-2xl font-bold tracking-tight text-ink"
        >
          {to.length > 0 ? to : t('trip.title')}
        </h1>
        {from.length > 0 ? (
          <p className="mt-0.5 break-words text-sm text-ink-soft">
            {t('search.fromLabel')}: {from}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-3xl font-bold tracking-tight text-ink">
            {durationLabel(trip.durationMin)}
          </span>
          {arrival !== null ? (
            <span className="text-sm font-medium text-ink-soft">
              {t('trip.heroArrive', { arrival })}
            </span>
          ) : null}
        </p>

        {walkFallback ? (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {t('walkFallback.badge')}
            </p>
            <p className="mt-1 text-sm font-medium text-ink">
              {t('walkFallback.stat', {
                distance: distanceLabel(trip.walkDistanceM),
                minutes: trip.durationMin,
              })}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('walkFallback.body')}</p>
            <p className="mt-1 text-xs text-ink-faint">{t('walkFallback.provenance')}</p>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-line bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-lg font-bold tabular-nums text-ink">{fareAmount}</span>
              <span aria-hidden="true" className="text-ink-faint">·</span>
              <span className="text-sm text-ink-soft">{transfersLabel(trip.transfers, t)}</span>
              <span aria-hidden="true" className="text-ink-faint">·</span>
              <span className="text-sm text-ink-soft">
                {t('routes.walk', { distance: distanceLabel(trip.walkDistanceM) })}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              {t('fare.effective', { date: fare.effective_from })}
              {' · '}
              {t('about.confidence')}: {confidence}
              {fareSource !== undefined ? ` · ${t('fare.source')} ${fareSource.name}` : null}
              {fare.source_id === null ? ` · ${t('routes.fareMixed')}` : null}
            </p>
          </div>
        )}

        {snapshotDate !== null ? (
          <p
            lang="en"
            className="mt-2 rounded-lg bg-brand-tint px-3 py-2 text-xs leading-relaxed text-brand-deep"
          >
            {t('trip.savedNote', {
              label: t('trip.savedRoute'),
              date: snapshotDate,
            })}
          </p>
        ) : null}

        <Link
          to={`/trip/${trip.id}/live${location.search}`}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
        >
          <Play aria-hidden="true" className="size-4" />
          {t('trip.start')}
        </Link>
      </section>

      <section aria-labelledby="modes-heading" className="mt-5 px-5">
        <h2
          id="modes-heading"
          className="text-xs font-semibold uppercase tracking-wide text-ink-faint"
        >
          {t('routes.modeGroup')}
        </h2>
        <div className="mt-2">
          <ModeRibbon legs={trip.legs} label={t('routes.ribbonLabel')} />
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="mt-5 px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="steps-heading" className="text-xl font-bold text-ink">
            {t('trip.steps')}
          </h2>
          {active !== null ? (
            <button
              type="button"
              onClick={() => mapActions.focusLeg(null)}
              className="inline-flex min-h-12 items-center rounded-md border border-line bg-white px-3 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand-tint"
            >
              {t('trip.wholeRoute')}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-faint">{t('trip.mapHint')}</p>
        <div className="mt-3">
          <LegTimeline
            legs={trip.legs}
            activeIndex={active}
            labels={{ from, to }}
            onFocus={focusLeg}
          />
        </div>
      </section>

      {walkFallback ? null : (
        <div className="mt-5 px-5">
          <FareBreakdown
            fare={fare}
            sources={tripSources.filter((row) => trip.sources.includes(row.id))}
            incomplete={trip.fareIncomplete === true}
          />
        </div>
      )}
    </div>
  );
}
