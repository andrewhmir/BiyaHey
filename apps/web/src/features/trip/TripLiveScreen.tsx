import type { ItineraryDto } from '@biyahey/shared';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { LegStrip } from '../../components/transit/LegStrip';
import { modeLabel } from '../../components/transit/modeMeta';
import {
  isWalkFallback,
  WalkEstimateBadge,
  WalkFallbackNotice,
  walkFallbackStat,
} from '../../components/transit/WalkFallback';
import { useT } from '../../i18n/useT';
import { formatFare } from '../../lib/format';
import { formatLongDate } from '../../lib/time';
import { cachedTrip } from '../routes/planCache';
import type { TripMapRenderer } from './TripDetailScreen';
import { legInstruction, legStatText, signageText } from './LegTimeline';

export type { TripMapRenderState, TripMapRenderer } from './TripDetailScreen';

export interface TripLiveScreenProps {
  /** Map renderer; `activeLegIndex` is the current walkthrough step. */
  renderMap?: TripMapRenderer;
  /** Preferred itinerary; when absent the plan cache is read via `itineraryId`. */
  itinerary?: ItineraryDto;
  itineraryId?: string;
  /**
   * Snapshot date when this trip came from the saved-trips store. The screen
   * keeps the same saved-snapshot honesty copy as the trip detail (R63).
   */
  savedSnapshotAt?: string;
  onBack?: () => void;
}

/** Step progress keyed by itinerary id, so a changed trip starts at step 1. */
interface WalkthroughProgress {
  itineraryId: string | undefined;
  stepIndex: number;
  finished: boolean;
}

const INITIAL_PROGRESS: WalkthroughProgress = { itineraryId: undefined, stepIndex: 0, finished: false };

/**
 * Leg-by-leg live walkthrough (spec §9 "no real-time", spec §2/§4.3).
 *
 * v1 has no GTFS-RT feed, so this screen never claims live data: the mandated
 * "no live data — expected wait" banner and the Taglish honesty sentence stay
 * visible while the rider steps through the *planned* itinerary one leg at a
 * time. It makes no geolocation call and recalculates no ETA — `stepIndex` is
 * pure UI state and every time/fare shown is the API's cached value.
 *
 * State machine: `stepIndex` in `[0, legs.length - 1]` plus `finished`. "Susunod"
 * on the last step finishes the walkthrough; "Ulitin mula sa simula" resets it.
 * `pages/trip.tsx` supplies the MapLibre renderer, whose highlighted leg follows
 * the same step state (`activeLegIndex = finished ? last : stepIndex`).
 */
