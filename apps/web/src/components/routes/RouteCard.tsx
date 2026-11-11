import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Translate } from '../../copy';
import { useCopy } from '../../i18n';
import { distanceLabel, fareLabel, formatClockTime, transfersLabel } from '../../lib/format';
import { ModeRibbon } from './ModeRibbon';
import { isWalkFallback, WalkEstimateBadge, WalkFallbackNotice } from './WalkFallback';

/** The matrix label a fare must carry; never invents a publisher. */
function fareMatrixLabel(fare: FareQuote, t: Translate): string {
  if (fare.source_id === 'ltfrb-fares') return t('routes.fareMatrixLtfrb');
  if (fare.source_id === 'rail-fares') return t('routes.fareMatrixRail');
  if (fare.source_id === null) {
    return fare.breakdown.length === 0 ? t('routes.fareNone') : t('routes.fareMixed');
  }
  return t('routes.fareMatrixGeneric');
}

/** The source row that priced a fare, when the plan response carried it. */
function fareSourceName(fare: FareQuote, sources: readonly DataSource[]): string | null {
  if (fare.source_id === null) return null;
  return sources.find((source) => source.id === fare.source_id)?.name ?? null;
}

export interface RouteCardProps {
  itinerary: ItineraryDto;
  sources: readonly DataSource[];
  selected: boolean;
  /** Translated badge label for the lead card of the active ranking. */
  badge?: string;
  /** Selects this itinerary on the map (and in the emphasised card state). */
  onSelect: (id: string) => void;
  /** Labelled trip query forwarded to `/trip/:id` so place names survive. */
  tripQuery: string;
}

/**
 * One route option, fare-first: duration and arrival, the fare with its
 * matrix/source provenance, the mode ribbon, transfers and walk distance.
 * The card body selects the option on the map so a rider can compare the 3–5
 * alternatives; its footer action opens the trip.
 */
export function RouteCard({
  itinerary,
  sources,
  selected,
  badge,
  onSelect,
  tripQuery,
}: RouteCardProps) {
  const { t } = useCopy();
  const walkFallback = isWalkFallback(itinerary);
  const partialFare = itinerary.fareIncomplete === true;
  const arrival = formatClockTime(itinerary.endTime);
  const sourceName = fareSourceName(itinerary.fare, sources);
  const fareDateLine = t('routes.fareLine', {
    matrix: fareMatrixLabel(itinerary.fare, t),
    date: itinerary.fare.effective_from,
  });
  const summary = walkFallback
    ? `${t('walkFallback.badge')}, ${itinerary.durationMin} min, ${distanceLabel(itinerary.walkDistanceM)}`
    : [
        `${itinerary.durationMin} min`,
        fareLabel(itinerary.fare.amount),
        transfersLabel(itinerary.transfers, t),
        t('routes.walk', { distance: distanceLabel(itinerary.walkDistanceM) }),
      ].join(', ');

  return (
    <li>
      <div
        data-selected={selected ? 'true' : 'false'}
        className={`relative overflow-hidden rounded-lg bg-white transition ${
          selected
            ? 'border border-brand bg-brand-tint/30 shadow-md ring-2 ring-brand-tint'
            : 'border border-line shadow-sm hover:border-brand hover:shadow-md'
        }`}
      >
        {/* Card body: select only — comparing options on the map comes first. */}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={summary}
          onClick={() => onSelect(itinerary.id)}
          className="absolute inset-0 z-10 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
        />

        <div className="pointer-events-none relative z-20 flex flex-col gap-2.5 px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-2xl font-bold leading-7 tracking-tight text-ink">
                {itinerary.durationMin} min
              </span>
              {arrival !== null ? (
                <span className="mt-0.5 block text-sm text-ink-soft">
                  {t('routes.arrive', { time: arrival })}
                </span>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              {walkFallback ? (
                <WalkEstimateBadge />
              ) : (
                <>
                  {badge !== undefined ? (
                    <span className="rounded-sm bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {badge}
                    </span>
                  ) : null}
                  <span className="text-xl font-bold leading-7 text-ink">
                    {fareLabel(itinerary.fare.amount)}
                  </span>
                  {partialFare ? (
                    <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                      {t('fare.partial')}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {walkFallback ? (
            <WalkFallbackNotice itinerary={itinerary} />
          ) : (
            <>
              <ModeRibbon legs={itinerary.legs} />

              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-soft">
                <span>{transfersLabel(itinerary.transfers, t)}</span>
                <span aria-hidden="true">·</span>
                <span>{t('routes.walk', { distance: distanceLabel(itinerary.walkDistanceM) })}</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-faint">
                <span>{fareDateLine}</span>
                {sourceName !== null ? (
                  <span className="min-w-0 truncate">
                    · {t('fare.source')} {sourceName}
                  </span>
                ) : null}
                {itinerary.fare.confidence === 'estimated' ? (
                  <span className="rounded-sm border border-line-strong px-1.5 py-0.5 font-semibold uppercase tracking-wide text-ink-soft">
                    {t('common.estimate')}
                  </span>
                ) : null}
              </div>

              {partialFare ? (
                <p className="flex items-start gap-1.5 text-xs leading-5 text-ink-soft">
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-warning"
                  />
                  {t('fare.incomplete')}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="pointer-events-none relative z-20 flex min-h-12 items-center justify-between gap-2 border-t border-line px-3">
          <span className="flex items-center gap-1 text-xs font-semibold text-brand">
            {selected ? (
              <>
                <Check aria-hidden="true" className="size-4" />
                {t('map.routeLegendSelected')}
              </>
            ) : null}
          </span>
          <Link
            to={`/trip/${encodeURIComponent(itinerary.id)}${
              tripQuery.length > 0 ? `?${tripQuery}` : ''
            }`}
            aria-label={t('routes.detailActionLabel', { minutes: itinerary.durationMin })}
            className="pointer-events-auto flex min-h-12 items-center gap-1 px-1 text-sm font-semibold text-brand transition hover:text-brand-strong"
          >
            {t('routes.detailAction')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </li>
  );
}
