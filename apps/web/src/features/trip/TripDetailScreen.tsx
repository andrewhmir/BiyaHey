import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { ArrowLeft, Bookmark, BookmarkCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LegStrip } from '../../components/transit/LegStrip';
import {
  isWalkFallback,
  WalkFallbackNotice,
} from '../../components/transit/WalkFallback';
import { useT } from '../../i18n/useT';
import { formatFare, transfersLabel, walkLabel } from '../../lib/format';
import { isTripSaved, saveTrip } from '../../lib/savedTripsStore';
import { formatClockTime, formatLongDate } from '../../lib/time';
import { FareBreakdown } from './FareBreakdown';
import { LegTimeline, legInstruction } from './LegTimeline';

const NO_SOURCES: readonly DataSource[] = [];

/**
 * The state `pages/trip.tsx`'s MapLibre wiring receives (frozen interface).
 *
 * `onSelectLeg(null)` means "back to the whole route"; the map passes a leg
 * index when the rider taps one of the itinerary's lines, and the screen owns
 * the single `selectedLegIndex` both the map and the timeline read.
 */
export interface TripMapRenderState {
  itinerary: ItineraryDto;
  activeLegIndex: number | null;
  onSelectLeg: (index: number | null) => void;
}

/** Draw the trip map; `pages/trip.tsx` supplies the real MapLibre renderer. */
export type TripMapRenderer = (state: TripMapRenderState) => ReactNode;

export interface TripDetailScreenProps {
  itinerary: ItineraryDto;
  /**
   * Provenance rows from the plan response. Required for the fare source link:
   * the DTO carries source ids, never an attribution table (R43/R45).
   */
  sources?: readonly DataSource[];
  /** Route layer navigation to the leg-by-leg live walkthrough. */
  onStartTrip?: () => void;
  /** Optional observer after a successful save; the store write always happens. */
  onSave?: (savedAt: string) => void;
  /**
   * When the itinerary came from the saved-trips store rather than a live plan
   * cache (reload/offline deep link), this is the snapshot's `savedAt`. The
   * header then labels the ETA as a saved snapshot instead of presenting an old
   * plan as current (Task 8; R63).
   */
  savedSnapshotAt?: string;
  onBack?: () => void;
  /**
   * Detail-mode map renderer. When absent the screen shows a same-height
   * neutral placeholder so the layout/tests work without MapLibre loaded.
   */
  renderMap?: TripMapRenderer;
}

/**
 * Trip detail (spec §11 screen 4, spec §2/§4.2, R62/R63).
 *
 * The screen renders only what the plan response returned: total time, arrival,
 * fare, the leg timeline and the fare breakdown with its own effectivity date
 * and source rows (R45). It never recomputes a fare or an ETA.
 *
 * UX v2 layout: a sticky map header at the top (the parent page supplies the
 * MapLibre map through `renderMap`), then a rounded content sheet that scrolls
 * over it. The leg strip is the interactive progress rail; the timeline rows and
 * the map share one `selectedLegIndex` state, so tapping a strip segment, a row
 * header or a leg line on the map focuses the same leg everywhere.
 *
 * The saved-snapshot sentence is mandated English copy inside the Taglish UI,
 * so its paragraph is tagged `lang="en"` (R44); every other string is Taglish.
 */
