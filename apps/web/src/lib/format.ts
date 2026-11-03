import { defaultT, type Translate } from '../i18n/strings';

/**
 * Human-facing formatters shared by route cards, the trip detail, the live
 * walkthrough and saved rows. Extracted from `RouteCard` in UX v2 so every
 * screen formats fares, distances and transfer counts identically.
 */

/**
 * Format a PHP amount without recomputing it (R45): whole pesos stay whole,
 * fractional fares keep two decimals.
 */
export function formatFare(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Walk/ride distance: metres below 1 km, one decimal of a kilometre above. */
export function legDistanceLabel(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceM)} m`;
}

/** Taglish transfer wording: `direct` for zero, `N sakay` otherwise. */
export function transfersLabel(transfers: number, t: Translate = defaultT): string {
  return transfers <= 0 ? t('routes.direct') : t('routes.transfers', { count: transfers });
}

/** Walk total in metres under 1 km, otherwise one decimal of a kilometre. */
export function walkLabel(distanceM: number, t: Translate = defaultT): string {
  return t('routes.walk', { distance: legDistanceLabel(distanceM) });
}
