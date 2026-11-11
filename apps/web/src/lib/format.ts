import type { DataSource } from '@biyahey/shared';
import type { Translate } from '../copy';

/** PHP amount: whole pesos stay whole, fractional fares keep two decimals. */
export function formatFare(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** `₱10.50` — the fare as the API returned it, never recomputed. */
export function fareLabel(amount: number): string {
  return `₱${formatFare(amount)}`;
}

/** Metres below 1 km, one decimal of a kilometre above. */
export function distanceLabel(distanceM: number): string {
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)} km`;
  return `${Math.round(distanceM)} m`;
}

/** `direct` for zero transfers, `N sakay` otherwise. */
export function transfersLabel(transfers: number, t: Translate): string {
  return transfers <= 0 ? t('routes.direct') : t('routes.transfers', { count: transfers });
}

const CLOCK_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Manila',
});

/** `9:46 PM` in Philippine time, or `null` for a missing/invalid timestamp. */
export function formatClockTime(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return null;
  const [rawHour = '0', minute = '00'] = CLOCK_FORMATTER.format(time).split(':');
  const hour = Number(rawHour) % 24;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Manila',
});

/** `1 Sep 2026` in Philippine time, or `null` for a missing/invalid timestamp. */
export function formatLongDate(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return LONG_DATE_FORMATTER.format(date);
}

/** Minutes as `43 min`. */
export function durationLabel(minutes: number): string {
  return `${Math.round(minutes)} min`;
}

/**
 * The newest `last_checked` date across the response's provenance rows — the
 * honest "last updated" stamp for a saved snapshot.
 */
export function datasetVersion(sources: readonly DataSource[]): string {
  let newest = '';
  for (const source of sources) {
    if (source.last_checked > newest) newest = source.last_checked;
  }
  return newest;
}
