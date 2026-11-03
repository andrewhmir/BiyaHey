import type { ItineraryDto, LegDto } from '@biyahey/shared';
import { decodePolyline } from '@biyahey/shared';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { Marker, type MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { MODE_COLORS, routeColor } from '../transit/modeMeta';
import { useMap, useMapStyleVersion } from './MapContext';

/**
 * The itinerary path layer — the map half of "choosing a route shows the
 * different paths you will take".
 *
 * It owns every overlay the map screen draws:
 *
 * - **Selected itinerary** — one GeoJSON feature per leg, so the line is drawn
 *   leg-by-leg in the mode's colour over a white casing (dashed for walk legs),
 *   with transfer dots where legs meet and origin/destination markers. The
 *   selected leg can be isolated with `activeLegIndex` (trip detail / live
 *   walkthrough): the rest of the plan dims and the focused leg draws a wider
 *   halo.
 * - **Alternatives** (`shortlist`) — each non-selected itinerary keeps its own
 *   thin, faded hue and a numbered circular marker, so the alternatives are
 *   distinguishable without colour being the only channel. Tapping one calls
 *   `onSelect`.
 * - **Camera** — fits all alternatives, the selected itinerary, or the active
 *   leg, with the `prefers-reduced-motion` preference honoured.
 *
 * Geometry rules (R53): MOTIS sends a Google-encoded polyline per leg
 * (lat-delta/lon-delta, precision 6 on the pinned build). A leg without usable
 * geometry falls back to its straight `from` → `to` segment, so old cached
 * payloads still draw. Colour is never the only carrier of meaning: the sheets
 * render leg strips/timeline text for the same data (map legend is visual only),
 * and the layer renders a visually hidden text summary for assistive tech.
 *
 * The style-ready contract is the same as the R53 fix: the component only uses
 * `MapContext`'s published map and never re-checks `isStyleLoaded()`, which is
 * false while our own `addSource`/`addLayer` calls are pending.
 */

/** Source ids owned by this component (exported for tests/E2E). */
export const ROUTE_SOURCES = {
  selected: 'route-selected',
  focus: 'route-focus',
  alternatives: 'route-alternatives',
  transfers: 'route-transfers',
} as const;

/** Layer ids owned by this component (exported for tests/E2E). */
export const ROUTE_LAYERS = {
  altCasing: 'route-alt-casing',
  altLine: 'route-alt-line',
  casing: 'route-selected-casing',
  walk: 'route-walk',
  ride: 'route-ride',
  focusHalo: 'route-focus-halo',
  focusLine: 'route-focus-line',
  transfers: 'route-transfers',
  altHit: 'route-alt-hit',
  legHit: 'route-leg-hit',
} as const;

const WALK_COLOR = MODE_COLORS.walk;
const CASING_COLOR = '#ffffff';
const DIM_OPACITY = 0.3;
const FIT_MARGIN = 56;
/**
 * Padding for the trip/live map headers, which are shorter than the sheet maps
 * and have no sheet padding of their own. Keep it small enough that the route
 * fills the visible strip: a large top+bottom padding on a ~320 px map shrinks
 * the fitted route to a sliver.
 */
const DETAIL_FIT_PADDING = { top: 56, bottom: 96, left: 36, right: 36 };
const FIT_MAX_ZOOM = 16;
const ACTIVE_LEG_MAX_ZOOM = 17;
const FIT_DURATION_MS = 450;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** One leg's line in GeoJSON `[lon, lat]` order, or its straight fallback. */
export function legCoordinates(leg: LegDto): [number, number][] {
  const geometry = leg.geometry;
  if (geometry !== undefined) {
    const decoded: [number, number][] = [];
    for (const [lat, lon] of decodePolyline(geometry.points, geometry.precision)) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const last = decoded[decoded.length - 1];
      // Encoded routes repeat vertices on purpose-encoded corners; drop the
      // consecutive duplicates so the line and bounds stay clean.
      if (last !== undefined && last[0] === lon && last[1] === lat) continue;
      decoded.push([lon, lat]);
    }
    if (decoded.length >= 2) {
      return decoded;
    }
  }
  const fallback: [number, number][] = [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
  return fallback.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    ? fallback
    : [];
}

/** The whole itinerary as one drawable line (deduped at leg joins). */
export function itineraryCoordinates(itinerary: ItineraryDto): [number, number][] {
  const coordinates: [number, number][] = [];
  const push = (lon: number, lat: number) => {
    const last = coordinates[coordinates.length - 1];
    if (last !== undefined && last[0] === lon && last[1] === lat) return;
    coordinates.push([lon, lat]);
  };
  for (const leg of itinerary.legs) {
    for (const [lon, lat] of legCoordinates(leg)) {
      push(lon, lat);
    }
  }
  return coordinates;
}

type Bounds = [[number, number], [number, number]];

/** Bounds of one or more coordinate lists; `undefined` when not drawable. */
function boundsOf(lists: readonly (readonly [number, number][])[]): Bounds | undefined {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const coordinates of lists) {
    for (const [lon, lat] of coordinates) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }
  if (!(maxLon > minLon || maxLat > minLat)) return undefined;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/** Midpoint vertex of a path, used for the numbered alternative marker. */
function midpoint(coordinates: readonly [number, number][]): [number, number] | undefined {
  if (coordinates.length === 0) return undefined;
  return coordinates[Math.floor(coordinates.length / 2)];
}

function legFeature(leg: LegDto, index: number): Feature<LineString> | undefined {
  const coordinates = legCoordinates(leg);
  if (coordinates.length < 2) return undefined;
  return {
    type: 'Feature',
    properties: {
      legIndex: index,
      mode: leg.mode,
      colour: MODE_COLORS[leg.mode] ?? WALK_COLOR,
    },
    geometry: { type: 'LineString', coordinates },
  };
}

function transferPoints(itinerary: ItineraryDto): Feature<Point>[] {
  const points: Feature<Point>[] = [];
  const legs = itinerary.legs;
  for (let index = 1; index < legs.length; index += 1) {
    const leg = legs[index];
    if (leg === undefined) continue;
    points.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [leg.from.lon, leg.from.lat] },
    });
  }
  return points;
}

