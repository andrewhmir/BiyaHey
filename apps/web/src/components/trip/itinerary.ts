import type { ItineraryDto, LegDto } from '@biyahey/shared';
import type { Translate } from '../../copy';
import { distanceLabel, formatClockTime } from '../../lib/format';
import { itineraryEndpoints } from '../../lib/saved';
import { buildPlanPath, draftFrom } from '../../lib/trip';
import { modeLabel } from '../../map/modes';
import type { MapEndpoint } from '../../map/store';

/** Origin/destination pins for the persistent map, from the itinerary's ends. */
export function mapEndpoints(itinerary: ItineraryDto): MapEndpoint[] {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  if (first === undefined || last === undefined) return [];
  return [
    { lat: first.from.lat, lon: first.from.lon, label: first.from.name, kind: 'origin' },
    { lat: last.to.lat, lon: last.to.lon, label: last.to.name, kind: 'destination' },
  ];
}

/** The `/plan` URL this trip was planned from: the trip screen's back link. */
export function planPathFor(itinerary: ItineraryDto): string {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  if (first === undefined || last === undefined) return '/search';
  const { from, to } = itineraryEndpoints(itinerary);
  return buildPlanPath(
    draftFrom(
      { lat: first.from.lat, lon: first.from.lon },
      from.length > 0 ? from : null,
      { lat: last.to.lat, lon: last.to.lon },
      to.length > 0 ? to : null,
    ),
  );
}

/** A walk-only estimate is not a routed transit trip and is labelled as such. */
export function isWalkFallback(itinerary: ItineraryDto): boolean {
  return itinerary.fallback === 'walk';
}

/** Rider-supplied place labels, used to replace router placeholders. */
export interface EndpointLabels {
  from?: string;
  to?: string;
}

const START_NAME = /^(start|origin)$/i;
const END_NAME = /^(end|destination)$/i;
const PLATFORM_NAME = /^platform\s+\d+$/i;

/**
 * A leg endpoint as the rider should read it.
 *
 * MOTIS names the user's own endpoints `START` / `END` and rail platforms
 * `Platform 12`; both are replaced with the rider's labels (when known) or the
 * first/last served stop, so a trip never says "Maglakad papunta sa END".
 */
export function endpointName(
  leg: LegDto,
  side: 'from' | 'to',
  labels: EndpointLabels = {},
): string {
  const raw = (side === 'from' ? leg.from.name : leg.to.name).trim();
  if (START_NAME.test(raw)) return labels.from?.trim() ?? raw;
  if (END_NAME.test(raw)) return labels.to?.trim() ?? raw;
  if (PLATFORM_NAME.test(raw)) {
    const stops = leg.stops;
    const stop = side === 'from' ? stops?.[0]?.name : stops?.[stops.length - 1]?.name;
    if (stop !== undefined && stop.trim().length > 0) return stop.trim();
  }
  return raw;
}

/** The rider-facing instruction for one leg; walked and ridden legs differ. */
export function legInstruction(
  leg: LegDto,
  t: Translate,
  labels: EndpointLabels = {},
): string {
  if (leg.mode === 'walk') return t('trip.walkTo', { place: endpointName(leg, 'to', labels) });
  return t('trip.rideTo', {
    route: leg.routeShortName ?? modeLabel(leg.mode, t),
    headsign: leg.headsign ?? endpointName(leg, 'to', labels),
  });
}

/** The scheduled time/distance line for one leg (never recomputed). */
export function legStatText(leg: LegDto, t: Translate): string {
  if (leg.mode === 'walk') {
    return t('trip.walkStat', {
      distance: distanceLabel(leg.distanceM),
      minutes: leg.durationMin,
    });
  }
  return t('trip.rideStat', {
    start: formatClockTime(leg.startTime) ?? leg.startTime,
    end: formatClockTime(leg.endTime) ?? leg.endTime,
    minutes: leg.durationMin,
    distance: distanceLabel(leg.distanceM),
  });
}

/** The API's wayfinding line without its English `Look for:` prefix. */
export function signageText(leg: LegDto, t: Translate): string {
  const label = modeLabel(leg.mode, t);
  const copy = leg.signage ?? t('trip.lookFor', { route: leg.routeShortName ?? label });
  return copy.replace(/^\s*look for:\s*/i, '').trim();
}
