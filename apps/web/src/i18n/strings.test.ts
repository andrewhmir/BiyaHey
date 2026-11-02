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

/**
 * New trip-planner copy (R89). Existing pinned values above are untouched;
 * these keys are added to both locales and pinned here so a later refactor
 * cannot quietly change what the directions form renders.
 */
const TRIP_PLANNER_TL: Readonly<Record<string, string>> = {
  'search.title': 'Plano ng biyahe',
  'search.fromLabel': 'Mula sa',
  'search.toLabel': 'Papunta sa',
  'search.fromPlaceholder': 'Saan ka galing?',
  'search.stopPlaceholder': 'Saan ka hihinto?',
  'search.stopLabel': 'Hintuan {index}',
  'search.addStop': 'Magdagdag ng hintuan',
  'search.removeStop': 'Alisin ang hintuan',
  'search.removeStopIndex': 'Alisin ang hintuan {index}',
  'search.swap': 'Palitan ang mula at papunta',
  'search.useMyLocation': 'Gamitin ang lokasyon ko',
  'search.findRoute': 'Maghanap ng ruta',
  'search.noStops': 'Walang hintuang nakita para sa “{query}”.',
  'search.partialNoStops': 'Walang kumpletong hintuang nakita para sa “{query}”.',
  'search.locateDenied':
    'Hindi pinayagan ang lokasyon. Pumili ng lugar para sa “Mula sa” o subukan ulit.',
  'search.locateUnavailable':
    'Hindi available ang lokasyon sa device na ito. Pumili ng lugar para sa “Mula sa”.',
  'search.locateTimeout':
    'Matagal bago natagpuan ang lokasyon. Subukan ulit o pumili ng lugar para sa “Mula sa”.',
  'search.locateUnsupported':
    'Walang location sa device na ito. Pumili ng lugar para sa “Mula sa”.',
  'routes.emptyBetween': 'Walang ruta sa pagitan ng {from} at {to}',
  'routes.emptyHint': 'Subukan ang ibang starting point o magdagdag ng hintuan sa search.',
  'routes.changeStart': 'Palitan ang starting point',
  'routes.unknownPlace': 'hindi kilalang lugar',
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

  it('pins the trip-planner copy added for R89', () => {
    for (const [key, value] of Object.entries(TRIP_PLANNER_TL)) {
      expect(STRINGS.tl[key]).toBe(value);
      expect(STRINGS.en[key]).toBeTypeOf('string');
    }
    expect(translate('tl', 'routes.emptyBetween', { from: 'Cubao', to: 'Ayala' })).toBe(
      'Walang ruta sa pagitan ng Cubao at Ayala',
    );
    expect(translate('en', 'routes.emptyBetween', { from: 'Guadalupe', to: 'Cubao' })).toBe(
      'No route between Guadalupe and Cubao',
    );
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
