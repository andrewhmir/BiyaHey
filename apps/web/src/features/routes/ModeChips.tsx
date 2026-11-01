import type { LegMode } from '@biyahey/shared';
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
import { MODE_COLORS, isKnownMode } from '../../components/map/RoutePolylines';
import { useT } from '../../i18n/useT';

/**
 * Mode chips for a route card (spec §11 screen 3).
 *
 * Icons and translated labels come from the same mode vocabulary the map
 * polyline legend uses ({@link isKnownMode} / {@link MODE_COLORS}), so colour is
 * never the only carrier of meaning: every chip shows its mode name, and rail
 * chips additionally show the line colour next to that name.
 *
 * An API mode outside the v1 vocabulary (review focus 4) renders a generic
 * `sakay (<mode>)` chip instead of crashing or inventing an icon meaning.
 */

const MODE_ICONS: Record<LegMode, LucideIcon> = {
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

const RAIL_MODES: ReadonlySet<LegMode> = new Set<LegMode>(['mrt3', 'lrt1', 'lrt2']);

export interface ModeChipsProps {
  /** Distinct modes in travel order, as the itinerary reports them. */
  modes: readonly string[];
}

export function ModeChips({ modes }: ModeChipsProps) {
  const { t } = useT();
  const uniqueModes = [...new Set(modes)];

  return (
    <span
      data-testid="mode-chips"
      role="group"
      aria-label={t('routes.modeGroup')}
      className="flex flex-wrap items-center gap-1.5"
    >
      {uniqueModes.map((mode) => {
        const known = isKnownMode(mode);
        const Icon = known ? MODE_ICONS[mode] : Route;
        const label = known ? t(`mode.${mode}`) : t('routes.unknownMode', { mode });
        return (
          <span
            key={mode}
            data-mode={mode}
            className="inline-flex items-center gap-1 rounded-pill bg-surface-container px-2 py-1 text-xs font-medium text-on-surface"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {known && RAIL_MODES.has(mode) ? (
              <span
                aria-hidden="true"
                data-testid={`rail-colour-${mode}`}
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: MODE_COLORS[mode] }}
              />
            ) : null}
            <span>{label}</span>
          </span>
        );
      })}
    </span>
  );
}