export function TripDetailScreen({
  itinerary,
  sources = NO_SOURCES,
  onStartTrip,
  onSave,
  savedSnapshotAt,
  onBack,
  renderMap,
}: TripDetailScreenProps) {
  const { t } = useT();
  const [saved, setSaved] = useState(() => isTripSaved(itinerary.id));
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  /** null = whole-itinerary emphasis; a number focuses that leg on map + rows. */
  const [selectedLegIndex, setSelectedLegIndex] = useState<number | null>(null);
  const arrival = formatClockTime(itinerary.endTime);
  const arrivalLabel = arrival ?? itinerary.endTime;
  // A detail opened from the saved store *is* the stored snapshot. Saving again
  // would replace it with the same itinerary but a new `savedAt`, restarting the
  // 30-day staleness clock while the fare stays the old one (M1), so the CTA is
  // deliberately disabled rather than silently re-dating the snapshot.
  const fromSavedStore = savedSnapshotAt !== undefined;
  const walkFallback = isWalkFallback(itinerary);

  const selectedLeg = selectedLegIndex === null ? undefined : itinerary.legs[selectedLegIndex];
  const announcement =
    selectedLeg === undefined
      ? t('trip.focusWhole')
      : t('trip.legFocusAnnounce', {
          index: (selectedLegIndex ?? 0) + 1,
          title: legInstruction(selectedLeg, t),
        });

  function handleSave(): void {
    if (fromSavedStore) {
      return;
    }
    const entry = saveTrip(itinerary, sources);
    if (entry === null) {
      // Storage refused the write (quota, private mode): never claim a save
      // that did not persist, and keep the label honest about what is stored.
      setSaved(isTripSaved(itinerary.id));
      setSaveStatus(t('trip.saveFailed'));
      return;
    }
    setSaved(true);
    setSaveStatus(t('trip.saveOk'));
    onSave?.(entry.savedAt);
  }

  /** Row/strip press focuses that leg; pressing the focused one clears it. */
  function handleSelectLeg(index: number): void {
    setSelectedLegIndex((current) => (current === index ? null : index));
  }

  return (
    <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+2rem)] text-on-surface">
      <header data-testid="trip-header" className="sticky top-0 z-0">
        <div
          data-testid="trip-map"
          role="region"
          aria-label={t('trip.mapLabel')}
          className="relative h-[42dvh] max-h-96 min-h-[240px] w-full overflow-hidden bg-surface-container-low"
        >
          {renderMap !== undefined ? (
            renderMap({
              itinerary,
              activeLegIndex: selectedLegIndex,
              onSelectLeg: setSelectedLegIndex,
            })
          ) : (
            <div
              data-testid="trip-map-placeholder"
              aria-hidden="true"
              className="size-full bg-surface-container-low"
            />
          )}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
            {onBack !== undefined ? (
              <button
                type="button"
                aria-label={t('common.back')}
                onClick={onBack}
                className="flex size-12 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface shadow-elevation-2 transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <ArrowLeft aria-hidden="true" className="size-5" />
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            <button
              type="button"
              data-testid="save-trip-map"
              aria-label={saved ? t('common.saved') : t('common.save')}
              onClick={handleSave}
              disabled={fromSavedStore}
              className="flex size-12 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface shadow-elevation-2 transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saved ? (
                <BookmarkCheck aria-hidden="true" className="size-5" />
              ) : (
                <Bookmark aria-hidden="true" className="size-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 -mt-6 rounded-t-sheet bg-surface shadow-elevation-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-6">
          <div>
            <h1 className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
              {t('trip.title')}
            </h1>
            <p
              data-testid="trip-summary"
              className="mt-1 flex flex-wrap items-baseline gap-x-2 break-words"
            >
              <span className="text-4xl font-extrabold tracking-tight tabular-nums text-on-surface">
                {itinerary.durationMin} min
              </span>
              <span className="text-sm font-medium text-on-surface-variant">
                {t('trip.heroArrive', { arrival: arrivalLabel })}
              </span>
            </p>
            {walkFallback ? (
              <WalkFallbackNotice itinerary={itinerary} className="mt-3" />
            ) : (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-on-surface-variant">
                <span data-testid="fare-total" className="font-semibold text-on-surface">
                  ₱{formatFare(itinerary.fare.amount)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{transfersLabel(itinerary.transfers, t)}</span>
                <span aria-hidden="true">·</span>
                <span>{walkLabel(itinerary.walkDistanceM, t)}</span>
              </p>
            )}
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

          <div>
            {walkFallback ? null : (
              <LegStrip
                legs={itinerary.legs}
                selectedLegIndex={selectedLegIndex}
                onSelectLeg={handleSelectLeg}
                size="md"
                label={t('trip.legStripLabel')}
              />
            )}
            <p className="mt-1 text-xs leading-4 text-on-surface-variant">{t('trip.mapHint')}</p>
            {selectedLegIndex !== null ? (
              <button
                type="button"
                data-testid="trip-whole-route"
                onClick={() => setSelectedLegIndex(null)}
                className="mt-1 inline-flex min-h-12 items-center rounded-pill px-1 text-sm font-semibold text-primary transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {t('trip.wholeRoute')}
              </button>
            ) : null}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="start-trip"
                onClick={onStartTrip}
                className="flex min-h-12 flex-1 items-center justify-center rounded-pill bg-primary px-4 text-base font-semibold text-on-primary shadow-elevation-1 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
              >
                {t('trip.start')}
              </button>
              <button
                type="button"
                data-testid="save-trip"
                onClick={handleSave}
                disabled={fromSavedStore}
                className="flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-container-lowest"
              >
                {saved ? (
                  <BookmarkCheck aria-hidden="true" className="size-4" />
                ) : (
                  <Bookmark aria-hidden="true" className="size-4" />
                )}
                <span>{saved ? t('common.saved') : t('common.save')}</span>
              </button>
            </div>
            <p
              role="status"
              aria-live="polite"
              className="min-h-5 text-xs text-on-surface-variant"
            >
              {saveStatus}
            </p>
            <p data-testid="leg-announce" aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </div>

          <section aria-labelledby="trip-steps-heading">
            <h2
              id="trip-steps-heading"
              className="mb-3 text-xl font-bold tracking-tight text-on-surface"
            >
              {t('trip.steps')}
            </h2>
            <LegTimeline
              legs={itinerary.legs}
              selectedLegIndex={selectedLegIndex}
              onSelectLeg={handleSelectLeg}
            />
          </section>

          {walkFallback ? null : (
            <FareBreakdown
              fare={itinerary.fare}
              sources={sources.filter((source) => itinerary.sources.includes(source.id))}
            />
          )}
        </div>
      </div>
    </main>
  );
}
