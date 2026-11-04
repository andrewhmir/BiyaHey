import type { ItineraryDto } from '@biyahey/shared';
import type { ReactNode } from 'react';
import { type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { legDistanceLabel } from '../../lib/format';

/**
 * Walk-fallback vocabulary (PH-wide coverage D4).
 *
 * The BFF returns one itinerary flagged `fallback: 'walk'` only when the router
 * found no transit option. It must read as a walking estimate, never as a
 * served route: no fare, no route short name/headsign, no "Look for:" signage
 * and no mode-coloured line. The badge, the honest sentence and the
 * distance warning live here so every surface that renders a fallback says the
 * same thing:
 *
 * - the route card and the trip detail use the full notice;
 * - saved/recent rows use the compact variant, which keeps the badge, the
 *   value, the honest sentence and the >25 km warning with tighter type;
 * - the live walkthrough puts the badge + walking stat in its summary and uses
 *   the compact notice for the sentence and the warning;
 * - the trip detail, whose fallback replaces the fare footer, passes the
 *   `provenance` slot so the About-data entry point is not lost.
 *
 * The 25 km threshold is the plan's global constraint: beyond it the UI must
 * say plainly that walking is not a realistic alternative, while still showing
 * the estimate. It is a constant so no screen can drift from the rule. Every
 * surface that renders a fallback renders this component (directly or through
 * `RouteCard`), so the badge, the value, the body and the warning cannot drift
 * apart.
 */
export const WALK_FALLBACK_NOT_REALISTIC_KM = 25;
export const WALK_FALLBACK_NOT_REALISTIC_M = WALK_FALLBACK_NOT_REALISTIC_KM * 1000;

/** True only for the BFF's synthesised walking estimate. */
export function isWalkFallback(itinerary: ItineraryDto): boolean {
  return itinerary.fallback === 'walk';
}

/** True when the estimate is beyond the distance where walking is realistic. */
export function isOverlongWalkFallback(itinerary: ItineraryDto): boolean {
  return itinerary.walkDistanceM > WALK_FALLBACK_NOT_REALISTIC_M;
}

/** The walking distance + duration line, from the API's own numbers (R45). */
export function walkFallbackStat(itinerary: ItineraryDto, t: Translate): string {
  return t('walkFallback.stat', {
    distance: legDistanceLabel(itinerary.walkDistanceM),
    minutes: itinerary.durationMin,
  });
}

export interface WalkEstimateBadgeProps {
  className?: string;
}

/** The visible "walking estimate" label. Text, never colour alone. */
export function WalkEstimateBadge({ className = '' }: WalkEstimateBadgeProps) {
  const { t } = useT();
  return (
    <span
      data-testid="walk-fallback-badge"
      className={`inline-flex shrink-0 items-center rounded-pill border border-dashed border-outline bg-surface-container-high px-2.5 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.08em] text-on-surface ${className}`}
    >
      {t('walkFallback.badge')}
    </span>
  );
}

/** `full` for the route card/detail; `compact` for saved/recent rows and the live banner. */
export type WalkFallbackNoticeVariant = 'full' | 'compact';

export interface WalkFallbackNoticeProps {
  itinerary: ItineraryDto;
  /** Include the badge inside the notice; a surface that shows it elsewhere passes false. */
  badge?: boolean;
  /** Compact notices fit saved/recent rows and the live walkthrough banner. */
  variant?: WalkFallbackNoticeVariant;
  /** Render the walking stat; the live summary shows it and passes false. */
  stat?: boolean;
  /**
   * Provenance affordance rendered under the copy (trip detail). The fallback
   * suppresses the fare footer, so this slot is the honest About-data entry
   * point for a derived estimate.
   */
  provenance?: ReactNode;
  className?: string;
}

/**
 * The honest fallback block: badge (optional), walking distance/duration, the
 * "no transit route is known; this is a walking estimate" sentence and, beyond
 * 25 km, the explicit "walking is not a realistic alternative" warning.
 */
export function WalkFallbackNotice({
  itinerary,
  badge = true,
  variant = 'full',
  stat = true,
  provenance,
  className = '',
}: WalkFallbackNoticeProps) {
  const { t } = useT();
  const overlong = isOverlongWalkFallback(itinerary);
  const compact = variant === 'compact';
  return (
    <div
      data-testid="walk-fallback"
      data-variant={variant}
      data-long-walk={overlong ? 'true' : 'false'}
      className={`${
        compact
          ? 'flex flex-col gap-1 rounded-field bg-surface-container-low px-2.5 py-2'
          : 'rounded-card border border-dashed border-outline-variant bg-surface-container-low px-3 py-2.5'
      } text-on-surface ${className}`}
    >
      {badge || stat ? (
        <div className="flex flex-wrap items-center gap-2">
          {badge ? <WalkEstimateBadge /> : null}
          {stat ? (
            <span
              data-testid="walk-fallback-stat"
              className={`${
                compact ? 'text-xs' : 'text-sm'
              } font-semibold leading-5 tabular-nums text-on-surface`}
            >
              {walkFallbackStat(itinerary, t)}
            </span>
          ) : null}
        </div>
      ) : null}
      <p
        data-testid="walk-fallback-body"
        className={`break-words ${
          compact ? 'text-[11px] leading-4' : 'mt-1 text-xs leading-4'
        } text-on-surface-variant`}
      >
        {t('walkFallback.body')}
      </p>
      {overlong ? (
        <p
          data-testid="walk-fallback-warning"
          className={`break-words rounded-field bg-tertiary-container px-2.5 py-2 text-on-tertiary-container ${
            compact
              ? 'mt-0.5 text-xs font-medium leading-4'
              : 'mt-1.5 text-sm font-medium leading-5'
          }`}
        >
          {t('walkFallback.tooFar', { km: WALK_FALLBACK_NOT_REALISTIC_KM })}
        </p>
      ) : null}
      {provenance !== undefined ? (
        <div
          data-testid="walk-fallback-provenance"
          className={compact ? 'mt-1' : 'mt-2 border-t border-dashed border-outline-variant pt-2'}
        >
          {provenance}
        </div>
      ) : null}
    </div>
  );
}
