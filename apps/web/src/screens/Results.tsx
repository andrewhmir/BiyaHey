import type { PlanResponse } from '@biyahey/shared';
import { ArrowLeft, ArrowRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePanelDetent } from '../components/Panel';
import { FilterChips } from '../components/routes/FilterChips';
import { RouteCard } from '../components/routes/RouteCard';
import { badgeFor, rankItineraries, type RouteFilter } from '../components/routes/rankItineraries';
import { usePlan } from '../components/routes/usePlan';
import { isWalkFallback } from '../components/routes/WalkFallback';
import { useCopy } from '../i18n';
import { formatClockTime } from '../lib/format';
import { buildSearchPath, buildTripQuery, parseTripParams, planRequestFor } from '../lib/trip';
import { endpointsFromDraft, mapActions, useMapState } from '../map/store';

/** Skeletons never flash: they appear only once the plan is still pending at 300 ms. */
const SKELETON_DELAY_MS = 300;

function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return active && elapsed;
}

function SkeletonCards() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-3">
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          className="flex animate-pulse flex-col gap-3 rounded-lg border border-line bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="h-7 w-24 rounded bg-line" />
              <div className="h-4 w-28 rounded bg-line" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="h-4 w-16 rounded bg-line" />
              <div className="h-6 w-20 rounded bg-line" />
            </div>
          </div>
          <div className="h-2.5 w-full rounded bg-line" />
          <div className="h-4 w-40 rounded bg-line" />
        </li>
      ))}
    </ul>
  );
}

interface NoticeProps {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

function Notice({ title, message, actionLabel, onAction }: NoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-start gap-3 rounded-lg border border-line bg-white p-5 shadow-sm"
    >
      <p className="text-base font-bold text-ink">{title}</p>
      <p className="text-sm leading-6 text-ink-soft">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-1 min-h-12 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
      >
        {actionLabel}
      </button>
    </div>
  );
}

