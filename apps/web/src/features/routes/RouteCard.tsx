import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { memo } from 'react';
import { ProvenanceChip } from '../../components/provenance/ProvenanceChip';
import { LegStrip } from '../../components/transit/LegStrip';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { formatFare, transfersLabel, walkLabel } from '../../lib/format';

/**
 * The single badge a card may show (spec §11 screen 3). `BEST` belongs to the
 * Recommended consensus lead alone; every single-criterion chip names its own
 * criterion, so a fare lead and the Recommended lead can never both read
 * `BEST` (the reported contradiction).
 */
export type RouteBadge = 'BEST' | 'CHEAPEST' | 'FEWEST TRANSFERS' | 'LEAST WALKING';

const BADGE_KEYS: Record<RouteBadge, string> = {
  BEST: 'routes.badgeBest',
  CHEAPEST: 'routes.badgeCheapest',
  'FEWEST TRANSFERS': 'routes.badgeFewestTransfers',
  'LEAST WALKING': 'routes.badgeLeastWalking',
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
 * One route alternative, Kalsada v2 (spec §2 route options, §4.1).
 *
 * Anatomy, top to bottom: the big ETA + arrival line with the single badge and
 * the API fare on the right; the signature leg-strip ribbon (the Moovit-style
 * "paths you will take"); the transfers/walk meta line; and the mandatory fare
 * provenance line (matrix + effectivity date, R45/R57) with an `estimate` chip
 * when the quote is not official.
 *
 * The select action is a full-card overlay button: it keeps the whole card
 * tappable and keyboard-operable with a short accessible name, while the card
 * content (including the leg-strip `<ol>`) stays outside the button. A `<button>`
 * may only contain phrasing content and its descendant semantics are suppressed
 * by `childrenPresentational`, so nesting the ordered list inside it would be
 * both invalid HTML and a lost list to screen readers (review I2). The
 * provenance chip is the only interactive content above the overlay.
 */
export const RouteCard = memo(function RouteCard({
  itinerary,
  sources,
  selected,
  onSelect,
  badge,
}: RouteCardProps) {
  const { t } = useT();
  const arrival = arrivalLabel(itinerary.endTime);
  const cardName = `${itinerary.durationMin} min, ₱${formatFare(itinerary.fare.amount)}, ${transfersLabel(
    itinerary.transfers,
    t,
  )}, ${walkLabel(itinerary.walkDistanceM, t)}`;

  return (
    <div
      data-testid="route-card"
      data-selected={selected ? 'true' : 'false'}
      className={`relative flex w-full flex-col overflow-hidden rounded-card bg-surface-container-lowest transition ${
        selected ? 'shadow-elevation-2' : 'shadow-none'
      }`}
    >
      {/* The select action: a full-card overlay with a short, honest name. The
          focus ring is drawn INSIDE the box: the card clips overflow, so a
          positive outline offset would render the ring outside the clip box and
          keyboard users would see no focus indicator (WCAG 2.4.7). */}
      <button
        type="button"
        data-testid="route-card-select"
        aria-pressed={selected}
        aria-label={cardName}
        onClick={() => onSelect(itinerary.id)}
        className={`absolute inset-0 rounded-card border text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring ${
          selected
            ? 'border-primary ring-2 ring-primary-container'
            : 'border-outline-variant hover:border-outline'
        }`}
      />

      <div className="pointer-events-none relative z-10 flex w-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span
              data-testid="route-eta"
              className="text-2xl font-bold leading-8 tracking-tight text-on-surface"
            >
              {itinerary.durationMin} min
            </span>
            {arrival !== null ? (
              <span className="text-sm leading-5 text-on-surface-variant">
                {t('routes.arrive', { time: arrival })}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {badge !== undefined ? (
              <span
                data-testid="route-badge"
                className="rounded-pill bg-primary px-2.5 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.08em] text-on-primary"
              >
                {t(BADGE_KEYS[badge])}
              </span>
            ) : null}
            <span
              data-testid="fare-amount"
              className="text-2xl font-extrabold leading-8 tracking-tight text-on-surface"
            >
              ₱{formatFare(itinerary.fare.amount)}
            </span>
          </div>
        </div>

        {/* The signature leg ribbon: one proportional, mode-coloured segment
            per leg. The card's text already names each leg, so colour is never
            the only channel. It stays outside the overlay button so the ordered
            list semantics survive (review I2). */}
        <LegStrip legs={itinerary.legs} size="sm" />

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-on-surface-variant">
          <span>{transfersLabel(itinerary.transfers, t)}</span>
          <span aria-hidden="true">·</span>
          <span>{walkLabel(itinerary.walkDistanceM, t)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mandatory provenance: every displayed fare carries the matrix and
              the effectivity date the API returned (R45/R57). */}
          <span data-testid="fare-date" className="text-xs leading-4 text-on-surface-variant">
            {fareEffectiveLine(itinerary.fare, t)}
          </span>
          {/* An estimated quote (rail band, free-ride override) is never
              presented as an official matrix fare. */}
          {itinerary.fare.confidence === 'estimated' ? (
            <span
              data-testid="fare-estimate"
              className="rounded-pill border border-fare-border bg-fare-bg px-2 py-0.5 text-[11px] font-semibold leading-4 text-on-fare-bg"
            >
              {t('common.estimate')}
            </span>
          ) : null}
        </div>
      </div>

      {/* The chip lives beside the select action, above the overlay: a link
          inside the overlay button would be invalid nesting and would also
          select the card when the rider only wanted the provenance detail. */}
      <div className="relative z-20 border-t border-outline-variant px-4 pb-2">
        <ProvenanceChip sourcesFromItinerary={itinerary.sources} knownSources={sources} />
      </div>
    </div>
  );
});
