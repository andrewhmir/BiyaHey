/**
 * Philippine-local clock formatting shared by the trip detail and the route
 * cards. Times are always rendered in Asia/Manila regardless of the device or
 * test-runner timezone, matching the API's `+08:00` timestamps.
 */
const CLOCK_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Manila',
});

/** `HH:mm` in Philippine time, or `null` for a missing/invalid timestamp. */
export function formatClockTime(iso: string | undefined): string | null {
  if (iso === undefined) {
    return null;
  }
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) {
    return null;
  }
  return CLOCK_FORMATTER.format(time);
}
