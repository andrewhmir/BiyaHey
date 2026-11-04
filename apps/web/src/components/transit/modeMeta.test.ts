import type { LegMode } from '@biyahey/shared';
import { describe, expect, it } from 'vitest';
import { defaultT } from '../../i18n/strings';
import {
  KNOWN_MODES,
  MODE_COLORS,
  MODE_ICONS,
  isKnownMode,
  modeIcon,
  modeLabel,
  primaryMode,
  routeColor,
} from './modeMeta';
import { makeItinerary, makeLeg, makeWalkOnlyItinerary } from '../../test/fixtures/itinerary';

const ALL_MODES: readonly LegMode[] = [
  'walk',
  'jeepney',
  'bus',
  'mrt3',
  'lrt1',
  'lrt2',
  'ferry',
  'uv-express',
  'p2p',
  'tricycle',
];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('modeMeta', () => {
  it('defines a colour and an icon for every mode', () => {
    expect([...KNOWN_MODES].sort()).toEqual([...ALL_MODES].sort());
    for (const mode of ALL_MODES) {
      expect(MODE_COLORS[mode], `colour for ${mode}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(MODE_ICONS[mode], `icon for ${mode}`).toBeDefined();
    }
  });

  it('keeps every mode colour at 3:1 against the white map casing', () => {
    for (const mode of ALL_MODES) {
      const ratio = contrast(MODE_COLORS[mode], '#ffffff');
      expect(ratio, `${mode} is ${ratio.toFixed(2)}:1 against white`).toBeGreaterThanOrEqual(3);
    }
  });

  it('narrows unknown API modes instead of guessing', () => {
    expect(isKnownMode('hovercraft')).toBe(false);
    expect(isKnownMode('mrt3')).toBe(true);
    expect(modeLabel('hovercraft', defaultT)).toBe('hovercraft');
    expect(modeLabel('mrt3', defaultT)).toBe('MRT-3');
    expect(modeIcon('hovercraft')).toBeDefined();
  });

  it('names an itinerary by its first ride leg, or walk when there is none', () => {
    const rail = makeItinerary([makeLeg({ mode: 'walk' }), makeLeg({ mode: 'jeepney' })]);
    expect(primaryMode(rail)).toBe('jeepney');
    expect(routeColor(rail)).toBe(MODE_COLORS.jeepney);

    const walkOnly = makeWalkOnlyItinerary();
    expect(primaryMode(walkOnly)).toBe('walk');
    expect(routeColor(walkOnly)).toBe(MODE_COLORS.walk);
  });
});
