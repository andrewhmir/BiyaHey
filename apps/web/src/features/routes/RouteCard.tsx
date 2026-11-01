import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { joinAttributions } from '@biyahey/shared';
import { ModeChips } from './ModeChips';

/** The single badge a card may show (spec §11 screen 3). */
export type RouteBadge = 'BEST' | 'CHEAPEST' | 'FEWEST TRANSFERS';

export interface RouteCardProps {
  itinerary: ItineraryDto;
  /**
   * Provenance rows from the same plan response. The card never hardcodes an
   * attribution string (R45): the chip is built from `itinerary.sources` via the
   * browser-safe `joinAttributions` export.
   */
  sources: readonly DataSource[];
  selected: boolean;
  onSelect: (id: string) => void;
  badge?: RouteBadge;
}

/** Arrival times are Philippine local time regardless of the test/device zone. */
const ARRIVAL_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
});

/**
 * Format a PHP amount without recomputing it (R45): whole pesos stay whole,
 * fractional fares keep two decimals.
 */
export function formatFare(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Taglish transfer wording: `direct` for zero, `N sakay` otherwise. */
export function transfersLabel(transfers: number): string {
  return transfers <= 0 ? 'direct' : `${transfers} sakay`;
}

/** Walk total in metres under 1 km, otherwise one decimal of a kilometre. */
export function walkLabel(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(1)} km lakad`;
  }
  return `${Math.round(distanceM)} m lakad`;
}

/**
 * The matrix label for the mandatory fare provenance line, derived strictly
 * from `FareQuote.source_id` (R57). `null` means the quote is a mixed-source
 * sum — or a walk-only trip that bought no ticket — so it must never claim the
 * LTFRB matrix: the response carries no such attribution. An id outside the
 * known fare sources falls back to the generic wording rather than inventing a
 * publisher the API did not send (R45).
 */
export function fareMatrixLabel(fare: FareQuote): string {
  if (fare.source_id === 'ltfrb-fares') {
    return 'LTFRB matrix';
  }
  if (fare.source_id === 'rail-fares') {
    return 'rail fare matrix';
  }
  if (fare.source_id === null) {
    return fare.breakdown.length === 0 ? 'no fare' : 'mixed fare sources';
  }
  return 'fare matrix';
}

/**
 * The mandatory fare provenance line: every displayed fare carries the
 * `effective_from` date the API returned, labelled with the matrix that priced
 * it. The web app never computes or guesses the date (R45).
 */
export function fareEffectiveLine(fare: FareQuote): string {
  return `Fares: ${fareMatrixLabel(fare)} effective ${fare.effective_from}`;
}

function arrivalLabel(endTime: string): string | null {
  const arrival = new Date(endTime);
  if (Number.isNaN(arrival.getTime())) {
    return null;
  }
  return ARRIVAL_FORMATTER.format(arrival);
}

/**
 * Provenance chip body: the attribution of the first two source ids the
 * itinerary actually used, then the L1 "Data sources" affordance.
 */
export function provenanceLabel(
  itinerary: ItineraryDto,
  sources: readonly DataSource[],
): string {
  const requested = itinerary.sources.slice(0, 2);
  const resolved = requested
    .map((sourceId) => sources.find((source) => source.id === sourceId))
    .filter((source): source is DataSource => source !== undefined);

  const attribution = joinAttributions(resolved);
  const missing = requested.length > resolved.length;
  const prefix = attribution.length > 0 ? attribution : missing ? 'source unavailable' : '';
  const missingNote = attribution.length > 0 && missing ? ' · source unavailable' : '';
  return `${prefix}${missingNote}${prefix.length > 0 ? ' · ' : ''}Data sources`;
}

export function RouteCard({
  itinerary,
  sources,
  selected,
  onSelect,
  badge,
}: RouteCardProps) {
  const arrival = arrivalLabel(itinerary.endTime);
  const attribution = provenanceLabel(itinerary, sources);

  return (
    <button
      type="button"
      data-testid="route-card"
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={() => onSelect(itinerary.id)}
      className={`flex w-full flex-col gap-3 rounded-card border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
        selected
          ? 'border-primary bg-surface-container-lowest shadow-elevation-2'
          : 'border-outline-variant bg-surface-container shadow-none'
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-2xl font-bold leading-8 text-on-surface">
            {itinerary.durationMin} min
          </span>
          {arrival !== null ? (
            <span className="text-sm text-on-surface-variant">Dating {arrival}</span>
          ) : null}
        </span>
        {badge !== undefined ? (
          <span
            data-testid="route-badge"
            className="rounded-pill bg-primary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-on-primary"
          >
            {badge}
          </span>
        ) : null}
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
        <span>{transfersLabel(itinerary.transfers)}</span>
        <span aria-hidden="true">·</span>
        <span>{walkLabel(itinerary.walkDistanceM)}</span>
      </span>

      <span className="flex flex-col gap-0.5 rounded-card border border-fare-border bg-fare-bg px-3 py-2 text-on-fare-bg">
        <span className="flex flex-wrap items-center gap-2">
          <span data-testid="fare-amount" className="text-xl font-semibold leading-7">
            ₱{formatFare(itinerary.fare.amount)}
          </span>
          {/* An estimated quote (rail band, free-ride override) is never
              presented as an official matrix fare. Task 6 owns the full
              fare breakdown; the card only flags the confidence. */}
          {itinerary.fare.confidence === 'estimated' ? (
            <span
              data-testid="fare-estimate"
              className="rounded-pill border border-fare-border px-1.5 py-0.5 text-[11px] font-medium leading-4"
            >
              Estimate
            </span>
          ) : null}
        </span>
        <span data-testid="fare-date" className="text-xs leading-4">
          {fareEffectiveLine(itinerary.fare)}
        </span>
      </span>

      <ModeChips modes={itinerary.modes} />

      <span
        data-testid="provenance-chip"
        className="text-[11px] leading-4 text-on-surface-variant"
      >
        {attribution}
        <span aria-hidden="true"> ⓘ</span>
      </span>
    </button>
  );
}
