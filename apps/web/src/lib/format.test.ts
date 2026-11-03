import { describe, expect, it } from 'vitest';
import { defaultT } from '../i18n/strings';
import { formatFare, legDistanceLabel, transfersLabel, walkLabel } from './format';

describe('formatFare', () => {
  it('keeps whole pesos whole and fractional fares at two decimals', () => {
    expect(formatFare(14)).toBe('14');
    expect(formatFare(24.5)).toBe('24.50');
    expect(formatFare(0)).toBe('0');
  });
});

describe('legDistanceLabel', () => {
  it('uses metres below a kilometre and one decimal of a kilometre above', () => {
    expect(legDistanceLabel(189)).toBe('189 m');
    expect(legDistanceLabel(999)).toBe('999 m');
    expect(legDistanceLabel(1000)).toBe('1.0 km');
    expect(legDistanceLabel(1120)).toBe('1.1 km');
  });
});

describe('transfer and walk labels', () => {
  it('says direct for a zero-transfer ride and N sakay otherwise', () => {
    expect(transfersLabel(0)).toBe('direct');
    expect(transfersLabel(2)).toBe('2 sakay');
    expect(transfersLabel(1, defaultT)).toBe('1 sakay');
  });

  it('renders the walk total in Taglish', () => {
    expect(walkLabel(484)).toBe('484 m lakad');
    expect(walkLabel(1300)).toBe('1.3 km lakad');
  });
});
