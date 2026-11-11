import type { ItineraryDto } from '@biyahey/shared';

/** The four local re-ranks the filter chips expose; none of them refetches. */
export type RouteFilter = 'recommended' | 'cheapest' | 'fewest-transfers' | 'less-walking';

export interface FilterOption {
  value: RouteFilter;
  labelKey: string;
}

export const FILTER_OPTIONS: readonly FilterOption[] = [
  { value: 'recommended', labelKey: 'routes.filterRecommended' },
  { value: 'cheapest', labelKey: 'routes.filterCheapest' },
  { value: 'fewest-transfers', labelKey: 'routes.filterFewestTransfers' },
  { value: 'less-walking', labelKey: 'routes.filterLessWalking' },
];

const BADGE_KEYS: Record<RouteFilter, string> = {
  recommended: 'routes.badgeBest',
  cheapest: 'routes.badgeCheapest',
  'fewest-transfers': 'routes.badgeFewestTransfers',
  'less-walking': 'routes.badgeLeastWalking',
};

/** Exactly one badge, on the lead card of the active ranking. */
export function badgeFor(
  filter: RouteFilter,
  index: number,
  itinerary: ItineraryDto,
): string | undefined {
  if (index !== 0) return undefined;
  // An incomplete fare is a partial sum, so it can never be "cheapest".
  if (filter === 'cheapest' && itinerary.fareIncomplete === true) return undefined;
  return BADGE_KEYS[filter];
}

/** A partial fare sum never outranks a complete one. */
function completeness(a: ItineraryDto, b: ItineraryDto): number {
  return Number(a.fareIncomplete === true) - Number(b.fareIncomplete === true);
}

const CRITERIA: ReadonlyArray<(itinerary: ItineraryDto) => number> = [
  (itinerary) => itinerary.durationMin,
  (itinerary) => (itinerary.fareIncomplete === true ? Number.POSITIVE_INFINITY : itinerary.fare.amount),
  (itinerary) => itinerary.transfers,
  (itinerary) => itinerary.walkDistanceM,
];

/** 1 + the number of strictly better values, so ties share the best rank. */
function competitionRank(value: number, values: readonly number[]): number {
  let rank = 1;
  for (const other of values) if (other < value) rank += 1;
  return rank;
}

interface Consensus {
  wins: number;
  score: number;
}

/**
 * Recommended agrees with the chips that are on the screen: count how many of
 * the four criteria an option wins outright, then how balanced it is.
 */
function consensusProfiles(itineraries: readonly ItineraryDto[]): Map<string, Consensus> {
  const values = CRITERIA.map((read) => itineraries.map(read));
  const profiles = new Map<string, Consensus>();
  for (const itinerary of itineraries) {
    const profile: Consensus = { wins: 0, score: 0 };
    CRITERIA.forEach((read, index) => {
      const rank = competitionRank(read(itinerary), values[index] ?? []);
      profile.score += rank;
      if (rank === 1) profile.wins += 1;
    });
    profiles.set(itinerary.id, profile);
  }
  return profiles;
}

const NO_CONSENSUS: Consensus = { wins: 0, score: 0 };

/** Local re-rank of the same plan array. Stable: ties keep the API's ETA order. */
export function rankItineraries(
  itineraries: readonly ItineraryDto[],
  filter: RouteFilter,
): ItineraryDto[] {
  const ranked = [...itineraries];
  const profiles = filter === 'recommended' ? consensusProfiles(ranked) : null;
  ranked.sort((a, b) => {
    switch (filter) {
      case 'cheapest':
        return (
          completeness(a, b) ||
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
        const profileA = profiles?.get(a.id) ?? NO_CONSENSUS;
        const profileB = profiles?.get(b.id) ?? NO_CONSENSUS;
        return (
          completeness(a, b) ||
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