/** Content signature of a drawn path, used to collapse duplicate fan-out routes. */
function pathSignature(coordinates: readonly [number, number][]): string {
  return coordinates.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
}

/** True only when the reduced-motion preference is set (jsdom: false). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function circleMarker(background: string, size: number, border = '3px solid #ffffff'): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.borderRadius = '9999px';
  element.style.background = background;
  element.style.border = border;
  element.style.boxSizing = 'border-box';
  return element;
}

function destinationMarker(): HTMLElement {
  const element = circleMarker('var(--on-surface)', 20, '3px solid #ffffff');
  const hole = document.createElement('div');
  hole.style.width = '6px';
  hole.style.height = '6px';
  hole.style.borderRadius = '9999px';
  hole.style.background = '#ffffff';
  element.style.display = 'grid';
  element.style.placeItems = 'center';
  element.appendChild(hole);
  return element;
}

function numberMarker(label: string): HTMLElement {
  const element = document.createElement('div');
  element.textContent = label;
  element.setAttribute('aria-hidden', 'true');
  element.style.width = '26px';
  element.style.height = '26px';
  element.style.borderRadius = '9999px';
  element.style.background = '#ffffff';
  element.style.border = '2px solid var(--outline-variant)';
  element.style.boxSizing = 'border-box';
  element.style.display = 'grid';
  element.style.placeItems = 'center';
  element.style.color = 'var(--on-surface)';
  element.style.font = '700 12px/1 var(--font-sans)';
  element.style.boxShadow = 'var(--elevation-1)';
  return element;
}

export type RoutePathVariant = 'shortlist' | 'detail';
export type RoutePathFit = 'all' | 'selected' | 'active-leg' | 'none';

export interface RoutePathLayerProps {
  itineraries: readonly ItineraryDto[];
  /** `shortlist` draws alternatives + the selected route; `detail` draws one route. */
  variant?: RoutePathVariant;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Detail/live: the leg to isolate; `null` emphasises the whole route. */
  activeLegIndex?: number | null;
  onSelectLeg?: (index: number) => void;
  /** Camera target; defaults to `all` on the shortlist and `selected` in detail. */
  fit?: RoutePathFit;
  /** Animate camera moves; `false` or reduced motion keeps the fit instant. */
  animated?: boolean;
}

