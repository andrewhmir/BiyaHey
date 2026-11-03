/**
 * Philippine-local clock formatting shared by every screen that prints a time.
 *
 * Times are always rendered in Asia/Manila regardless of the device or
 * test-runner timezone, matching the API's `+08:00` timestamps. The rider-facing
 * format is the Philippine convention: 12-hour with a regular-space AM/PM
 * (`8:31 AM`), built by hand so the output never depends on an ICU
 * narrow-no-break-space or a locale variant.
 */
const CLOCK_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Manila',
});

/** `8:31 AM` in Philippine time, or `null` for a missing/invalid timestamp. */
export function formatClockTime(iso: string | undefined): string | null {
  if (iso === undefined) {
    return null;
  }
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) {
    return null;
  }
  const [rawHour = '0', minute = '00'] = CLOCK_FORMATTER.format(time).split(':');
  const hour = Number(rawHour) % 24;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

/**
 * `1 Sep 2026` in Philippine time, or `null` for a missing/invalid timestamp.
 * Used by the saved/recent list's "Last updated" line and the saved-snapshot
 * banner; always Asia/Manila so a device timezone cannot shift the date.
 */
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Manila',
});

export function formatLongDate(iso: string | undefined): string | null {
  if (iso === undefined) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return LONG_DATE_FORMATTER.format(date);
}
