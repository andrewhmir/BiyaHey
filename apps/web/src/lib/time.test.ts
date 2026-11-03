import { describe, expect, it } from 'vitest';
import { formatClockTime, formatLongDate } from './time';

describe('formatClockTime', () => {
  it('renders Asia/Manila 12-hour time with a regular-space AM/PM', () => {
    // 2026-11-03T00:31Z is 8:31 AM in Manila (UTC+8).
    expect(formatClockTime('2026-11-03T00:31:00.000Z')).toBe('8:31 AM');
    expect(formatClockTime('2026-11-03T04:05:00.000Z')).toBe('12:05 PM');
    expect(formatClockTime('2026-11-03T15:45:00.000Z')).toBe('11:45 PM');
    // Midnight/noon boundaries must not render as 0:00.
    expect(formatClockTime('2026-11-02T16:00:00.000Z')).toBe('12:00 AM');
    expect(formatClockTime('2026-11-03T16:00:00.000Z')).toBe('12:00 AM');
    expect(formatClockTime('2026-11-03T04:00:00.000Z')).toBe('12:00 PM');
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(formatClockTime(undefined)).toBeNull();
    expect(formatClockTime('not-a-date')).toBeNull();
  });
});

describe('formatLongDate', () => {
  it('renders the Manila date and null for invalid input', () => {
    expect(formatLongDate('2026-11-01T08:00:00.000Z')).toBe('Nov 1, 2026');
    expect(formatLongDate(undefined)).toBeNull();
    expect(formatLongDate('nope')).toBeNull();
  });
});