export function RoutePathLayer({
  itineraries,
  variant = 'shortlist',
  selectedId = null,
  onSelect,
  activeLegIndex = null,
  onSelectLeg,
  fit,
  animated = true,
}: RoutePathLayerProps) {
  const map = useMap();
  const styleVersion = useMapStyleVersion();
  const { t } = useT();
  const reducedMotion = usePrefersReducedMotion();
  // Keep the latest callbacks without making them layer-teardown dependencies.
  const onSelectRef = useRef(onSelect);
  const onSelectLegRef = useRef(onSelectLeg);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onSelectLegRef.current = onSelectLeg;
  }, [onSelect, onSelectLeg]);

  const selected =
    itineraries.find((itinerary) => itinerary.id === selectedId) ?? itineraries[0] ?? null;
  const alternatives =
    variant === 'shortlist'
      ? itineraries.filter((itinerary) => itinerary.id !== selected?.id)
      : [];
  const canSelectLeg = onSelectLeg !== undefined;
  /**
   * Content identity of the plan, independent of array identity.
   *
   * The trip/live pages build `itineraries={[itinerary]}` inside a render prop,
   * so every parent render allocates a new array with the same content. Keying
   * the layer/camera effects on this string means a save, a walkthrough step or
   * any other re-render keeps the overlays and the rider's pan/zoom intact
   * (review I4); a genuinely different plan re-keys and rebuilds.
   */
  const planKey = useMemo(
    () =>
      itineraries
        .map(
          (itinerary) =>
            `${itinerary.id}:${itinerary.legs
              .map(
                (leg) =>
                  `${leg.mode}@${leg.startTime}:${leg.geometry?.points.length ?? 0}:${leg.from.lat},${leg.from.lon}`,
              )
              .join(',')}`,
        )
        .join('|'),
    [itineraries],
  );

  /**
   * The alternatives that actually get drawn: one per unique physical path.
   * MOTIS's fan-out can return the same route several times with different ids;
   * the map must not stack numbered badges on one line, and the observable
   * `data-alternative-count` has to match the drawn features (review M8).
   */
  const drawnAlternatives = useMemo(() => {
    const seen = new Set<string>();
    if (selected !== null) {
      seen.add(pathSignature(itineraryCoordinates(selected)));
    }
    const drawn: ItineraryDto[] = [];
    for (const itinerary of alternatives) {
      const signature = pathSignature(itineraryCoordinates(itinerary));
      if (seen.has(signature)) continue;
      seen.add(signature);
      drawn.push(itinerary);
    }
    return drawn;
    // `planKey` carries the plan content; `selected`/`alternatives` derive from it.
  }, [planKey, selectedId, variant]);

  // Sources, layers and markers are owned by this effect so unmount (or a style
  // reload, via `styleVersion`) leaves nothing behind.
  useEffect(() => {
    if (!map) return;

    const ownedLayers = Object.values(ROUTE_LAYERS);
    const ownedSources = Object.values(ROUTE_SOURCES);
    const markerInstances: Marker[] = [];
    const clickHandlers: { layerId: string; handler: (event: MapLayerMouseEvent) => void }[] = [];

    const removeOwned = () => {
      for (const { layerId, handler } of clickHandlers) {
        try {
          map.off('click', layerId, handler);
        } catch {
          // The map may already be gone; nothing left to detach.
        }
      }
      for (const marker of markerInstances) {
        marker.remove();
      }
      for (const layerId of ownedLayers) {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        } catch {
          // Canvas teardown already removed the layer.
        }
      }
      for (const sourceId of ownedSources) {
        try {
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch {
          // Canvas teardown already removed the source.
        }
      }
    };

    // Defensive: a prior effect run should have removed these, but a style
    // reload or a StrictMode double-invoke can leave a source behind.
    removeOwned();

    if (selected === null) {
      return removeOwned;
    }

    const legFeatures = selected.legs
      .map((leg, index) => legFeature(leg, index))
      .filter((feature): feature is Feature<LineString> => feature !== undefined);

    const altFeatures: Feature<LineString>[] = [];
    const altMarkers: { coordinates: [number, number]; label: string }[] = [];
    for (const itinerary of drawnAlternatives) {
      const coordinates = itineraryCoordinates(itinerary);
      if (coordinates.length < 2) continue;
      altFeatures.push({
        type: 'Feature',
        properties: {
          itineraryId: itinerary.id,
          colour: routeColor(itinerary),
        },
        geometry: { type: 'LineString', coordinates },
      });
      const point = midpoint(coordinates);
      if (point !== undefined) {
        altMarkers.push({
          coordinates: point,
          label: String(itineraries.findIndex((entry) => entry.id === itinerary.id) + 1),
        });
      }
    }

    const transfers: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: transferPoints(selected),
    };

    const legsCollection: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: legFeatures,
    };
    const alternativesCollection: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: altFeatures,
    };

    // The focused leg (detail/live) draws on top of a dimmed plan.
    const focusedLeg =
      activeLegIndex !== null ? selected.legs[activeLegIndex] ?? undefined : undefined;
    const focusFeature =
      focusedLeg !== undefined ? legFeature(focusedLeg, activeLegIndex ?? 0) : undefined;

    map.addSource(ROUTE_SOURCES.selected, { type: 'geojson', data: legsCollection });
    map.addSource(ROUTE_SOURCES.alternatives, {
      type: 'geojson',
      data: alternativesCollection,
    });
    map.addSource(ROUTE_SOURCES.transfers, { type: 'geojson', data: transfers });
    if (focusFeature !== undefined) {
      map.addSource(ROUTE_SOURCES.focus, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [focusFeature] },
      });
    }

    const dimmed = focusedLeg !== undefined;

    // Bottom → top: alternative casing/line, selected casing, legs, focus, dots,
    // then the invisible hit lines (the only layers that receive clicks).
    if (altFeatures.length > 0) {
      map.addLayer({
        id: ROUTE_LAYERS.altCasing,
        type: 'line',
        source: ROUTE_SOURCES.alternatives,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CASING_COLOR, 'line-width': 9, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: ROUTE_LAYERS.altLine,
        type: 'line',
        source: ROUTE_SOURCES.alternatives,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': 4.5,
          'line-opacity': 0.82,
        },
      });
    }

    map.addLayer({
      id: ROUTE_LAYERS.casing,
      type: 'line',
      source: ROUTE_SOURCES.selected,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': CASING_COLOR,
        'line-width': 13,
        'line-opacity': dimmed ? 0.4 : 0.95,
      },
    });
    map.addLayer({
      id: ROUTE_LAYERS.walk,
      type: 'line',
      source: ROUTE_SOURCES.selected,
      filter: ['==', ['get', 'mode'], 'walk'],
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': WALK_COLOR,
        'line-width': 6,
        'line-dasharray': [2, 2],
        'line-opacity': dimmed ? DIM_OPACITY : 1,
      },
    });
    map.addLayer({
      id: ROUTE_LAYERS.ride,
      type: 'line',
      source: ROUTE_SOURCES.selected,
      filter: ['!=', ['get', 'mode'], 'walk'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': 7,
        'line-opacity': dimmed ? DIM_OPACITY : 1,
      },
    });

    if (focusFeature !== undefined) {
      map.addLayer({
        id: ROUTE_LAYERS.focusHalo,
        type: 'line',
        source: ROUTE_SOURCES.focus,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CASING_COLOR, 'line-width': 17, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: ROUTE_LAYERS.focusLine,
        type: 'line',
        source: ROUTE_SOURCES.focus,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': 9,
          'line-opacity': 1,
          // A focused walk leg keeps the dashed treatment the map uses for
          // walking: drawing it solid made it read as a ride.
          ...(focusedLeg?.mode === 'walk' ? { 'line-dasharray': [2, 2] } : {}),
        },
      });
    }

    map.addLayer({
      id: ROUTE_LAYERS.transfers,
      type: 'circle',
      source: ROUTE_SOURCES.transfers,
      paint: {
        'circle-radius': 4,
        'circle-color': '#0b1d24',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': dimmed ? 0.5 : 1,
      },
    });

    if (altFeatures.length > 0) {
      map.addLayer({
        id: ROUTE_LAYERS.altHit,
        type: 'line',
        source: ROUTE_SOURCES.alternatives,
        paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0 },
      });
      const onAltClick = (event: MapLayerMouseEvent) => {
        const itineraryId = event.features?.[0]?.properties?.['itineraryId'];
        if (typeof itineraryId === 'string') {
          onSelectRef.current?.(itineraryId);
        }
      };
      map.on('click', ROUTE_LAYERS.altHit, onAltClick);
      clickHandlers.push({ layerId: ROUTE_LAYERS.altHit, handler: onAltClick });
    }

    if (onSelectLeg !== undefined && legFeatures.length > 0) {
      map.addLayer({
        id: ROUTE_LAYERS.legHit,
        type: 'line',
        source: ROUTE_SOURCES.selected,
        paint: { 'line-color': '#000000', 'line-width': 20, 'line-opacity': 0 },
      });
      const onLegClick = (event: MapLayerMouseEvent) => {
        const legIndex = event.features?.[0]?.properties?.['legIndex'];
        if (typeof legIndex === 'number') {
          onSelectLegRef.current?.(legIndex);
        }
      };
      map.on('click', ROUTE_LAYERS.legHit, onLegClick);
      clickHandlers.push({ layerId: ROUTE_LAYERS.legHit, handler: onLegClick });
    }

    // Origin / destination pins for the selected itinerary.
    const origin = selected.legs[0]?.from;
    const destination = selected.legs[selected.legs.length - 1]?.to;
    if (origin !== undefined) {
      markerInstances.push(
        new Marker({ element: circleMarker('var(--primary)', 18) })
          .setLngLat([origin.lon, origin.lat])
          .addTo(map),
      );
    }
    if (destination !== undefined) {
      markerInstances.push(
        new Marker({ element: destinationMarker() })
          .setLngLat([destination.lon, destination.lat])
          .addTo(map),
      );
    }
    for (const { coordinates, label } of altMarkers) {
      markerInstances.push(
        new Marker({ element: numberMarker(label) })
          .setLngLat([coordinates[0], coordinates[1]])
          .addTo(map),
      );
    }

    return removeOwned;
    // `onSelect`/`onSelectLeg` are read through refs on purpose; including them
    // would tear down every layer on each parent render. `planKey` carries the
    // plan content so a same-content array re-render is a no-op (review I4).
  }, [map, styleVersion, planKey, selectedId, variant, activeLegIndex, canSelectLeg]);

  // Camera fit. MapLibre subtracts the map's own `setPadding` (the sheet detent,
  // published by MapCanvas) before applying this margin, so the sheet must never
  // be added here as well — that made `cameraForBounds` refuse the fit (R53).
  useEffect(() => {
    if (!map) return;
    const target = fit ?? (variant === 'detail' ? 'selected' : 'all');
    if (target === 'none') return;

    let lists: (readonly [number, number][])[] = [];
    if (target === 'all') {
      lists = itineraries.map((itinerary) => itineraryCoordinates(itinerary));
    } else if (target === 'selected') {
      lists = selected === null ? [] : [itineraryCoordinates(selected)];
    } else {
      const leg =
        selected === null || activeLegIndex === null
          ? undefined
          : selected.legs[activeLegIndex] ?? undefined;
      lists =
        leg !== undefined
          ? [legCoordinates(leg)]
          : selected === null
            ? []
            : [itineraryCoordinates(selected)];
    }

    const bounds = boundsOf(lists);
    if (bounds === undefined) return;

    const instant = animated === false || reducedMotion;
    map.fitBounds(bounds, {
      padding: variant === 'detail' ? DETAIL_FIT_PADDING : FIT_MARGIN,
      maxZoom: target === 'active-leg' ? ACTIVE_LEG_MAX_ZOOM : FIT_MAX_ZOOM,
      duration: instant ? 0 : FIT_DURATION_MS,
    });
  }, [
    map,
    styleVersion,
    fit,
    variant,
    planKey,
    selected,
    activeLegIndex,
    animated,
    reducedMotion,
  ]);

  return (
    <div
      className="sr-only"
      data-testid="route-map-state"
      data-selected-id={selected?.id ?? ''}
      data-active-leg={activeLegIndex === null ? '' : String(activeLegIndex)}
      data-alternative-count={drawnAlternatives.length}
      data-route-count={itineraries.length}
    >
      {t('map.routeCount', { count: itineraries.length })}
    </div>
  );
}
