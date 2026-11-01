import type { DataSource } from '@biyahey/shared';
import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { AboutDataLink } from '../navigation/AboutDataLink';
import { useMap } from './MapContext';

/**
 * Always-visible L1 map credit (OSMF attribution requirements).
 *
 * The OpenStreetMap and OpenFreeMap/OpenMapTiles wording is the one attribution
 * that may be hardcoded: R45 allows the tile-provider + OSM credit to be derived
 * from the basemap source ids instead of repeating registry rows in the bundle.
 * The `sources` rows from the last plan response still drive the ⓘ detail list
 * (name + licence link), so data-specific credit is never hardcoded here.
 *
 * The full line collapses to a labelled ⓘ button after 5 s (OSMF guidance: the
 * credit must be reachable, not permanently expanded) or after the first map
 * interaction. The button always remains and `autoCollapseMs` is a test hook.
 *
 * Task 9: the ⓘ toggle is a 48 dp target (M1), the details popover closes with
 * Escape and returns focus to the toggle, and focus moves into the popover while
 * it is open — aligning this lightweight dialog with the L3 licence sheet.
 */

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OPENFREEMAP_URL = 'https://openfreemap.org';
export const OPENMAPTILES_URL = 'https://openmaptiles.org/';

/** OSMF asks that a permanently visible credit not dominate a small map. */
const DEFAULT_AUTO_COLLAPSE_MS = 5000;

const MAP_INTERACTION_EVENTS = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'click'] as const;

export interface MapCreditProps {
  /** Provenance rows from the API response; only used for the ⓘ detail list. */
  sources?: readonly DataSource[];
  /** Milliseconds before collapsing; `0` keeps the line expanded (tests). */
  autoCollapseMs?: number;
  className?: string;
}

export function MapCredit({
  sources = [],
  autoCollapseMs = DEFAULT_AUTO_COLLAPSE_MS,
  className,
}: MapCreditProps) {
  const map = useMap();
  const { t } = useT();
  const [showCredit, setShowCredit] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoCollapseMs <= 0) return;
    const timer = window.setTimeout(() => setShowCredit(false), autoCollapseMs);
    return () => window.clearTimeout(timer);
  }, [autoCollapseMs]);

  useEffect(() => {
    if (!map) return;
    const collapse = () => setShowCredit(false);
    for (const event of MAP_INTERACTION_EVENTS) map.on(event, collapse);
    return () => {
      for (const event of MAP_INTERACTION_EVENTS) map.off(event, collapse);
    };
  }, [map]);

  // Move focus into the popover while it is open; Escape closes it and returns
  // focus to the control that opened it.
  useEffect(() => {
    if (!detailsOpen) return;
    dialogRef.current?.focus();
  }, [detailsOpen]);

  const closeDetails = () => {
    setDetailsOpen(false);
    toggleRef.current?.focus();
  };

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeDetails();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // `closeDetails` is recreated per render and reads the current state.
  }, [detailsOpen]);

  const toggleDetails = () => {
    setDetailsOpen((open) => !open);
    // Re-opening the ⓘ always restores the collapsed credit line.
    setShowCredit(true);
  };

  return (
    <div
      data-testid="map-credit"
      className={`pointer-events-auto relative flex flex-col items-start gap-1 ${className ?? ''}`}
    >
      {showCredit && (
        <p className="rounded-pill bg-inverse-surface px-3 py-1 text-[11px] leading-4 text-inverse-on-surface shadow-elevation-1">
          <a
            href={OSM_COPYRIGHT_URL}
            aria-label="OpenStreetMap copyright"
            className="underline underline-offset-2"
          >
            © OpenStreetMap contributors
          </a>
          <span aria-hidden="true"> · </span>
          <a href={OPENFREEMAP_URL} aria-label="OpenFreeMap" className="underline underline-offset-2">
            OpenFreeMap
          </a>
          <span aria-hidden="true"> · </span>
          <a
            href={OPENMAPTILES_URL}
            aria-label="OpenMapTiles copyright"
            className="underline underline-offset-2"
          >
            © OpenMapTiles
          </a>
        </p>
      )}

      <button
        ref={toggleRef}
        type="button"
        aria-label={t('common.dataSources')}
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? detailsId : undefined}
        onClick={toggleDetails}
        className="pointer-events-auto flex size-12 items-center justify-center rounded-pill bg-surface-container-lowest text-on-surface-variant shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Info aria-hidden="true" className="size-5" />
      </button>

      {detailsOpen && (
        <div
          ref={dialogRef}
          id={detailsId}
          role="dialog"
          aria-label={t('common.dataSources')}
          tabIndex={-1}
          className="absolute bottom-full left-0 mb-2 w-72 rounded-card bg-surface-container-lowest p-3 text-xs text-on-surface shadow-elevation-3 focus:outline-none"
        >
          <p className="mb-2 text-sm font-semibold">{t('map.creditKicker')}</p>
          {sources.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {sources.map((source) => (
                <li key={source.id}>
                  <span>{source.name}</span>{' '}
                  <a
                    href={source.licence_url}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {source.licence_spdx}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('map.creditEmpty')}</p>
          )}
          {/* Task 7: one tap from the ⓘ detail to the full L2/L3 screen. */}
          <AboutDataLink className="mt-2 text-sm font-medium text-primary">
            {t('common.aboutData')}
          </AboutDataLink>
        </div>
      )}
    </div>
  );
}
