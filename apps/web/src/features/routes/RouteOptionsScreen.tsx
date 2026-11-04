import type { ItineraryDto, PlanPlaceInput, PlanStopInput } from '@biyahey/shared';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { isWalkFallback } from '../../components/transit/WalkFallback';
import type { Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { formatClockTime } from '../../lib/time';
import { FilterChips } from './FilterChips';
import { RouteCard, type RouteBadge } from './RouteCard';
import { usePlan, type PlanOutcome } from './usePlan';

/** Skeletons never flash: they appear only once the plan is still pending at 300 ms. */
export const SKELETON_DELAY_MS = 300;

export type RouteFilter = 'recommended' | 'cheapest' | 'fewest-transfers' | 'less-walking';

/** A filter chip is a value plus the string key it renders (Task 9 i18n). */
export interface RouteFilterOption {
  value: RouteFilter;
  labelKey: string;
}

export const FILTER_OPTIONS: readonly RouteFilterOption[] = [
  { value: 'recommended', labelKey: 'routes.filterRecommended' },
  { value: 'cheapest', labelKey: 'routes.filterCheapest' },
  { value: 'fewest-transfers', labelKey: 'routes.filterFewestTransfers' },
  { value: 'less-walking', labelKey: 'routes.filterLessWalking' },
];

/**
 * The four criteria the filter chips expose, in the same fallback order the
 * single-criterion filters already use. Recommended has no criterion of its
 * own to show, so it has to score on exactly what the chips offer.
 */
const CONSENSUS_CRITERIA: readonly ((itinerary: ItineraryDto) => number)[] = [
  (itinerary) => itinerary.durationMin,
  (itinerary) => itinerary.fare.amount,
  (itinerary) => itinerary.transfers,
  (itinerary) => itinerary.walkDistanceM,
];

/**
 * A value's competition rank within one criterion: 1 + the number of values
 * strictly better (lower). Equal values share the best rank — `[10, 20, 20,
 * 30]` ranks as `[1, 2, 2, 4]` — because that is what the chips themselves
 * claim: two routes at the same fare are both "the cheapest", so a tie must not
 * reward whichever one the API happened to list first.
 */
function competitionRank(value: number, values: readonly number[]): number {
  let rank = 1;
  for (const other of values) {
    if (other < value) {
      rank += 1;
    }
  }
  return rank;
}

/** How an itinerary fares across the four criteria the chips expose. */
interface ConsensusProfile {
  /** Number of criteria on which this itinerary is outright best (rank 1). */
  wins: number;
  /** Sum of its competition ranks; smaller is the more balanced compromise. */
  score: number;
}

/** Only the recommended branch builds profiles; this is an unreachable default. */
const NO_PROFILE: ConsensusProfile = { wins: 0, score: 0 };

/**
 * The consensus profile of every itinerary: how many of the four chips it wins
 * outright, plus the sum of its competition ranks. The wins count says which
 * option the chips converge on; the rank-sum only separates options that win
 * the same number of criteria. See `rankItineraries` for why wins lead.
 */
function consensusProfiles(
  itineraries: readonly ItineraryDto[],
): ReadonlyMap<ItineraryDto, ConsensusProfile> {
  const valuesByCriterion = CONSENSUS_CRITERIA.map((read) => itineraries.map(read));
  const profiles = new Map<ItineraryDto, ConsensusProfile>();
  for (const itinerary of itineraries) {
    const profile: ConsensusProfile = { wins: 0, score: 0 };
    CONSENSUS_CRITERIA.forEach((read, criterionIndex) => {
      const rank = competitionRank(read(itinerary), valuesByCriterion[criterionIndex] ?? []);
      profile.score += rank;
      if (rank === 1) {
        profile.wins += 1;
      }
    });
    profiles.set(itinerary, profile);
  }
  return profiles;
}

/**
 * Local re-rank of the same itinerary array (spec §9).
 *
 * Every filter is deterministic and stable: ties fall back to the next field
 * and then keep the API's ETA order. No filter changes the query, so no chip
 * can cause a refetch.
 *
 * Recommended is deliberately not pure ETA order: the screen offers four chips,
 * so Recommended has to agree with what they say. It ranks by two consensus
 * keys over the same four criteria the chips expose (durationMin, fare,
 * transfers, walkDistanceM), each scored with a competition rank (1 + the
 * number of strictly better values; ties share the best rank):
 *   1. `wins` DESCENDING — the number of criteria the itinerary is outright
 *      best on. This is primary because it is what the chips converge on: a
 *      rider who presses Cheapest, then Less walking, must not go back to
 *      Recommended and be told a different option is BEST.
 *   2. rank-sum ASCENDING — among options that win the same number of
 *      criteria, the balanced compromise leads.
 * Then durationMin → fare → transfers → walkDistanceM, and genuine ties keep
 * the API's original order (Array#sort is stable).
 *
 * The rank-sum cannot lead on its own: on a real Cubao → Manila plan the option
 * that wins duration, fare and walking (45 min, ₱24.50, 886 m) has one
 * transfer, and a pure rank-sum put a 60 min, 0-transfer option above it —
 * which brought the original "Recommended disagrees with the chips" bug back.
 * With wins first, the three-criteria option leads and the rank-sum only
 * separates options that each win a single chip.
 */
export function rankItineraries(
  itineraries: readonly ItineraryDto[],
  filter: RouteFilter,
): ItineraryDto[] {
  const ranked = [...itineraries];
  // Only Recommended needs whole-array consensus profiles; the
  // single-criterion filters stay one cheap comparator each.
  const profiles = filter === 'recommended' ? consensusProfiles(ranked) : null;
  ranked.sort((a, b) => {
    switch (filter) {
      case 'cheapest':
        return (
          a.fare.amount - b.fare.amount ||
          a.durationMin - b.durationMin ||
          a.walkDistanceM - b.walkDistanceM
        );
      case 'fewest-transfers':
        return (
          a.transfers - b.transfers ||
          a.durationMin - b.durationMin ||
          a.fare.amount - b.fare.amount
        );
      case 'less-walking':
        return (
          a.walkDistanceM - b.walkDistanceM ||
          a.durationMin - b.durationMin ||
          a.fare.amount - b.fare.amount
        );
      case 'recommended':
      default: {
        // `profiles` is set for `recommended`; the other branches return first.
        const profileA = profiles?.get(a) ?? NO_PROFILE;
        const profileB = profiles?.get(b) ?? NO_PROFILE;
        return (
          profileB.wins - profileA.wins ||
          profileA.score - profileB.score ||
          a.durationMin - b.durationMin ||
          a.fare.amount - b.fare.amount ||
          a.transfers - b.transfers ||
          a.walkDistanceM - b.walkDistanceM
        );
      }
    }
  });
  return ranked;
}

/**
 * Exactly one badge, on the lead card of the active ranking. `BEST` is reserved
 * for Recommended's consensus lead; every single-criterion chip names its own
 * criterion instead, so the fare lead and the Recommended lead can never both
 * claim `BEST`.
 */
export function badgeFor(filter: RouteFilter, index: number): RouteBadge | undefined {
  if (index !== 0) {
    return undefined;
  }
  if (filter === 'cheapest') {
    return 'CHEAPEST';
  }
  if (filter === 'fewest-transfers') {
    return 'FEWEST TRANSFERS';
  }
  if (filter === 'less-walking') {
    return 'LEAST WALKING';
  }
  return 'BEST';
}

/** True only after `active` has stayed true for the whole delay window. */
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

function statusMessage(
  plan: PlanOutcome,
  count: number,
  fallbackOnly: boolean,
  t: Translate,
): string {
  switch (plan.status) {
    case 'loading':
      return t('routes.loading');
    case 'error':
      // The assertive `role="alert"` below is the single announcement for the
      // error state (m4, same pattern as About data): keep the polite region
      // silent so screen readers do not hear the sentence twice.
      return '';
    case 'success':
      // The zero-itinerary block below is its own polite live region and names
      // the planned trip, so keep this region silent to avoid a double
      // announcement of the same outcome (R89 review). A fallback-only plan is
      // one walking estimate, not one "route": the card's own notice carries
      // the honest outcome instead of a misleading route count.
      return count === 0 || fallbackOnly ? '' : t('routes.count', { count });
  }
}

/**
 * Three v2-shaped skeletons (ETA bar, leg-strip bar, meta bar) so the delayed
 * loading placeholder already reads as a route card. Screen readers get the
 * polite loading message instead; the shapes are `aria-hidden`.
 */
function SkeletonCards() {
  return (
    <ul aria-hidden="true" data-testid="route-skeletons" className="flex flex-col gap-3">
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          data-testid="route-card-skeleton"
          className="flex animate-pulse flex-col gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 motion-reduce:animate-none"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="flex flex-col gap-2">
              <span className="h-8 w-24 rounded bg-surface-container-highest" />
              <span className="h-4 w-28 rounded bg-surface-container-highest" />
            </span>
            <span className="flex flex-col items-end gap-2">
              <span className="h-4 w-16 rounded-pill bg-surface-container-highest" />
              <span className="h-8 w-20 rounded bg-surface-container-highest" />
            </span>
          </span>
          <span className="h-2.5 w-full rounded bg-surface-container-highest" />
          <span className="h-4 w-40 rounded bg-surface-container-highest" />
        </li>
      ))}
    </ul>
  );
}

