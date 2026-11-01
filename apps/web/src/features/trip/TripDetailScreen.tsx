import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { formatFare } from '../routes/RouteCard';
import { formatClockTime } from '../../lib/time';
import { FareBreakdown } from './FareBreakdown';
import { LegTimeline } from './LegTimeline';
import { isTripSaved, saveTrip } from './savedTrips';

const NO_SOURCES: readonly DataSource[] = [];

export interface TripDetailScreenProps {
  itinerary: ItineraryDto;
  /**
   * Provenance rows from the plan response. Required for the fare source link:
   * the DTO carries source ids, never an attribution table (R43/R45).
   */
  sources?: readonly DataSource[];
  /** Route layer navigation to the static live placeholder. */
  onStartTrip?: () => void;
  /** Optional observer after a successful save; the store write always happens. */
  onSave?: (savedAt: string) => void;
  onBack?: () => void;
}

/**
 * Trip detail (spec §11 screen 4, R62/R63).
 *
 * The screen renders only what the plan response returned: total time, arrival,
 * fare, the leg timeline and the fare breakdown with its own effectivity date
 * and source rows (R45). The summary and CTAs live in a sticky header so a
 * 15-leg itinerary scrolls underneath them instead of pushing Start/Save off
 * screen; the page deliberately has no fixed height or overflow clipping.
 */
export function TripDetailScreen({
  itinerary,
  sources = NO_SOURCES,
  onStartTrip,
  onSave,
  onBack,
}: TripDetailScreenProps) {
  const [saved, setSaved] = useState(() => isTripSaved(itinerary.id));
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const arrival = formatClockTime(itinerary.endTime);

  function handleSave(): void {
    const entry = saveTrip(itinerary, sources);
    if (entry === null) {
      // Storage refused the write (quota, private mode): never claim a save
      // that did not persist, and keep the label honest about what is stored.
      setSaved(isTripSaved(itinerary.id));
      setSaveStatus(
        'Hindi nai-save ang biyahe — puno o naka-off ang storage ng device. Subukan ulit.',
      );
      return;
    }
    setSaved(true);
    setSaveStatus('Nai-save ang biyahe.');
    onSave?.(entry.savedAt);
  }

  return (
    <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+2rem)] text-on-surface">
      <header
        data-testid="trip-header"
        className="sticky top-0 z-20 border-b border-outline-variant bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-3">
          <div className="flex items-start gap-2">
            {onBack !== undefined ? (
              <button
                type="button"
                aria-label="Bumalik"
                onClick={onBack}
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <ArrowLeft aria-hidden="true" className="size-5" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight text-on-surface">
                Detalye ng biyahe
              </h1>
              <p
                data-testid="trip-summary"
                className="break-words text-sm leading-5 text-on-surface-variant"
              >
                {itinerary.durationMin} min · arrive {arrival ?? itinerary.endTime} ·{' '}
                <span data-testid="fare-total" className="font-semibold text-on-surface">
                  ₱{formatFare(itinerary.fare.amount)}
                </span>
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              data-testid="start-trip"
              onClick={onStartTrip}
              className="flex min-h-12 flex-1 items-center justify-center rounded-pill bg-primary px-4 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
            >
              Start trip
            </button>
            <button
              type="button"
              data-testid="save-trip"
              onClick={handleSave}
              className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {saved ? 'Nai-save' : 'I-save'}
            </button>
          </div>
          <p role="status" aria-live="polite" className="min-h-5 text-xs text-on-surface-variant">
            {saveStatus}
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-5">
        <section aria-labelledby="trip-steps-heading">
          <h2
            id="trip-steps-heading"
            className="mb-3 text-xl font-semibold tracking-tight text-on-surface"
          >
            Hakbang-hakbang
          </h2>
          <LegTimeline legs={itinerary.legs} />
        </section>

        <FareBreakdown
          fare={itinerary.fare}
          sources={sources.filter((source) => itinerary.sources.includes(source.id))}
        />
      </div>
    </main>
  );
}
