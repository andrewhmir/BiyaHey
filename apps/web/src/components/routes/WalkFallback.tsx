import type { ItineraryDto } from '@biyahey/shared';
import { Footprints, TriangleAlert } from 'lucide-react';
import { useCopy } from '../../i18n';
import { distanceLabel } from '../../lib/format';

/**
 * Beyond this distance walking is not a realistic alternative; the UI must say
 * so while still showing the estimate it was given.
 */
export const WALK_NOT_REALISTIC_KM = 25;

export function isWalkFallback(itinerary: ItineraryDto): boolean {
  return itinerary.fallback === 'walk';
}

export function isOverlongWalk(itinerary: ItineraryDto): boolean {
  return itinerary.walkDistanceM > WALK_NOT_REALISTIC_KM * 1000;
}

/** The visible "walking estimate" label; text, never colour alone. */
export function WalkEstimateBadge() {
  const { t } = useCopy();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-ink-faint bg-canvas px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
      <Footprints aria-hidden="true" className="size-3" />
      {t('walkFallback.badge')}
    </span>
  );
}

/** The honest fallback block: estimate stat, what it is, and how far is too far. */
export function WalkFallbackNotice({ itinerary }: { itinerary: ItineraryDto }) {
  const { t } = useCopy();
  const overlong = isOverlongWalk(itinerary);

  return (
    <div className="rounded-md border border-dashed border-line-strong bg-canvas px-3 py-2.5">
      <p className="text-sm font-semibold text-ink">
        {t('walkFallback.stat', {
          distance: distanceLabel(itinerary.walkDistanceM),
          minutes: itinerary.durationMin,
        })}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-soft">{t('walkFallback.body')}</p>
      {overlong ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-5 text-ink">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          {t('walkFallback.tooFar', { km: WALK_NOT_REALISTIC_KM })}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-ink-faint">{t('walkFallback.provenance')}</p>
    </div>
  );
}
