import type { LegDto, LegMode } from '@biyahey/shared';
import { Bus, CarFront, Footprints, Ship, TrainFront, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { MODE_LABELS } from '../../components/map/RoutePolylines';
import { defaultT } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { formatClockTime } from '../../lib/time';
import { StopsList } from './StopsList';

/** Exact fallback the plan mandates when the API sent no landmark hint. */
export const LANDMARK_FALLBACK = defaultT('trip.landmarkFallback');

/** Spec §9's default presentation buffer for a transfer leg. */
export const TRANSFER_BUFFER_LABEL = defaultT('trip.transferBuffer');

const MODE_ICONS: Record<LegMode, LucideIcon> = {
  walk: Footprints,
  jeepney: CarFront,
  bus: Bus,
  mrt3: TrainFront,
  lrt1: TrainFront,
  lrt2: TrainFront,
  ferry: Ship,
  'uv-express': CarFront,
  p2p: Bus,
};

/** Walk/ride distance: metres below 1 km, one decimal of a kilometre above. */
export function legDistanceLabel(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceM)} m`;
}

function modeLabel(mode: LegMode, t = defaultT): string {
  return MODE_LABELS[mode] === undefined ? mode : t(`mode.${mode}`);
}

function LandmarkLine({ hint }: { hint: string | null }) {
  const { t } = useT();
  return (
    <p
      data-testid="landmark-line"
      className="mt-1 break-words text-xs leading-4 text-on-surface-variant"
    >
      {t('trip.landmark', { hint: hint ?? t('trip.landmarkFallback') })}
    </p>
  );
}

function TimelineRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <li data-testid="leg-row" className="relative flex gap-3 pb-5 last:pb-0">
      <div className="flex flex-col items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <span aria-hidden="true" className="mt-1 w-px flex-1 bg-outline-variant" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </p>
        {children}
      </div>
    </li>
  );
}

function WalkLeg({ leg }: { leg: LegDto }) {
  const { t } = useT();
  return (
    <>
      <p data-testid="leg-instruction" className="break-words text-base leading-6 text-on-surface">
        {t('trip.walkTo', { place: leg.to.name })}
      </p>
      <p className="text-sm text-on-surface-variant">
        {t('trip.walkStat', {
          distance: legDistanceLabel(leg.distanceM),
          minutes: leg.durationMin,
        })}
      </p>
      {leg.informalTransfer === true ? (
        <div
          data-testid="transfer-note"
          className="mt-2 rounded-card border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface"
        >
          <p>{t('trip.transferBuffer')}</p>
          <p data-testid="informal-transfer" className="text-xs text-on-surface-variant">
            {t('trip.informalTransfer')}
          </p>
        </div>
      ) : null}
      <LandmarkLine hint={leg.landmarkHint} />
    </>
  );
}

function RideLeg({ leg }: { leg: LegDto }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const label = modeLabel(leg.mode, t);
  const stops = leg.stops;
  const stopCount = stops?.length ?? 0;
  const remainingStops = Math.max(0, stopCount - 1);
  const stopsWord = remainingStops === 1 ? t('trip.stopWord') : t('trip.stopsWord');

  return (
    <>
      <p data-testid="leg-instruction" className="break-words text-base leading-6 text-on-surface">
        {t('trip.rideTo', {
          route: leg.routeShortName ?? label,
          headsign: leg.headsign ?? leg.to.name,
        })}
      </p>
      <p className="break-words text-sm font-medium text-on-surface">
        {leg.signage ?? t('trip.lookFor', { route: leg.routeShortName ?? label })}
      </p>
      <p className="text-sm text-on-surface-variant">
        {t('trip.rideStat', {
          start: formatClockTime(leg.startTime) ?? leg.startTime,
          end: formatClockTime(leg.endTime) ?? leg.endTime,
          minutes: leg.durationMin,
          distance: legDistanceLabel(leg.distanceM),
        })}
      </p>
      {stops !== undefined && stopCount > 1 ? (
        <div className="mt-2">
          <p data-testid="stop-counter" className="break-words text-sm text-on-surface-variant">
            {t('trip.stopCounter', { count: stopCount, place: leg.to.name })}
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((current) => !current)}
            className="mt-1 flex min-h-12 w-full items-center justify-start rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-left text-sm font-medium text-primary transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {expanded
              ? t('trip.hideStops', { count: remainingStops, word: stopsWord })
              : t('trip.showStops', { count: remainingStops, word: stopsWord })}
          </button>
          <div id={panelId} hidden={!expanded} className="mt-1">
            {expanded ? <StopsList stops={stops} /> : null}
          </div>
        </div>
      ) : null}
      <LandmarkLine hint={leg.landmarkHint} />
    </>
  );
}

export interface LegTimelineProps {
  legs: readonly LegDto[];
}

/**
 * Vertical leg timeline (spec §11 screen 4).
 *
 * One row per leg with an icon rail and the instruction. Ride legs expand to
 * the served stop list the API returned; walk legs show distance and, when the
 * API marked them `informalTransfer`, the 5-minute transfer buffer and the
 * `informal_transfer` label. Every instruction carries a landmark line, using
 * the API's hint or the mandated honest fallback.
 *
 * Copy is Taglish via `t()`; `MODE_LABELS` remains the shared mode vocabulary
 * (the map legend uses the same table) and the English fallback translates it.
 */
export function LegTimeline({ legs }: LegTimelineProps) {
  const { t } = useT();

  return (
    <ol aria-label={t('trip.stepsLabel')} className="flex flex-col">
      {legs.map((leg, index) => {
        const Icon = MODE_ICONS[leg.mode] ?? Bus;
        const label = t('trip.legLabel', {
          mode: modeLabel(leg.mode, t),
          index: index + 1,
          total: legs.length,
        });
        return (
          <TimelineRow key={`${leg.mode}-${leg.startTime}-${index}`} icon={Icon} label={label}>
            {leg.mode === 'walk' ? <WalkLeg leg={leg} /> : <RideLeg leg={leg} />}
          </TimelineRow>
        );
      })}
    </ol>
  );
}
