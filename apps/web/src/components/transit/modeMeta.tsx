import type { ItineraryDto, LegMode } from '@biyahey/shared';
import {
  Bus,
  CarFront,
  CarTaxiFront,
  Footprints,
  Route,
  Ship,
  TrainFront,
  type LucideIcon,
} from 'lucide-react';
import type { Translate } from '../../i18n/strings';

/**
 * The shared transit vocabulary of the Kalsada identity.
 *
 * Colour is never the only carrier of meaning: every mode also has an icon and a
 * translated `mode.*` label, and the card/timeline always pair the colour with
 * text. {@link MODE_COLORS} is the documented mode palette used by the map
 * lines, the leg strips and the timeline rails; the values are pinned by
 * `modeMeta.test.ts`, including their contrast against the map casing.
 *
 * Mode colours are data semantics (a mode always means the same thing), not
 * brand colours — the brand teal happens to be the jeepney colour as well, which
 * is intentional in the Kalsada palette.
 */

/** Documented mode palette. Contrast against the white map casing is reviewed. */
export const MODE_COLORS: Record<LegMode, string> = {
  walk: '#4c5b62',
  jeepney: '#0e7c7b',
  bus: '#b45309',
  mrt3: '#1f5fbf',
  lrt1: '#2e7d32',
  lrt2: '#7b1fa2',
  ferry: '#1565c0',
  'uv-express': '#c2410c',
  p2p: '#475569',
};

/** One line icon per mode, sized by the consumer. */
export const MODE_ICONS: Record<LegMode, LucideIcon> = {
  walk: Footprints,
  jeepney: CarFront,
  bus: Bus,
  mrt3: TrainFront,
  lrt1: TrainFront,
  lrt2: TrainFront,
  ferry: Ship,
  'uv-express': CarTaxiFront,
  p2p: Route,
};

/**
 * Mode vocabulary shared by cards, strips, timeline and map.
 * Derived from {@link MODE_COLORS} so there is no second copy of mode names:
 * rendered labels live only in the `mode.*` keys of `i18n/strings.ts`.
 */
export const KNOWN_MODES: ReadonlySet<string> = new Set<string>(Object.keys(MODE_COLORS));

/** Narrow an API mode string to the v1 vocabulary. */
export function isKnownMode(mode: string): mode is LegMode {
  return KNOWN_MODES.has(mode);
}

/** The mode that names an itinerary: the first non-walk leg, else walk. */
export function primaryMode(itinerary: ItineraryDto): LegMode {
  return itinerary.legs.find((leg) => leg.mode !== 'walk')?.mode ?? 'walk';
}

/** Colour for an itinerary's card accent and its alternative map line. */
export function routeColor(itinerary: ItineraryDto): string {
  return MODE_COLORS[primaryMode(itinerary)];
}

/**
 * Translated mode name for a known mode; an unexpected API mode keeps its raw
 * string (the UI never invents a label for data it does not understand).
 */
export function modeLabel(mode: LegMode | string, t: Translate): string {
  if (isKnownMode(mode)) {
    return t(`mode.${mode}`);
  }
  return mode;
}

/** The icon for a mode, falling back to the generic ride icon. */
export function modeIcon(mode: LegMode | string): LucideIcon {
  return isKnownMode(mode) ? MODE_ICONS[mode] : Route;
}
