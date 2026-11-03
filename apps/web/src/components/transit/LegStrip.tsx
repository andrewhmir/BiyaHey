import type { LegDto } from '@biyahey/shared';
import { useId } from 'react';
import { useT } from '../../i18n/useT';
import { legDistanceLabel } from '../../lib/format';
import { MODE_COLORS, modeIcon, modeLabel } from './modeMeta';

/**
 * The leg-strip ribbon — the Kalsada signature element.
 *
 * One proportional segment per leg, coloured by mode, with the leg duration
 * underneath. It is the same vocabulary on route cards, the trip-detail header
 * and the live walkthrough, and it is always paired with text: walk segments are
 * dashed (the map draws them dashed too), ride segments carry the line name or
 * mode name and the served-stop count.
 *
 * Variants:
 * - display (default): an ordered list of static segments, `size="sm"` on cards,
 *   `size="md"` on the trip header.
 * - interactive (`onSelectLeg` given): each segment is a 48 dp button with
 *   `aria-pressed` and an accessible name; used as the trip-detail progress
 *   rail and by the live walkthrough.
 *
 * Colour is never the only channel: every segment has an icon, a visible label
 * and a visually hidden sentence, and the strip itself is an `<ol>` with a label.
 */

export type LegStripSize = 'sm' | 'md';

export interface LegStripProps {
  legs: readonly LegDto[];
  /** Active leg for the interactive rail; ignored while `onSelectLeg` is absent. */
  selectedLegIndex?: number | null;
  onSelectLeg?: (index: number) => void;
  size?: LegStripSize;
  /** Accessible name for the list; defaults to the Taglish `routes.legStripLabel`. */
  label?: string;
  className?: string;
}

/** Ride label: line name + served-stop count, else just the mode/duration. */
function rideLabel(leg: LegDto, t: ReturnType<typeof useT>['t']): string {
  const route = leg.routeShortName?.trim();
  const stops = leg.stops?.length ?? 0;
  if (route !== undefined && route.length > 0 && stops > 0) {
    return t('routes.legRideLabel', { route, count: Math.max(0, stops - 1) });
  }
  if (route !== undefined && route.length > 0) {
    return route;
  }
  return `${modeLabel(leg.mode, t)} · ${t('routes.legMinutes', { minutes: leg.durationMin })}`;
}

/** The bar height/width rules: proportional growth with a 1-minute floor. */
function growFor(leg: LegDto): number {
  return Math.max(leg.durationMin, 1);
}

export function LegStrip({
  legs,
  selectedLegIndex = null,
  onSelectLeg,
  size = 'sm',
  label,
  className,
}: LegStripProps) {
  const { t } = useT();
  const listId = useId();
  const interactive = onSelectLeg !== undefined;
  const barClass = size === 'md' ? 'h-3.5' : 'h-2.5';
  const labelClass =
    size === 'md'
      ? 'text-[11px] font-semibold leading-4'
      : 'text-[10px] font-semibold leading-4';

  return (
    <div className={className}>
      <ol
        id={listId}
        data-testid="leg-strip"
        data-leg-count={legs.length}
        data-interactive={interactive ? 'true' : undefined}
        aria-label={label ?? t('routes.legStripLabel')}
        className={`flex list-none items-stretch gap-[3px] ${size === 'md' ? 'gap-1.5' : ''}`}
      >
        {legs.map((leg, index) => {
          const Icon = modeIcon(leg.mode);
          const active = selectedLegIndex === index;
          const walk = leg.mode === 'walk';
          const text = rideLabel(leg, t);
          const hidden =
            leg.mode === 'walk'
              ? `${t('routes.legMinutes', { minutes: leg.durationMin })} ${t('mode.walk')} · ${legDistanceLabel(leg.distanceM)}`
              : `${text} · ${t('routes.legMinutes', { minutes: leg.durationMin })}`;
          const style = { flex: `${growFor(leg)} 1 0%` };
          const bar = (
            <span
              aria-hidden="true"
              className={`flex ${barClass} w-full items-center justify-center overflow-hidden rounded-[3px] ${
                walk
                  ? 'border border-dashed border-outline text-on-surface-variant'
                  : 'text-white'
              }`}
              style={walk ? undefined : { backgroundColor: MODE_COLORS[leg.mode] }}
            >
              <Icon className={size === 'md' ? 'size-2.5' : 'size-2'} />
            </span>
          );
          const body = (
            <>
              {bar}
              <span
                className={`mt-1 block min-w-0 truncate ${labelClass} ${
                  active ? 'text-on-surface' : 'text-on-surface-variant'
                }`}
              >
                {walk ? t('routes.legMinutes', { minutes: leg.durationMin }) : text}
              </span>
              <span className="sr-only">{hidden}</span>
            </>
          );

          return (
            <li
              key={`${leg.mode}-${index}-${leg.startTime}`}
              style={style}
              className="min-w-0"
              data-testid="leg-strip-item"
            >
              {interactive ? (
                <button
                  type="button"
                  data-testid="leg-strip-segment"
                  data-mode={leg.mode}
                  data-minutes={leg.durationMin}
                  data-index={index}
                  aria-pressed={active}
                  aria-label={hidden}
                  onClick={() => onSelectLeg(index)}
                  className={`flex min-h-12 w-full flex-col items-stretch justify-center rounded-field px-0.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    active ? 'bg-primary-container/70' : 'hover:bg-surface-container'
                  }`}
                >
                  {body}
                </button>
              ) : (
                <span
                  data-testid="leg-strip-segment"
                  data-mode={leg.mode}
                  data-minutes={leg.durationMin}
                  data-index={index}
                  className="flex flex-col items-stretch"
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
