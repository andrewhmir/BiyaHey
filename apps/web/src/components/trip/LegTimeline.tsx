import type { LegDto } from '@biyahey/shared';
import {
  Bus,
  CarTaxiFront,
  ChevronDown,
  ChevronUp,
  Footprints,
  Ship,
  TrainFront,
  Van,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useCopy } from '../../i18n';
import { modeColor, modeLabel } from '../../map/modes';
import { endpointName, legInstruction, legStatText, signageText, type EndpointLabels } from './itinerary';
import { StopsList } from './StopsList';

const MODE_ICONS: Record<string, LucideIcon> = {
  walk: Footprints,
  jeepney: Bus,
  bus: Bus,
  mrt3: TrainFront,
  lrt1: TrainFront,
  lrt2: TrainFront,
  ferry: Ship,
  'uv-express': Van,
  p2p: Bus,
  tricycle: CarTaxiFront,
};

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function LegRow({
  leg,
  index,
  last,
  active,
  labels,
  onFocus,
  rowRef,
}: {
  leg: LegDto;
  index: number;
  last: boolean;
  active: boolean;
  labels: EndpointLabels;
  onFocus: (index: number) => void;
  rowRef: (node: HTMLLIElement | null) => void;
}) {
  const { t } = useCopy();
  const panelId = useId();
  const [stopsOpen, setStopsOpen] = useState(false);
  const Icon = MODE_ICONS[leg.mode] ?? Bus;
  const walk = leg.mode === 'walk';
  const instruction = legInstruction(leg, t, labels);
  const stops = leg.stops;
  const remainingStops = stops === undefined ? 0 : Math.max(0, stops.length - 1);

  return (
    <li
      ref={rowRef}
      aria-current={active ? 'step' : undefined}
      className={`flex gap-3 rounded-lg transition ${
        active ? 'bg-brand-tint ring-1 ring-brand/40' : ''
      }`}
    >
      <div className="flex flex-col items-center pl-1 pt-2">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
          style={{ backgroundColor: modeColor(leg.mode) }}
        >
          <Icon className="size-5" />
        </span>
        {!last && <span aria-hidden="true" className="mt-1 w-px flex-1 bg-line-strong" />}
      </div>

      <div className={`min-w-0 flex-1 pr-2 pt-2 ${last ? '' : 'pb-5'}`}>
        <button
          type="button"
          onClick={() => onFocus(index)}
          aria-label={t('trip.legFocusAnnounce', { index: index + 1, title: instruction })}
          className="flex w-full flex-col items-start gap-0.5 rounded-md p-1 text-left transition hover:bg-canvas"
        >
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>{t('trip.legNumber', { index: index + 1 })}</span>
            <span aria-hidden="true">·</span>
            <span>{modeLabel(leg.mode, t)}</span>
            {walk && leg.informalTransfer === true ? (
              <span className="rounded bg-line px-1.5 py-0.5 text-[10px] text-ink-soft">
                {t('trip.lipat')}
              </span>
            ) : null}
            {active ? (
              <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] text-white">
                {t('trip.liveCurrent')}
              </span>
            ) : null}
          </span>
          <span className="break-words text-sm font-semibold leading-snug text-ink">
            {instruction}
          </span>
          <span className="break-words text-xs text-ink-faint">{legStatText(leg, t)}</span>
        </button>

        {walk ? null : (
          <>
            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 px-1 text-xs text-ink-soft">
              <span>
                <span className="text-ink-faint">{t('trip.board')}:</span>{' '}
                {endpointName(leg, 'from', labels)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="text-ink-faint">{t('trip.baba')}:</span>{' '}
                {endpointName(leg, 'to', labels)}
              </span>
            </p>
            <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-1 text-xs text-ink">
              <span className="font-semibold uppercase tracking-wide text-ink-faint">
                {t('trip.signageLabel')}
              </span>
              <span className="min-w-0 break-words font-medium">{signageText(leg, t)}</span>
            </p>
            {leg.fareNotPublished === true ? (
              <p className="mt-2 inline-flex items-center rounded-md border border-line bg-warning/15 px-2.5 py-1 text-xs font-semibold text-ink">
                {t('fare.notPublished')}
              </p>
            ) : null}
            {stops !== undefined && stops.length > 1 ? (
              <div className="mt-2">
                <p className="px-1 text-xs text-ink-faint">
                  {t('trip.stopCounter', {
                    count: remainingStops,
                    place: endpointName(leg, 'to', labels),
                  })}
                </p>
                <button
                  type="button"
                  aria-expanded={stopsOpen}
                  aria-controls={panelId}
                  onClick={() => setStopsOpen((open) => !open)}
                  className="mt-1 inline-flex min-h-12 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand-tint"
                >
                  {stopsOpen ? (
                    <ChevronUp aria-hidden="true" className="size-4" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-4" />
                  )}
                  {stopsOpen
                    ? t('trip.stopsHide', { count: remainingStops })
                    : t('trip.stopsShow', { count: remainingStops })}
                </button>
                <div id={panelId} hidden={!stopsOpen}>
                  {stopsOpen ? <StopsList stops={stops} /> : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        {walk && leg.tricycleHint !== undefined ? (
          <div className="mt-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink-soft">
            <p className="font-semibold text-ink">{t('trip.tricycleHint')}</p>
            <p className="mt-0.5">
              {t('trip.tricycleHintNear', {
                terminal: leg.tricycleHint.terminalName,
                distance: leg.tricycleHint.distanceM,
              })}
            </p>
          </div>
        ) : null}

        {walk && leg.informalTransfer === true ? (
          <p className="mt-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink-soft">
            <span className="font-semibold text-ink">{t('trip.lipat')}</span>
            {' · '}
            {t('trip.transferBuffer')}
          </p>
        ) : null}

        {leg.landmarkHint !== null ? (
          <p className="mt-1 px-1 text-xs text-ink-faint">
            {t('trip.landmark', { hint: leg.landmarkHint })}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export interface LegTimelineProps {
  legs: readonly LegDto[];
  /** The leg emphasised on the map (null = whole route). */
  activeIndex: number | null;
  /** Rider place labels that replace MOTIS `START`/`END`/platform names. */
  labels?: EndpointLabels;
  onFocus: (index: number) => void;
}

/** Step-by-step itinerary; the focused row is kept in sync with the map. */
export function LegTimeline({ legs, activeIndex, labels = {}, onFocus }: LegTimelineProps) {
  const { t } = useCopy();
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (activeIndex === null) return;
    const row = rowRefs.current[activeIndex];
    if (row === null || row === undefined || typeof row.scrollIntoView !== 'function') return;
    row.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeIndex]);

  return (
    <ol aria-label={t('trip.stepsLabel')} className="flex flex-col">
      {legs.map((leg, index) => (
        <LegRow
          key={`${leg.mode}-${leg.startTime}-${index}`}
          leg={leg}
          index={index}
          last={index === legs.length - 1}
          active={activeIndex === index}
          labels={labels}
          onFocus={onFocus}
          rowRef={(node) => {
            rowRefs.current[index] = node;
          }}
        />
      ))}
    </ol>
  );
}
