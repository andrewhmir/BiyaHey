import type { LegDto } from '@biyahey/shared';
import { useCopy } from '../../i18n';
import { modeColor, modeLabel } from '../../map/modes';

/**
 * The trip's legs as one readable ribbon. Every chip carries the mode's name,
 * so the colour is an accent, never the only signal.
 */
export function ModeRibbon({ legs, label }: { legs: readonly LegDto[]; label: string }) {
  const { t } = useCopy();
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {legs.map((leg, index) => (
        <li
          key={`${leg.mode}-${index}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink-soft"
        >
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: modeColor(leg.mode) }}
          />
          {modeLabel(leg.mode, t)}
        </li>
      ))}
    </ol>
  );
}