/** Shared header/status/card content, rendered full-page or inside the sheet. */
interface RouteOptionsContentProps {
  plan: PlanOutcome;
  filter: RouteFilter;
  onFilterChange: (filter: RouteFilter) => void;
  /** Effective selected itinerary id (ranked lead unless one was tapped). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Opens the trip-detail affordance without changing the selected card. */
  onOpenDetail?: (id: string) => void;
  originLabel?: string;
  /** Names of the optional via stops, in travel order (R89). */
  stopLabels?: readonly string[];
  destinationLabel?: string;
  onBack?: () => void;
  /**
   * Secondary action for the zero-itinerary state: go back to the directions
   * form (prefilled with this trip) and change the starting point. Optional
   * because a bare mount may not own navigation.
   */
  onEditTrip?: () => void;
  /** `true` inside the `/plan` bottom sheet: the sheet owns page scaffolding. */
  embedded?: boolean;
}

function RouteOptionsContent({
  plan,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onOpenDetail,
  originLabel,
  stopLabels,
  destinationLabel,
  onBack,
  onEditTrip,
  embedded = false,
}: RouteOptionsContentProps) {
  const { t } = useT();
  const showSkeletons = useDelayedFlag(plan.status === 'loading', SKELETON_DELAY_MS);

  const ranked = useMemo(
    () => rankItineraries(plan.itineraries, filter),
    [plan.itineraries, filter],
  );
  const filterOptions = useMemo(
    () =>
      FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const tripFrom = (originLabel ?? '').trim();
  const tripTo = (destinationLabel ?? '').trim();
  const viaLabels = (stopLabels ?? [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  const placeParts = [tripFrom, ...viaLabels, tripTo].filter((part) => part.length > 0);
  const placeLine = placeParts.join(' → ');
  // Kalsada header: the trip line is the `h1`; `routes.title` is the accessible
  // fallback when the /plan hand-off gave no place labels at all.
  const headingLabel = placeLine.length > 0 ? placeLine : t('routes.title');

  const count = plan.itineraries.length;
  const hasPlan = plan.status === 'success' && count > 0;
  // A fallback-only plan is a single walking estimate, not a set of priced
  // alternatives: the fare-oriented filter chips (Cheapest/Fewest transfers/…)
  // and the "N ruta" count row would imply transit choices that do not exist.
  const fallbackOnly = hasPlan && plan.itineraries.every(isWalkFallback);
  const lead = hasPlan ? ranked[0] : undefined;
  // "pinakamabilis" is a fact about the returned set, not about the active
  // ranking: derive the minimum duration from the untouched API array so a
  // Cheapest/Fewest-transfers lead can never make the headline claim the wrong
  // route is fastest (review I3).
  const fastestMinutes =
    count > 0
      ? plan.itineraries.reduce(
          (fastest, itinerary) => Math.min(fastest, itinerary.durationMin),
          Number.POSITIVE_INFINITY,
        )
      : null;
  // The departure line is a property of the plan, not of the active ranking:
  // it always reads the first itinerary the API returned, so re-ranking with a
  // chip never changes the stated departure time.
  const departureTime =
    count > 0 ? formatClockTime(plan.itineraries[0]?.startTime) : null;
  // The trip line in the heading already names From → To, so the sub-line only
  // carries the departure (never the same place pair twice).
  const subLine = departureTime !== null ? t('routes.depart', { time: departureTime }) : null;

  const emptyFrom = originLabel ?? t('routes.unknownPlace');
  const emptyTo = destinationLabel ?? t('routes.unknownPlace');

  // A selection is announced only after the rider explicitly changed it; the
  // initial ranked lead is the map's default, not a choice, so it is never
  // announced (and the count message above stays the single load announcement).
  const previousSelectedId = useRef<string | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState<string | null>(null);
  useEffect(() => {
    const previous = previousSelectedId.current;
    previousSelectedId.current = selectedId;
    const selectedItinerary = ranked.find((itinerary) => itinerary.id === selectedId);
    setSelectionAnnouncement(
      previous !== null &&
        previous !== selectedId &&
        selectedItinerary !== undefined
        ? t('routes.selectedAnnounce', { minutes: selectedItinerary.durationMin })
        : null,
    );
  }, [selectedId, ranked, t]);

  return (
    <>
      <header
        className={
          embedded
            ? 'pb-3'
            : 'border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3'
        }
      >
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2">
          {/* Back first in DOM order (and first for keyboard/SR), visually on
              the trailing edge as in the mockup. */}
          {onBack !== undefined ? (
            <button
              type="button"
              aria-label={t('common.back')}
              onClick={onBack}
              className="order-last flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface transition hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-on-surface-variant">
              {t('search.title')}
            </p>
            <h1
              aria-label={headingLabel}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[22px] font-extrabold leading-7 tracking-tight text-on-surface"
            >
              {placeParts.length > 0 ? (
                placeParts.map((part, index) => (
                  <Fragment key={`${part}-${index}`}>
                    {index > 0 ? (
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    ) : null}
                    <span>{part}</span>
                  </Fragment>
                ))
              ) : (
                <span>{t('routes.title')}</span>
              )}
            </h1>
            {subLine !== null ? (
              <p className="truncate text-sm leading-5 text-on-surface-variant">{subLine}</p>
            ) : null}
          </div>
        </div>
      </header>

      <div
        aria-busy={plan.status === 'loading'}
        className={
          embedded
            ? 'flex flex-col gap-4 pb-4'
            : 'mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4'
        }
      >
        <p role="status" aria-live="polite" className="sr-only">
          {statusMessage(plan, count, fallbackOnly, t)}
        </p>
        {selectionAnnouncement !== null ? (
          <p role="status" aria-live="polite" className="sr-only">
            {selectionAnnouncement}
          </p>
        ) : null}

        {plan.status === 'loading' && showSkeletons ? <SkeletonCards /> : null}

        {plan.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-card border border-error bg-error-container px-4 py-3 text-on-error-container"
          >
            <p className="text-sm">{t('routes.error')}</p>
            <button
              type="button"
              onClick={plan.retry}
              className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {plan.status === 'success' && plan.itineraries.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-6 text-on-surface shadow-elevation-1">
            {/* R89: the dead-end "try a nearby landmark" copy is replaced by an
                honest message that names the trip the rider actually planned. */}
            <p role="status" aria-live="polite" className="text-base font-semibold">
              {t('routes.emptyBetween', { from: emptyFrom, to: emptyTo })}
            </p>
            <p className="text-sm leading-5 text-on-surface-variant">{t('routes.emptyHint')}</p>
            {onEditTrip !== undefined ? (
              <button
                type="button"
                onClick={onEditTrip}
                className="flex min-h-12 items-center justify-center rounded-pill border border-primary bg-surface-container-lowest px-6 text-base font-semibold text-primary transition hover:bg-primary-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {t('routes.changeStart')}
              </button>
            ) : null}
          </div>
        ) : null}

        {hasPlan && lead !== undefined ? (
          <>
            {fallbackOnly ? null : (
              <FilterChips
                options={filterOptions}
                value={filter}
                onChange={onFilterChange}
                label={t('routes.sortLabel')}
              />
            )}
            {fallbackOnly ? null : (
              <p
                data-testid="routes-count"
                className="text-sm font-semibold leading-5 text-on-surface"
              >
                {t('routes.countSummary', { count, minutes: fastestMinutes ?? 0 })}
              </p>
            )}
            <ul aria-label={t('routes.title')} className="flex flex-col gap-3">
              {ranked.map((itinerary, index) => {
                const selected = itinerary.id === selectedId;
                return (
                  <li key={itinerary.id} className="flex flex-col gap-2">
                    <RouteCard
                      itinerary={itinerary}
                      sources={plan.sources}
                      selected={selected}
                      onSelect={onSelect}
                      badge={badgeFor(filter, index)}
                    />
                    {/* Exactly one detail action, directly under the selected
                        card, so the rider always knows which route it opens. */}
                    {selected && onOpenDetail !== undefined ? (
                      <button
                        type="button"
                        data-testid="route-detail-action"
                        aria-label={t('routes.detailActionLabel', {
                          minutes: itinerary.durationMin,
                        })}
                        onClick={() => onOpenDetail(itinerary.id)}
                        className="flex min-h-12 w-full items-center justify-center rounded-pill border border-primary bg-surface-container-lowest px-5 text-base font-semibold text-primary transition hover:bg-primary-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:bg-primary-container"
                      >
                        {t('routes.detailAction')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </>
  );
}

export interface RouteOptionsLabels {
  /** Display label for the origin (e.g. "Kasalukuyang lokasyon"). */
  originLabel?: string;
  /** Names of the optional via stops, in travel order (R89). */
  stopLabels?: readonly string[];
  destinationLabel?: string;
  onBack?: () => void;
  /**
   * Detail hand-off: one 48 dp "Tingnan ang detalye" action under the selected
   * card. It is separate from the card body so tapping the card still
   * selects/highlights its path (R58).
   */
  onOpenDetail?: (id: string) => void;
  /**
   * Edit hand-off for the zero-itinerary state: reopen `/search` prefilled with
   * this trip so the rider can change the starting point (R89).
   */
  onEditTrip?: () => void;
}

/** Standalone screen: fetches its own plan (tests mount this without a map). */
export interface SelfLoadingRouteOptionsProps extends RouteOptionsLabels {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  /** Optional via stops in travel order; the self-loading mount plans them too. */
  stops?: readonly PlanStopInput[];
}

/**
 * Controlled screen: the `/plan` route layer owns the plan, the filter and the
 * selected id (R58), so the same selection drives the map paths.
 */
export interface ControlledRouteOptionsProps extends RouteOptionsLabels {
  plan: PlanOutcome;
  filter: RouteFilter;
  onFilterChange: (filter: RouteFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export type RouteOptionsScreenProps = SelfLoadingRouteOptionsProps | ControlledRouteOptionsProps;

/**
 * Fare-forward route options (spec §2 route options, §4.1).
 *
 * Its own plan state keeps the screen prop-driven and testable without a router
 * or map; `/plan` passes a controlled plan/selection so a card tap and the
 * highlighted map path are the same state (R58). The screen renders only what
 * the API returned (R45), keeps the fare and its effectivity date on every card,
 * and re-ranks the same array locally when a filter chip is pressed.
 */
export function RouteOptionsScreen(props: RouteOptionsScreenProps) {
  if ('plan' in props) {
    return <RouteOptionsContent {...props} embedded />;
  }
  return <SelfLoadingRouteOptionsScreen {...props} />;
}

function SelfLoadingRouteOptionsScreen({
  origin,
  destination,
  stops,
  originLabel,
  stopLabels,
  destinationLabel,
  onBack,
  onOpenDetail,
  onEditTrip,
}: SelfLoadingRouteOptionsProps) {
  const plan = usePlan(origin, destination, stops);
  const [filter, setFilter] = useState<RouteFilter>('recommended');
  const [explicitSelection, setExplicitSelection] = useState<string | null>(null);

  const ranked = useMemo(
    () => rankItineraries(plan.itineraries, filter),
    [plan.itineraries, filter],
  );
  const selectedId =
    explicitSelection !== null && ranked.some((itinerary) => itinerary.id === explicitSelection)
      ? explicitSelection
      : (ranked[0]?.id ?? null);

  return (
    <main className="min-h-dvh bg-surface text-on-surface">
      <RouteOptionsContent
        plan={plan}
        filter={filter}
        onFilterChange={setFilter}
        selectedId={selectedId}
        onSelect={setExplicitSelection}
        onOpenDetail={onOpenDetail}
        originLabel={originLabel}
        stopLabels={stopLabels}
        destinationLabel={destinationLabel}
        onBack={onBack}
        onEditTrip={onEditTrip}
      />
    </main>
  );
}
