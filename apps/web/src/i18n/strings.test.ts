import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, STRINGS, translate, type Locale } from './strings';

const LOCALES: readonly Locale[] = ['tl', 'en'];

/**
 * Strings the plan/spec mandate verbatim (R44 preservation rule). They must
 * stay byte-identical after moving into the string module; existing screen
 * tests assert several of them directly.
 */
const MANDATED_TL: Readonly<Record<string, string>> = {
  'search.offline': 'Walang signal — showing saved places',
  'routes.empty': 'Walang ruta — try a nearby landmark',
  'saved.changed': 'Fare may have changed since you saved this.',
  'trip.savedRoute': 'Saved route (no live data)',
  'trip.savedSnapshot': 'Saved snapshot (no live ETA)',
  'trip.liveBanner': 'no live data — expected wait',
  'trip.lastUpdated': 'Last updated {date}',
  'search.placeholder': 'Saan ka pupunta?',
  'common.fare': 'Pamasahe',
  'routes.sakay': 'sakay',
  'trip.baba': 'Baba',
  'trip.lipat': 'Lipat',
  'trip.bayad': 'Bayad',
};

describe('STRINGS', () => {
  it('covers every key in every locale', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(STRINGS[locale])).toEqual(expect.arrayContaining(Object.keys(STRINGS.tl)));
    }
  });

  it('does not machine-translate brand or unit tokens', () => {
    expect(STRINGS.tl['common.fare']).not.toMatch(/fare/i);
    expect(STRINGS.tl['routes.sakay']).toMatch(/sakay/i);
  });

  it('keeps the mandated verbatim strings intact', () => {
    for (const [key, value] of Object.entries(MANDATED_TL)) {
      expect(STRINGS.tl[key]).toBe(value);
    }
  });

  it('defaults to Taglish', () => {
    expect(DEFAULT_LOCALE).toBe('tl');
    expect(STRINGS.tl['common.fare']).toBe('Pamasahe');
    expect(STRINGS.en['common.fare']).toBe('Fare');
  });

  it('has a non-empty English override for every key', () => {
    for (const key of Object.keys(STRINGS.tl)) {
      expect(STRINGS.en[key], `missing en override for ${key}`).toBeTypeOf('string');
      expect(STRINGS.en[key]?.trim().length, `empty en override for ${key}`).toBeGreaterThan(0);
      // A key leaked as its own value means the copy was never translated.
      expect(STRINGS.en[key], `en override for ${key} is still the raw key`).not.toBe(key);
    }
  });

  it('fills named placeholders and leaves unknown ones untouched', () => {
    expect(translate('tl', 'search.results', { count: 3 })).toBe('3 resulta');
    expect(translate('en', 'search.noResults', { query: 'Ayala' })).toBe(
      'No results for “Ayala”.',
    );
    expect(translate('tl', 'search.results', {})).toBe('{count} resulta');
    expect(translate('tl', 'missing.key')).toBe('missing.key');
  });
});