/** Route options for the trip in the URL, drawn over the persistent map. */
export function Results() {
  usePanelDetent('half');
  const navigate = useNavigate();
  const { t } = useCopy();
  const [params] = useSearchParams();
  const draft = useMemo(() => parseTripParams(params), [params]);
  const request = useMemo(() => planRequestFor(draft), [draft]);
  const requestKey = useMemo(() => (request === null ? '' : JSON.stringify(request)), [request]);
  const plan = usePlan(request, requestKey);
  const [filter, setFilter] = useState<RouteFilter>('recommended');
  const map = useMapState();
  const tripQuery = useMemo(() => buildTripQuery(draft), [draft]);

  const searchPath = useMemo(() => buildSearchPath(draft), [draft]);
  const editTrip = () => navigate(searchPath, { replace: true });

  const itineraries = plan.data?.itineraries ?? [];
  const count = itineraries.length;
  const fallbackOnly = count > 0 && itineraries.every(isWalkFallback);
  const fastestMinutes =
    count > 0
      ? itineraries.reduce(
          (fastest, itinerary) => Math.min(fastest, itinerary.durationMin),
          Number.POSITIVE_INFINITY,
        )
      : 0;

  const ranked = useMemo(() => rankItineraries(itineraries, filter), [itineraries, filter]);
  const selectedId =
    map.selectedId !== null && ranked.some((itinerary) => itinerary.id === map.selectedId)
      ? map.selectedId
      : (ranked[0]?.id ?? null);

  // Draw the whole plan once per response; the card list and the map emphasis
  // then share one selection written through `mapActions.selectItinerary`.
  useEffect(() => {
    if (plan.data === null) return;
    const response: PlanResponse = plan.data;
    mapActions.showOptions({
      itineraries: response.itineraries,
      endpoints: endpointsFromDraft(draft),
      sources: response.sources,
    });
    const lead = rankItineraries(response.itineraries, 'recommended')[0];
    if (lead !== undefined && lead.id !== response.itineraries[0]?.id) {
      mapActions.selectItinerary(lead.id);
    }
  }, [plan.data, draft]);

  useEffect(() => {
    mapActions.setLoading(plan.status === 'loading');
    return () => mapActions.setLoading(false);
  }, [plan.status]);

  // A link that cannot draw a plan must not leave a previous route on the map.
  useEffect(() => {
    if (request === null) mapActions.reset();
  }, [request]);

  const previousSelected = useRef<string | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState('');
  useEffect(() => {
    const previous = previousSelected.current;
    previousSelected.current = selectedId;
    const selected = ranked.find((itinerary) => itinerary.id === selectedId);
    setSelectionAnnouncement(
      previous !== null && previous !== selectedId && selected !== undefined
        ? t('routes.selectedAnnounce', { minutes: selected.durationMin })
        : '',
    );
  }, [selectedId, ranked, t]);

  const showSkeletons = useDelayedFlag(plan.status === 'loading', SKELETON_DELAY_MS);

  const fromLabel = (draft.fromName ?? '').trim() || t('routes.unknownPlace');
  const destLabel = (draft.destName ?? '').trim() || t('routes.unknownPlace');
  const viaLabels = draft.stops.map((stop) => stop.name.trim()).filter((name) => name.length > 0);
  const placeParts = [fromLabel, ...viaLabels, destLabel];
  const departure =
    count > 0 ? formatClockTime(itineraries[0]?.startTime) : null;

  if (draft.dest === null) {
    return (
      <div className="px-5 pt-5">
        <h1 className="text-xl font-bold text-ink">{t('plan.missingDestTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{t('plan.missingDestMessage')}</p>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="mt-4 min-h-12 rounded-md bg-brand px-4 text-sm font-semibold text-white"
        >
          {t('plan.findPlace')}
        </button>
      </div>
    );
  }

  if (draft.from === null) {
    return (
      <div className="px-5 pt-5">
        <h1 className="text-xl font-bold text-ink">
          {draft.hasFrom ? t('plan.badOriginTitle') : t('plan.missingOriginTitle')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          {draft.hasFrom ? t('plan.badOriginMessage') : t('plan.missingOriginMessage')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={editTrip}
            className="min-h-12 rounded-md bg-brand px-4 text-sm font-semibold text-white"
          >
            {t('plan.findPlace')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/search')}
            className="min-h-12 rounded-md border border-line-strong px-4 text-sm font-semibold text-ink-soft"
          >
            {t('plan.backToSearch')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-6">
      <header className="flex items-start gap-2 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {t('home.eyebrow')}
          </p>
          <h1
            aria-label={placeParts.join(' → ')}
            className="mt-1 flex flex-wrap items-center gap-x-1 text-xl font-bold tracking-tight text-ink"
          >
            {placeParts.map((part, index) => (
              <Fragment key={`${part}-${index}`}>
                {index > 0 ? (
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-brand" />
                ) : null}
                <span className="max-w-full truncate">{part}</span>
              </Fragment>
            ))}
          </h1>
          {departure !== null ? (
            <p className="mt-1 text-sm text-ink-soft">{t('routes.depart', { time: departure })}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={editTrip}
          aria-label={t('routes.changeStart')}
          className="flex size-12 shrink-0 items-center justify-center rounded-md border border-line-strong bg-white text-ink-soft shadow-sm transition hover:border-brand hover:text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-5">
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 text-sm font-semibold text-ink"
        >
          {plan.status === 'loading'
            ? t('routes.loading')
            : plan.status === 'success' && count > 0 && !fallbackOnly
              ? t('routes.countSummary', { count, minutes: fastestMinutes })
              : ''}
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {selectionAnnouncement}
        </p>

        {plan.status === 'loading' && showSkeletons ? <SkeletonCards /> : null}

        {plan.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-danger/40 bg-white p-4 shadow-sm"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
              {t('routes.error')}
            </p>
            <button
              type="button"
              onClick={plan.retry}
              className="flex min-h-12 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {plan.status === 'success' && count === 0 ? (
          <Notice
            title={t('routes.emptyBetween', { from: fromLabel, to: destLabel })}
            message={t('routes.emptyHint')}
            actionLabel={t('routes.changeStart')}
            onAction={editTrip}
          />
        ) : null}

        {plan.status === 'success' && count > 0 ? (
          <>
            {fallbackOnly ? null : <FilterChips value={filter} onChange={setFilter} />}
            <ul aria-label={t('routes.title')} className="flex list-none flex-col gap-3">
              {ranked.map((itinerary, index) => {
                const badgeKey = badgeFor(filter, index, itinerary);
                return (
                  <RouteCard
                    key={itinerary.id}
                    itinerary={itinerary}
                    sources={plan.data?.sources ?? []}
                    selected={itinerary.id === selectedId}
                    badge={badgeKey === undefined ? undefined : t(badgeKey)}
                    onSelect={(id) => mapActions.selectItinerary(id)}
                    tripQuery={tripQuery}
                  />
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
