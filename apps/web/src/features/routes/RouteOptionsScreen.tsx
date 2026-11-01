import type { ItineraryDto, PlanPlaceInput } from '@biyahey/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FilterChips, type FilterChipOption } from './FilterChips';
import { RouteCard, type RouteBadge } from './RouteCard';
import { usePlan, type PlanOutcome } from './usePlan';

/** Skeletons never flash: they appear only once the plan is still pending at 300 ms. */
export const SKELETON_DELAY_MS = 300;

export type RouteFilter = 'recommended' | 'cheapest' | 'fewest-transfers' | 'less-walking';

export const FILTER_OPTIONS: readonly FilterChipOption<RouteFilter>[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fewest-transfers', label: 'Fewest transfers' },
  { value: 'less-walking', label: 'Less walking' },
];

/**
 * Local re-rank of the same itinerary array (spec §9).
 *
 * Every filter is deterministic and stable: ties fall back to the next field
 * and then keep the API's ETA order. No filter changes the query, so no chip
 * can cause a refetch.
 */
export function rankItineraries(
  itineraries: readonly ItineraryDto[],
  filter: RouteFilter,
): ItineraryDto[] {
  const ranked = [...itineraries];
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
      default:
        return (
          a.durationMin - b.durationMin ||
          a.fare.amount - b.fare.amount ||
          a.walkDistanceM - b.walkDistanceM
        );
    }
  });
  return ranked;
}

/** Exactly one badge, on the lead card of the active ranking. */
function badgeFor(filter: RouteFilter, index: number): RouteBadge | undefined {
  if (index !== 0) {
    return undefined;
  }
  if (filter === 'cheapest') {
    return 'CHEAPEST';
  }
  if (filter === 'fewest-transfers') {
    return 'FEWEST TRANSFERS';
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

function statusMessage(plan: PlanOutcome, count: number): string {
  switch (plan.status) {
    case 'loading':
      return 'Naghahanap ng ruta…';
    case 'error':
      return 'Hindi ma-load ang mga ruta. Subukan ulit.';
    case 'success':
      return count === 0 ? 'Walang ruta' : `${count} ruta`;
  }
}

function SkeletonCards() {
  return (
    <ul aria-hidden="true" data-testid="route-skeletons" className="flex flex-col gap-3">
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          data-testid="route-card-skeleton"
          className="flex animate-pulse flex-col gap-3 rounded-card border border-outline-variant bg-surface-container p-4 motion-reduce:animate-none"
        >
          <span className="h-8 w-24 rounded bg-surface-container-highest" />
          <span className="h-16 w-full rounded bg-surface-container-highest" />
          <span className="h-5 w-40 rounded bg-surface-container-highest" />
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
  destinationLabel?: string;
  onBack?: () => void;
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
  destinationLabel,
  onBack,
  embedded = false,
}: RouteOptionsContentProps) {
  const showSkeletons = useDelayedFlag(plan.status === 'loading', SKELETON_DELAY_MS);

  const ranked = useMemo(
    () => rankItineraries(plan.itineraries, filter),
    [plan.itineraries, filter],
  );

  const placeLine = [originLabel, destinationLabel].filter(Boolean).join(' → ');
  const count = plan.itineraries.length;

  return (
    <>
      <header
        className={
          embedded
            ? 'border-b border-outline-variant pb-3'
            : 'border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3'
        }
      >
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
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
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-semibold tracking-tight text-on-surface">Mga ruta</h1>
            {placeLine.length > 0 ? (
              <p className="truncate text-sm text-on-surface-variant">{placeLine}</p>
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
        <p role="status" aria-live="polite" className="text-sm text-on-surface-variant">
          {statusMessage(plan, count)}
        </p>

        {plan.status === 'loading' && showSkeletons ? <SkeletonCards /> : null}

        {plan.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-card border border-error-container bg-error-container px-4 py-3 text-on-error-container"
          >
            <p className="text-sm">Hindi ma-load ang mga ruta. Subukan ulit.</p>
            <button
              type="button"
              onClick={plan.retry}
              className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
            >
              Subukan ulit
            </button>
          </div>
        ) : null}

        {plan.status === 'success' && plan.itineraries.length === 0 ? (
          <p className="rounded-card border border-outline-variant bg-surface-container-low px-4 py-6 text-center text-base text-on-surface">
            Walang ruta — try a nearby landmark
          </p>
        ) : null}

        {plan.status === 'success' && plan.itineraries.length > 0 ? (
          <>
            <FilterChips
              options={FILTER_OPTIONS}
              value={filter}
              onChange={onFilterChange}
              label="Ayusin ang mga ruta"
            />
            <ul aria-label="Mga ruta" className="flex flex-col gap-3">
              {ranked.map((itinerary, index) => (
                <li key={itinerary.id} className="flex flex-col gap-2">
                  <RouteCard
                    itinerary={itinerary}
                    sources={plan.sources}
                    selected={itinerary.id === selectedId}
                    onSelect={onSelect}
                    badge={badgeFor(filter, index)}
                  />
                  {onOpenDetail !== undefined ? (
                    <button
                      type="button"
                      data-testid="trip-open"
                      aria-label={`Detalye ng rutang ${itinerary.durationMin} min`}
                      onClick={() => onOpenDetail(itinerary.id)}
                      className="trip-open flex min-h-12 w-full items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-primary transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      Detalye
                    </button>
                  ) : null}
                </li>
              ))}
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
  destinationLabel?: string;
  onBack?: () => void;
  /**
   * Detail hand-off: a 48 dp `Detalye` action per card. It is separate from the
   * card body so tapping the card still selects/highlights its polyline (R58).
   */
  onOpenDetail?: (id: string) => void;
}

/** Standalone screen: fetches its own plan (tests mount this without a map). */
export interface SelfLoadingRouteOptionsProps extends RouteOptionsLabels {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
}

/**
 * Controlled screen: the `/plan` route layer owns the plan, the filter and the
 * selected id (R58), so the same selection drives the map polylines.
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
 * Fare-forward route options (spec §11 screen 3).
 *
 * Its own plan state keeps the screen prop-driven and testable without a router
 * or map; `/plan` passes a controlled plan/selection so a card tap and the
 * highlighted polyline are the same state (R58). The screen renders only what
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
  originLabel,
  destinationLabel,
  onBack,
  onOpenDetail,
}: SelfLoadingRouteOptionsProps) {
  const plan = usePlan(origin, destination);
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
        destinationLabel={destinationLabel}
        onBack={onBack}
      />
    </main>
  );
}
