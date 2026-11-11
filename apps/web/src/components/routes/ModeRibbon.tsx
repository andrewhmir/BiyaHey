import type { LegDto } from '@biyahey/shared';
import { useCopy } from '../../i18n';
import { modeColor, modeLabel } from '../../map/modes';

/**
 * The mode ribbon: one proportional segment per leg, coloured by mode. Colour
 * is never the only signal — every segment carries a visible mode label where
 * it has room, and a visually hidden description in every case.
 */
export function ModeRibbon({ legs }: { legs: readonly LegDto[] }) {
  const { t } = useCopy();
  const weights = legs.map((leg) => Math.max(leg.durationMin, 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return (
    <ol aria-label={t('routes.ribbonLabel')} className="flex list-none items-start gap-1">
      {legs.map((leg, index) => {
        const weight = weights[index] ?? 1;
        const share = total > 0 ? weight / total : 1;
        const walk = leg.mode === 'walk';
        const label = modeLabel(leg.mode, t);
        const showLabel = share >= 0.2;
        const description = `${t('trip.legLabel', {
          mode: label,
          index: index + 1,
          total: legs.length,
        })} · ${t('routes.legMinutes', { minutes: leg.durationMin })}`;

        return (
          <li
            key={`${leg.mode}-${index}-${leg.startTime}`}
            style={{ flex: `${weight} 1 0%` }}
            className="min-w-0"
          >
            <span
              aria-hidden="true"
              className={`block h-2.5 w-full rounded-sm ${
                walk ? 'border border-dashed border-ink-faint bg-transparent' : ''
              }`}
              style={walk ? undefined : { backgroundColor: modeColor(leg.mode) }}
            />
            {showLabel ? (
              <span className="mt-1 block truncate text-[10px] font-semibold leading-4 text-ink-soft">
                {label}
              </span>
            ) : null}
            <span className="sr-only">{description}</span>
          </li>
        );
      })}
    </ol>
  );
}
