import type { ItineraryDto, LegDto } from '@biyahey/shared';

/**
 * Itinerary-level helpers shared by screens.
 *
 * Endpoints are derived strictly from the legs the API returned — the app has no
 * origin/destination labels for a saved snapshot, so a saved row's title comes
 * from its first and last leg rather than an invented or placeholder title.
 */

function cleanName(name: string): string {
  return name.trim();
}

/**
 * `From → To` labels for an itinerary (first leg origin → last leg destination).
 *
 * A payload whose first or last name is blank falls back to the other endpoint;
 * a completely nameless itinerary returns empty strings so the caller can render
 * its own honest fallback instead of " → ".
 */
export function itineraryEndpoints(itinerary: ItineraryDto): { from: string; to: string } {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  const from = cleanName(first?.from.name ?? '') || cleanName(last?.to.name ?? '');
  const to = cleanName(last?.to.name ?? '') || cleanName(first?.from.name ?? '');
  return {
    from: from.length > 0 ? from : to,
    to: to.length > 0 ? to : from,
  };
}

/** Number of legs the rider actually rides (walk legs excluded). */
export function rideLegCount(itinerary: ItineraryDto): number {
  return itinerary.legs.filter((leg) => leg.mode !== 'walk').length;
}

/** Sum of the legs' scheduled minutes (the router's duration is authoritative). */
export function legsTotalMinutes(legs: readonly LegDto[]): number {
  return legs.reduce((total, leg) => total + leg.durationMin, 0);
}

/** The leg to show when no explicit selection exists, or `undefined` if empty. */
export function firstLeg(legs: readonly LegDto[]): LegDto | undefined {
  return legs[0];
}
