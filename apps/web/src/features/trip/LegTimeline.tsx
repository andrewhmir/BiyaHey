import type { LegDto } from '@biyahey/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { MODE_COLORS, modeIcon, modeLabel } from '../../components/transit/modeMeta';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { legDistanceLabel } from '../../lib/format';
import { formatClockTime } from '../../lib/time';
import { StopsList } from './StopsList';

export { legDistanceLabel };

/**
 * Exact fallback the plan mandates when the API sent no landmark hint.
 *
 * Kept exported for compatibility, but UX v2 no longer renders it: a landmark
 * line is only truthful when the API actually sent a hint (spec §2/§4.2).
 */
export const LANDMARK_FALLBACK = defaultT('trip.landmarkFallback');

/** Spec §9's default presentation buffer for a transfer leg. */
export const TRANSFER_BUFFER_LABEL = defaultT('trip.transferBuffer');

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** jsdom has no `matchMedia`; treat that as "motion allowed". */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The rider-facing instruction for one leg; walked and ridden legs differ. */
export function legInstruction(leg: LegDto, t: Translate): string {
  if (leg.mode === 'walk') {
    return t('trip.walkTo', { place: leg.to.name });
  }
  return t('trip.rideTo', {
    route: leg.routeShortName ?? modeLabel(leg.mode, t),
    headsign: leg.headsign ?? leg.to.name,
  });
}

/** The scheduled time/distance line for one leg (never recomputed, R45). */
export function legStatText(leg: LegDto, t: Translate): string {
  if (leg.mode === 'walk') {
    return t('trip.walkStat', {
      distance: legDistanceLabel(leg.distanceM),
      minutes: leg.durationMin,
    });
  }
  return t('trip.rideStat', {
    start: formatClockTime(leg.startTime) ?? leg.startTime,
    end: formatClockTime(leg.endTime) ?? leg.endTime,
    minutes: leg.durationMin,
    distance: legDistanceLabel(leg.distanceM),
  });
}

/**
 * The landmark line is only rendered when the API sent a hint; the v1
 * mandated-fallback sentence is deliberately gone from the UI.
 */
function LandmarkLine({ hint }: { hint: string | null }) {
  const { t } = useT();
  if (hint === null) {
    return null;
  }
  return (
    <p
      data-testid="landmark-line"
      className="mt-1 break-words text-xs leading-4 text-on-surface-variant"
    >
      {t('trip.landmark', { hint })}
    </p>
  );
}

/**
 * The board-leg signage value. The API's `signage` is already the full
 * wayfinding line (`Look for: …`); the plate renders that copy under the
 * Taglish `Hanapin` label, so the English prefix is stripped to avoid rendering
 * "Hanapin Look for: …". A ride leg without signage falls back to the route
 * name/line from `trip.lookFor` (which is only the fallback, never a duplicate).
 */
export function signageText(leg: LegDto, t: Translate): string {
  const label = modeLabel(leg.mode, t);
  const copy = leg.signage ?? t('trip.lookFor', { route: leg.routeShortName ?? label });
  return copy.replace(/^\s*look for:\s*/i, '').trim();
}

/** The "Hanapin" signage plate: the API's own signage copy when it sent one. */
function SignagePlate({ leg }: { leg: LegDto }) {
  const { t } = useT();
  return (
    <p
      data-testid="signage-plate"
      className="mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-pill border border-outline-variant bg-surface-container-low px-3 py-1.5 text-sm text-on-surface"
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
        {t('trip.signageLabel')}
      </span>
      <span className="min-w-0 break-words font-medium">{signageText(leg, t)}</span>
    </p>
  );
}

function WalkExtras({ leg }: { leg: LegDto }) {
  const { t } = useT();
  const hint = leg.tricycleHint;
  if (hint === undefined && leg.informalTransfer !== true) {
    return null;
  }
  return (
    <>
      {hint !== undefined ? (
        <div
          data-testid="tricycle-hint"
          data-terminal={hint.terminalName}
          data-distance-m={hint.distanceM}
          className="mt-2 rounded-card border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface"
        >
          <p className="font-medium">{t('trip.tricycleHint')}</p>
          <p className="text-xs text-on-surface-variant">
            {t('trip.tricycleHintNear', {
              terminal: hint.terminalName,
              distance: hint.distanceM,
            })}
          </p>
        </div>
      ) : null}
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
    </>
  );
}