export function TripLiveScreen({
  renderMap,
  itinerary: itineraryProp,
  itineraryId,
  savedSnapshotAt,
  onBack,
}: TripLiveScreenProps) {
  const { t } = useT();
  const resolved =
    itineraryProp ??
    (itineraryId === undefined ? undefined : cachedTrip(itineraryId)?.itinerary);
  const itineraryKey = resolved?.id;
  const [progress, setProgress] = useState<WalkthroughProgress>(INITIAL_PROGRESS);

  const header = (
    <header className="sticky top-0 z-20 border-b border-outline-variant bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
        {onBack !== undefined ? (
          <button
            type="button"
            aria-label={t('trip.liveExit')}
            onClick={onBack}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        ) : null}
        <h1 className="text-lg font-bold tracking-tight text-on-surface">{t('trip.liveTitle')}</h1>
      </div>
    </header>
  );

  if (resolved === undefined || resolved.legs.length === 0) {
    return (
      <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+2rem)] text-on-surface">
        {header}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
          <p
            data-testid="live-no-cached"
            className="rounded-card border border-outline-variant bg-surface-container-low px-4 py-4 text-sm leading-6 text-on-surface"
          >
            {t('trip.noCached')}
          </p>
        </div>
      </main>
    );
  }

  const itinerary = resolved;
  const legs = itinerary.legs;
  const walkFallback = isWalkFallback(itinerary);
  const lastIndex = legs.length - 1;
  const stale = progress.itineraryId !== itineraryKey;
  const stepIndex = stale ? 0 : Math.min(Math.max(0, progress.stepIndex), lastIndex);
  const finished = stale ? false : progress.finished;
  const currentLeg = legs[stepIndex]!;
  const activeLegIndex = finished ? lastIndex : stepIndex;

  const announcement = finished
    ? t('trip.liveFinish')
    : t('trip.liveAnnounce', {
        index: stepIndex + 1,
        total: legs.length,
        title: legInstruction(currentLeg, t),
      });

  function goNext(): void {
    if (stepIndex >= lastIndex) {
      setProgress({ itineraryId: itineraryKey, stepIndex, finished: true });
      return;
    }
    setProgress({ itineraryId: itineraryKey, stepIndex: stepIndex + 1, finished: false });
  }

  function goPrev(): void {
    setProgress({
      itineraryId: itineraryKey,
      stepIndex: Math.max(0, stepIndex - 1),
      finished: false,
    });
  }

  function startOver(): void {
    setProgress({ itineraryId: itineraryKey, stepIndex: 0, finished: false });
  }

  /** A leg line tapped on the map jumps the walkthrough to that leg. */
  function selectLegFromMap(index: number | null): void {
    if (index === null) {
      return;
    }
    setProgress({
      itineraryId: itineraryKey,
      stepIndex: Math.min(Math.max(0, index), lastIndex),
      finished: false,
    });
  }

  return (
    <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+2rem)] text-on-surface">
      {header}

      <div
        data-testid="live-map"
        role="region"
        aria-label={t('trip.liveMapLabel')}
        className="relative h-[34dvh] max-h-72 min-h-[200px] w-full overflow-hidden bg-surface-container-low"
      >
        {renderMap !== undefined ? (
          renderMap({ itinerary, activeLegIndex, onSelectLeg: selectLegFromMap })
        ) : (
          <div
            data-testid="live-map-placeholder"
            aria-hidden="true"
            className="size-full bg-surface-container-low"
          />
        )}
      </div>

      <div className="relative z-10 -mt-6 rounded-t-sheet bg-surface shadow-elevation-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-10 pt-6">
          <div>
            <p data-testid="live-trip-summary" className="text-sm text-on-surface-variant">
              {walkFallback ? (
                <>
                  <WalkEstimateBadge /> <span>{walkFallbackStat(itinerary, t)}</span>
                </>
              ) : (
                <>
                  {itinerary.durationMin} min
                  {` · ₱${formatFare(itinerary.fare.amount)}`}
                </>
              )}
              {savedSnapshotAt === undefined ? ` · ${t('trip.cachedPlan')}` : ''}
            </p>
            {savedSnapshotAt !== undefined ? (
              <p
                data-testid="saved-snapshot-note"
                lang="en"
                className="mt-1 break-words text-xs leading-4 text-on-surface-variant"
              >
                {t('trip.savedNote', {
                  label: t('trip.savedRoute'),
                  date: formatLongDate(savedSnapshotAt) ?? savedSnapshotAt,
                })}
              </p>
            ) : null}
          </div>

          <section
            role="status"
            aria-live="polite"
            data-testid="live-banner"
            className="rounded-card border border-outline-variant bg-surface-container-low px-4 py-3"
          >
            {walkFallback ? (
              // Badge and walking stat live in the summary above, so the live
              // banner repeats the honest copy and the >25 km warning only.
              <WalkFallbackNotice
                itinerary={itinerary}
                badge={false}
                stat={false}
                variant="compact"
              />
            ) : (
              <>
                <p lang="en" className="text-sm font-semibold text-on-surface">
                  {t('trip.liveBanner')}
                </p>
                <p className="mt-1 text-sm leading-5 text-on-surface-variant">
                  {t('trip.liveBody')}
                </p>
              </>
            )}
            <p className="mt-1 text-sm leading-5 text-on-surface-variant">
              {t('trip.liveHonesty')}
            </p>
          </section>

          <section
            data-testid="live-progress"
            className="rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-3 shadow-elevation-1"
          >
            <p className="text-sm font-semibold text-on-surface">
              {t('trip.liveProgress', { index: stepIndex + 1, total: legs.length })} ·{' '}
              {modeLabel(currentLeg.mode, t)}
            </p>
            {/* A fallback has no transit leg to step through; the walking
                estimate is stated once above rather than implying a route. */}
            {walkFallback ? null : (
              <LegStrip
                legs={legs}
                selectedLegIndex={finished ? lastIndex : stepIndex}
                size="sm"
                className="mt-2"
              />
            )}
            <p data-testid="live-announce" aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </section>

          {finished ? (
            <section
              data-testid="live-finish"
              className="rounded-card border border-primary-container bg-primary-container px-4 py-6 text-center"
            >
              <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-primary" />
              <h2 className="mt-2 text-xl font-extrabold tracking-tight text-on-surface">
                {t('trip.liveFinish')}
              </h2>
              <p className="mt-1 text-sm leading-5 text-on-surface-variant">
                {t('trip.liveFinishBody')}
              </p>
              <button
                type="button"
                data-testid="live-start-over"
                onClick={startOver}
                className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-5 text-base font-semibold text-on-primary shadow-elevation-1 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                {t('trip.liveStartOver')}
              </button>
              {onBack !== undefined ? (
                <button
                  type="button"
                  data-testid="live-exit"
                  onClick={onBack}
                  className="mt-2 flex min-h-12 w-full items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-5 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {t('trip.liveExit')}
                </button>
              ) : null}
            </section>
          ) : (
            <>
              <section
                data-testid="live-current-leg"
                aria-labelledby="live-current-heading"
                className="rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-4 shadow-elevation-2"
              >
                <p
                  id="live-current-heading"
                  className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant"
                >
                  {t('trip.liveCurrent')} · {t('trip.legNumber', { index: stepIndex + 1 })}
                </p>
                <p
                  data-testid="live-instruction"
                  className="mt-1 break-words text-xl font-bold leading-7 text-on-surface"
                >
                  {legInstruction(currentLeg, t)}
                </p>
                <p className="mt-1 break-words text-sm leading-5 text-on-surface-variant">
                  {legStatText(currentLeg, t)}
                </p>
                {currentLeg.mode === 'walk' ? null : (
                  <>
                    <p
                      data-testid="live-signage"
                      className="mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-pill border border-outline-variant bg-surface-container-low px-3 py-1.5 text-sm text-on-surface"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                        {t('trip.signageLabel')}
                      </span>
                      <span className="min-w-0 break-words font-medium">
                        {signageText(currentLeg, t)}
                      </span>
                    </p>
                    <p
                      data-testid="live-alight"
                      className="mt-1 break-words text-sm text-on-surface-variant"
                    >
                      {t('trip.alightAt', { place: currentLeg.to.name })}
                    </p>
                  </>
                )}
                {currentLeg.stops !== undefined && currentLeg.stops.length > 1 ? (
                  <p
                    data-testid="live-stop-counter"
                    className="mt-1 break-words text-sm text-on-surface-variant"
                  >
                    {t('trip.stopCounter', {
                      count: currentLeg.stops.length - 1,
                      place: currentLeg.to.name,
                    })}
                  </p>
                ) : null}
              </section>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="live-prev"
                  onClick={goPrev}
                  disabled={stepIndex === 0}
                  className="flex min-h-12 flex-1 items-center justify-center gap-1 rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-container-lowest"
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                  {t('trip.livePrev')}
                </button>
                <button
                  type="button"
                  data-testid="live-next"
                  onClick={goNext}
                  className="flex min-h-12 flex-1 items-center justify-center gap-1 rounded-pill bg-primary px-4 text-base font-semibold text-on-primary shadow-elevation-1 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
                >
                  {t('trip.liveNext')}
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
