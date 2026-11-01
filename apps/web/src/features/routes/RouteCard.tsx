import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { ProvenanceChip } from '../../components/provenance/ProvenanceChip';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { ModeChips } from './ModeChips';

/** The single badge a card may show (spec §11 screen 3). */
export type RouteBadge = 'BEST' | 'CHEAPEST' | 'FEWEST TRANSFERS';

const BADGE_KEYS: Record<RouteBadge, string> = {
  BEST: 'routes.badgeBest',
  CHEAPEST: 'routes.badgeCheapest',
  'FEWEST TRANSFERS': 'routes.badgeFewestTransfers',
};

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
export function transfersLabel(transfers: number, t: Translate = defaultT): string {
  return transfers <= 0 ? t('routes.direct') : t('routes.transfers', { count: transfers });
}

/** Walk total in metres under 1 km, otherwise one decimal of a kilometre. */
export function walkLabel(distanceM: number, t: Translate = defaultT): string {
  const distance =
    distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
  return t('routes.walk', { distance });
}

/**
 * The matrix label for the mandatory fare provenance line, derived strictly
 * from `FareQuote.source_id` (R57). `null` means the quote is a mixed-source
 * sum — or a walk-only trip that bought no ticket — so it must never claim the
 * LTFRB matrix: the response carries no such attribution. An id outside the
 * known fare sources falls back to the generic wording rather than inventing a
 * publisher the API did not send (R45).
 */
export function fareMatrixLabel(fare: FareQuote, t: Translate = defaultT): string {
  if (fare.source_id === 'ltfrb-fares') {
    return t('routes.fareMatrixLtfrb');
  }
  if (fare.source_id === 'rail-fares') {
    return t('routes.fareMatrixRail');
  }
  if (fare.source_id === null) {
    return fare.breakdown.length === 0 ? t('routes.fareNone') : t('routes.fareMixed');
  }
  return t('routes.fareMatrixGeneric');
}

/**
 * The mandatory fare provenance line: every displayed fare carries the
 * `effective_from` date the API returned, labelled with the matrix that priced
 * it. The web app never computes or guesses the date (R45).
 */
export function fareEffectiveLine(fare: FareQuote, t: Translate = defaultT): string {
  return t('routes.fareLine', {
    matrix: fareMatrixLabel(fare, t),
    date: fare.effective_from,
  });
}

function arrivalLabel(endTime: string): string | null {
  const arrival = new Date(endTime);
  if (Number.isNaN(arrival.getTime())) {
    return null;
  }
  return ARRIVAL_FORMATTER.format(arrival);
}

/**
 * Provenance chip body is owned by the shared `ProvenanceChip` (Task 7); the
 * route card only supplies the itinerary's ids and the response's rows.
 */
export function RouteCard({ itinerary, sources, selected, onSelect, badge }: RouteCardProps) {
  const { t } = useT();
  const arrival = arrivalLabel(itinerary.endTime);

  return (
    <div
      className={`flex w-full flex-col rounded-card border transition ${
        selected
          ? 'border-primary bg-surface-container-lowest shadow-elevation-2'
          : 'border-outline-variant bg-surface-container shadow-none'
      }`}
    >
      <button
        type="button"
        data-testid="route-card"
        data-selected={selected ? 'true' : 'false'}
        aria-pressed={selected}
        onClick={() => onSelect(itinerary.id)}
        className="flex w-full flex-col gap-3 rounded-card p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="flex flex-col">
            <span data-testid="route-eta" className="text-2xl font-bold leading-8 text-on-surface">
              {itinerary.durationMin} min
            </span>
            {arrival !== null ? (
              <span className="text-sm text-on-surface-variant">
                {t('routes.arrive', { time: arrival })}
              </span>
            ) : null}
          </span>
          {badge !== undefined ? (
            <span
              data-testid="route-badge"
              className="rounded-pill bg-primary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-on-primary"
            >
              {t(BADGE_KEYS[badge])}
            </span>
          ) : null}
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
          <span>{transfersLabel(itinerary.transfers, t)}</span>
          <span aria-hidden="true">·</span>
          <span>{walkLabel(itinerary.walkDistanceM, t)}</span>
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
                {t('common.estimate')}
              </span>
            ) : null}
          </span>
          <span data-testid="fare-date" className="text-xs leading-4">
            {fareEffectiveLine(itinerary.fare, t)}
          </span>
        </span>

        <ModeChips modes={itinerary.modes} />
      </button>

      {/* Task 7: the chip lives beside the select action, not inside it — a
          link nested in a button would be invalid and would also select the
          card when the rider only wanted the provenance detail. */}
      <div className="px-4 pb-3">
        <ProvenanceChip sourcesFromItinerary={itinerary.sources} knownSources={sources} />
      </div>
    </div>
  );
}