function RideExtras({ leg }: { leg: LegDto }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const stops = leg.stops;
  const stopCount = stops?.length ?? 0;
  const remainingStops = Math.max(0, stopCount - 1);

  return (
    <>
      <SignagePlate leg={leg} />
      <p data-testid="alight-copy" className="mt-1 break-words text-sm text-on-surface-variant">
        {t('trip.alightAt', { place: leg.to.name })}
      </p>
      {leg.fareNotPublished === true ? (
        // PH-wide coverage: a tricycle leg has no published fare source. Show
        // the gap in words instead of a peso amount the API never sent.
        <p
          data-testid="fare-not-published"
          className="mt-2 inline-flex max-w-full items-center rounded-pill border border-outline-variant bg-surface-container-low px-3 py-1.5 text-sm font-medium text-on-surface"
        >
          {t('fare.notPublished')}
        </p>
      ) : null}
      {stops !== undefined && stopCount > 1 ? (
        <div className="mt-2">
          <p data-testid="stop-counter" className="break-words text-sm text-on-surface-variant">
            {t('trip.stopCounter', { count: remainingStops, place: leg.to.name })}
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((current) => !current)}
            className="mt-1 flex min-h-12 w-full items-center justify-start rounded-pill border border-outline-variant bg-surface-container-lowest px-4 text-left text-sm font-medium text-primary transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {expanded
              ? t('trip.stopsHide', { count: remainingStops })
              : t('trip.stopsShow', { count: remainingStops })}
          </button>
          <div id={panelId} hidden={!expanded} className="mt-1">
            {expanded ? <StopsList stops={stops} /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

interface TimelineRowProps {
  leg: LegDto;
  index: number;
  active: boolean;
  onSelectLeg?: (index: number) => void;
  rowRef: (node: HTMLLIElement | null) => void;
}

/**
 * One leg row: mode-coloured icon rail, focus-button header (eyebrow,
 * instruction, time/distance line), then the leg's extras beneath it. The stops
 * expander is a sibling button, never nested inside the focus button.
 */
function TimelineRow({ leg, index, active, onSelectLeg, rowRef }: TimelineRowProps) {
  const { t } = useT();
  const Icon = modeIcon(leg.mode);
  const walk = leg.mode === 'walk';
  const instruction = legInstruction(leg, t);

  const header = (
    <>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
        {t('trip.legNumber', { index: index + 1 })} · {modeLabel(leg.mode, t)}
      </span>
      <span
        data-testid="leg-instruction"
        className="break-words text-base font-semibold leading-6 text-on-surface"
      >
        {instruction}
      </span>
      <span data-testid="leg-stat" className="break-words text-sm text-on-surface-variant">
        {legStatText(leg, t)}
      </span>
    </>
  );

  return (
    <li
      ref={rowRef}
      data-testid="leg-row"
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'step' : undefined}
      className={`relative flex gap-3 rounded-card pb-6 last:pb-0 ${
        active ? 'bg-primary-container/40' : ''
      }`}
    >
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            walk
              ? 'border border-dashed border-outline text-on-surface-variant'
              : 'text-white'
          }`}
          style={walk ? undefined : { backgroundColor: MODE_COLORS[leg.mode] }}
        >
          <Icon className="size-5" />
        </span>
        <span aria-hidden="true" className="mt-1 w-px flex-1 bg-outline-variant" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        {onSelectLeg === undefined ? (
          <div data-testid="leg-focus" className="flex w-full flex-col items-start px-1 py-1">
            {header}
          </div>
        ) : (
          <button
            type="button"
            data-testid="leg-focus"
            aria-label={t('trip.legFocusAnnounce', { index: index + 1, title: instruction })}
            onClick={() => onSelectLeg(index)}
            className="flex w-full flex-col items-start gap-0.5 rounded-card px-1 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {header}
          </button>
        )}
        {walk ? <WalkExtras leg={leg} /> : <RideExtras leg={leg} />}
        <LandmarkLine hint={leg.landmarkHint} />
      </div>
    </li>
  );
}

export interface LegTimelineProps {
  legs: readonly LegDto[];
  /** Active leg (null = whole-route emphasis); maps to `aria-current="step"`. */
  selectedLegIndex?: number | null;
  /** Focus a leg; the screen toggles it back to the whole route when re-pressed. */
  onSelectLeg?: (index: number) => void;
}

/**
 * Vertical leg timeline (spec §11 screen 4, spec §4.2).
 *
 * One row per leg with a mode-coloured icon rail and a focus button carrying the
 * API's own instruction. Ride legs expose the signage plate, the alight copy and
 * an expandable served-stop list; walk legs show the informal-transfer buffer
 * when the API marked one. The landmark line appears only when the API sent a
 * hint — v2 removed the mandated placeholder sentence so nothing is invented.
 *
 * Map ↔ timeline sync: the screen owns `selectedLegIndex`; this component only
 * reports a tap and reflects the active row (`data-active`, `aria-current`),
 * scrolling the focused row into view for map/strip-driven selection. The
 * scroll is instant under `prefers-reduced-motion`.
 */
export function LegTimeline({ legs, selectedLegIndex = null, onSelectLeg }: LegTimelineProps) {
  const { t } = useT();
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (selectedLegIndex === null) {
      return;
    }
    const row = rowRefs.current[selectedLegIndex];
    if (row === null || row === undefined || typeof row.scrollIntoView !== 'function') {
      return;
    }
    row.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [selectedLegIndex]);

  return (
    <ol aria-label={t('trip.stepsLabel')} className="flex flex-col">
      {legs.map((leg, index) => (
        <TimelineRow
          key={`${leg.mode}-${leg.startTime}-${index}`}
          leg={leg}
          index={index}
          active={selectedLegIndex === index}
          onSelectLeg={onSelectLeg}
          rowRef={(node) => {
            rowRefs.current[index] = node;
          }}
        />
      ))}
    </ol>
  );
}
