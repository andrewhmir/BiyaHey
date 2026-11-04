import type { ItineraryDto } from '@biyahey/shared';
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
 * distance warning live here so every surface that renders an itinerary (route
 * card, trip detail, saved/recent rows) says the same thing.
 *
 * The 25 km threshold is the plan's global constraint: beyond it the UI must
 * say plainly that walking is not a realistic alternative, while still showing
 * the estimate. It is a constant so no screen can drift from the rule.
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

export interface WalkFallbackNoticeProps {
  itinerary: ItineraryDto;
  /** Include the badge inside the notice (trip detail); the card puts it in its ETA row. */
  badge?: boolean;
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
  className = '',
}: WalkFallbackNoticeProps) {
  const { t } = useT();
  const overlong = isOverlongWalkFallback(itinerary);
  return (
    <div
      data-testid="walk-fallback"
      data-long-walk={overlong ? 'true' : 'false'}
      className={`rounded-card border border-dashed border-outline-variant bg-surface-container-low px-3 py-2.5 text-on-surface ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {badge ? <WalkEstimateBadge /> : null}
        <span
          data-testid="walk-fallback-stat"
          className="text-sm font-semibold leading-5 tabular-nums text-on-surface"
        >
          {walkFallbackStat(itinerary, t)}
        </span>
      </div>
      <p
        data-testid="walk-fallback-body"
        className="mt-1 break-words text-xs leading-4 text-on-surface-variant"
      >
        {t('walkFallback.body')}
      </p>
      {overlong ? (
        <p
          data-testid="walk-fallback-warning"
          className="mt-1.5 break-words rounded-field bg-tertiary-container px-2.5 py-2 text-sm font-medium leading-5 text-on-tertiary-container"
        >
          {t('walkFallback.tooFar', { km: WALK_FALLBACK_NOT_REALISTIC_KM })}
        </p>
      ) : null}
    </div>
  );
}
