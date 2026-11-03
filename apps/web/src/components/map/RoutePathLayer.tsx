import type { ItineraryDto, LegDto } from '@biyahey/shared';
import { decodePolyline } from '@biyahey/shared';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import {
  Marker,
  type MapLayerMouseEvent,
  type Map as MapLibreMap,
} from 'maplibre-gl';
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
 *   leg-by-leg in the mode's colour over a wide white casing (dashed for walk
 *   legs), with transfer dots where legs meet and origin/destination markers.
 *   The selected leg can be isolated with `activeLegIndex` (trip detail / live
 *   walkthrough): the rest of the plan dims and the focused leg draws a wider
 *   halo.
 * - **Alternatives** (`shortlist`) — each non-selected itinerary keeps its own
 *   thin, neutral line and a numbered circular marker, so the alternatives read
 *   as "the other options" without competing with the selected route. Tapping
 *   one calls `onSelect`.
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
 *
 * Performance contract: the sources and layers are added once per style load
 * (`styleVersion`) and every later plan/selection change only pushes data with
 * `setData()` and paint properties with `setPaintProperty()`. Tearing the style
 * down on every card tap forced MapLibre to rebuild its render tiles on the
 * main thread and made the map flash; the two effects below keep that boundary
 * explicit (correctness review, choppiness pass).
 */

/** Source ids owned by this component (exported for tests/E2E). */
export const ROUTE_SOURCES = {
  selected: 'route-selected',
  focus: 'route-focus',
  alternatives: 'route-alternatives',
  transfers: 'route-transfers',
  approximate: 'route-approximate',
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
  approxCasing: 'route-approx-casing',
  approxLine: 'route-approx-line',
  altHit: 'route-alt-hit',
  legHit: 'route-leg-hit',
} as const;

const WALK_COLOR = MODE_COLORS.walk;
const CASING_COLOR = '#ffffff';
/**
 * Alternatives are deliberately neutral and thin: the selected route is the
 * answer, the alternatives are context. Google Maps uses the same hierarchy —
 * one bold mode-coloured line, the rest muted — so a rider can tell at a glance
 * which path the card belongs to.
 */
const ALT_COLOR = '#7a878d';
const ALT_LINE_WIDTH = 3.2;
const ALT_CASING_WIDTH = 7;
const SELECTED_CASING_WIDTH = 16;
const WALK_LINE_WIDTH = 7;
const RIDE_LINE_WIDTH = 8.5;
const FOCUS_HALO_WIDTH = 17;
const FOCUS_LINE_WIDTH = 9;
/** A leg drawn as a straight chord is a fallback, never a routed path. */
const APPROX_CAUSING_WIDTH = 10;
const APPROX_LINE_WIDTH = 5;
const APPROX_MAX_SEGMENT_M = 5000;
const APPROX_SHORT_GEOMETRY_M = 2000;
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
const FIT_DURATION_MS = 350;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const EMPTY_LINES: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] };
const EMPTY_POINTS: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

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

/**
 * Coverage grid for near-duplicate paths. MOTIS's fan-out returns the same
 * corridor several times (different departures, slightly different platform
 * start points), and an exact-coordinate signature cannot see that: the
 * alternatives end up hidden underneath the selected line while their numbered
 * badges sit on top of it. Cells are ~33 m; checking the 8 neighbours treats a
 * candidate vertex as covered within roughly 60 m of the reference path.
 */
const COVERAGE_CELL_DEG = 0.0003;
const COVERAGE_THRESHOLD = 0.9;

function coverageCells(coordinates: readonly [number, number][]): Set<string> {
  const cells = new Set<string>();
  for (const [lon, lat] of coordinates) {
    cells.add(
      `${Math.round(lon / COVERAGE_CELL_DEG)}:${Math.round(lat / COVERAGE_CELL_DEG)}`,
    );
  }
  return cells;
}

/** Fraction of `candidate` vertices that lie on (or within one cell of) `cells`. */
function coverageOf(cells: Set<string>, candidate: readonly [number, number][]): number {
  if (candidate.length === 0) return 0;
  let covered = 0;
  for (const [lon, lat] of candidate) {
    if (isPointCovered(cells, lon, lat)) covered += 1;
  }
  return covered / candidate.length;
}

/** True when `[lon, lat]` sits in `cells` or one of the eight neighbour cells. */
function isPointCovered(cells: Set<string>, lon: number, lat: number): boolean {
  const cx = Math.round(lon / COVERAGE_CELL_DEG);
  const cy = Math.round(lat / COVERAGE_CELL_DEG);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (cells.has(`${cx + dx}:${cy + dy}`)) return true;
    }
  }
  return false;
}

/**
 * A vertex where an alternative visibly leaves the selected corridor.
 *
 * Putting the numbered badge on the path's midpoint looks like it numbers the
 * selected route when the two lines agree for most of their length; the badge
 * belongs where the alternative actually differs.
 */
function distinguishingPoint(
  selectedCells: Set<string>,
  coordinates: readonly [number, number][],
): [number, number] | undefined {
  const deviating = coordinates.filter(
    ([lon, lat]) => !isPointCovered(selectedCells, lon, lat),
  );
  if (deviating.length === 0) return undefined;
  return deviating[Math.floor(deviating.length / 2)];
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two `[lat, lon]` points. */
function haversineM(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * True when a drawn line is a fallback chord rather than a routed path.
 *
 * MOTIS returns the feed shape for a transit leg, so a two-point line means the
 * feed had no usable geometry for that route; a multi-point line with a
 * kilometre-scale jump is a broken shape. Drawing either as a solid
 * mode-coloured path claims "this is the route, you can walk through these
 * buildings" — the reported bug. They are still drawn (the ride exists) but
 * dashed and muted as an approximate alignment, and counted in the state
 * mirror so tests/screens can tell them apart.
 */
function isApproximateFeature(feature: Feature<LineString>): boolean {
  const coordinates = feature.geometry.coordinates;
  if (coordinates.length < 2) return false;
  let length = 0;
  let maxSegment = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lonA, latA] = coordinates[index - 1]!;
    const [lonB, latB] = coordinates[index]!;
    const segment = haversineM([latA, lonA], [latB, lonB]);
    length += segment;
    maxSegment = Math.max(maxSegment, segment);
  }
  if (coordinates.length <= 2) {
    return length > APPROX_SHORT_GEOMETRY_M;
  }
  return maxSegment > APPROX_MAX_SEGMENT_M;
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

/** Live marker bookkeeping: instances are reused across plan/selection changes. */
interface MarkerStore {
  origin?: Marker;
  destination?: Marker;
  alternatives: Map<string, { marker: Marker; label: string }>;
}

function emptyMarkerStore(): MarkerStore {
  return { alternatives: new Map() };
}

type OwnedClickHandler = { layerId: string; handler: (event: MapLayerMouseEvent) => void };

function removeOwnedStyle(map: MapLibreMap): void {
  for (const layerId of Object.values(ROUTE_LAYERS)) {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch {
      // Canvas teardown already removed the layer.
    }
  }
  for (const sourceId of Object.values(ROUTE_SOURCES)) {
    try {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {
      // Canvas teardown already removed the source.
    }
  }
}

function setData(map: MapLibreMap, sourceId: string, data: FeatureCollection): void {
  // Duck-typed on purpose: only GeoJSON sources are created by this component,
  // and a real MapLibre `GeoJSONSource` and the jsdom double both expose
  // `setData`. Importing the class just to `instanceof`-check it would pull the
  // GL bundle into any environment that imports this module's helpers.
  const source = map.getSource(sourceId) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (typeof source?.setData === 'function') {
    source.setData(data);
  }
}

function setPaint(
  map: MapLibreMap,
  layerId: string,
  property: Parameters<MapLibreMap['setPaintProperty']>[1],
  value: unknown,
): void {
  if (map.getLayer(layerId)) {
    map.setPaintProperty(
      layerId,
      property,
      value as Parameters<MapLibreMap['setPaintProperty']>[2],
    );
  }
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
  const markersRef = useRef<MarkerStore>(emptyMarkerStore());
  /**
   * Content identity of the plan, independent of array identity.
   *
   * The trip/live pages build `itineraries={[itinerary]}` inside a render prop,
   * so every parent render allocates a new array with the same content. Keying
   * the data/camera effects on this string means a save, a walkthrough step or
   * any other re-render keeps the overlays and the rider's pan/zoom intact
   * (review I4); a genuinely different plan re-keys and refreshes.
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
   * The alternatives that actually get drawn: one per distinct physical path.
   * MOTIS's fan-out can return the same route several times with different ids
   * and slightly different platform points; the map must not stack numbered
   * badges on one line, and the observable `data-alternative-count` has to match
   * the drawn features (review M8, extended after the 2026-11-03 beeline pass).
   */
  const drawnAlternatives = useMemo(() => {
    const referencePaths: Set<string>[] = [];
    if (selected !== null) {
      referencePaths.push(coverageCells(itineraryCoordinates(selected)));
    }
    const drawn: ItineraryDto[] = [];
    for (const itinerary of alternatives) {
      const coordinates = itineraryCoordinates(itinerary);
      if (coordinates.length < 2) continue;
      if (
        referencePaths.some((cells) => coverageOf(cells, coordinates) >= COVERAGE_THRESHOLD)
      ) {
        continue;
      }
      referencePaths.push(coverageCells(coordinates));
      drawn.push(itinerary);
    }
    return drawn;
    // `planKey` carries the plan content; `selected`/`alternatives` derive from it.
  }, [planKey, selectedId, variant]);

  /**
   * The selected itinerary split into routed legs (drawn in mode colours) and
   * chord fallbacks (dashed "approximate alignment"). Splitting here keeps the
   * classification out of the style effect and gives the state mirror a count.
   */
  const legLayers = useMemo(() => {
    const solid: Feature<LineString>[] = [];
    const approximate: Feature<LineString>[] = [];
    if (selected !== null) {
      selected.legs.forEach((leg, index) => {
        const feature = legFeature(leg, index);
        if (feature === undefined) return;
        if (isApproximateFeature(feature)) {
          approximate.push(feature);
        } else {
          solid.push(feature);
        }
      });
    }
    return { solid, approximate };
  }, [selected]);

  /**
   * Card number for each itinerary id, keyed by the plan content rather than the
   * array identity the trip/live render props rebuild on every parent render.
   */
  const itineraryOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const [index, itinerary] of itineraries.entries()) {
      order.set(itinerary.id, index + 1);
    }
    return order;
    // `planKey` is the content identity of `itineraries`.
  }, [planKey]);

  // Style ownership: sources, layers, click handlers and markers are created
  // once per style load. Everything else pushes data into the existing style.
  useEffect(() => {
    if (!map) return;

    const store = emptyMarkerStore();
    markersRef.current = store;
    const clickHandlers: OwnedClickHandler[] = [];

    const removeOwned = () => {
      for (const { layerId, handler } of clickHandlers) {
        try {
          map.off('click', layerId, handler);
        } catch {
          // The map may already be gone; nothing left to detach.
        }
      }
      // Markers are created by the data effect but owned here, so a style reload
      // or an unmount removes the pins as well as the layers.
      store.origin?.remove();
      store.destination?.remove();
      for (const entry of store.alternatives.values()) entry.marker.remove();
      store.alternatives.clear();
      store.origin = undefined;
      store.destination = undefined;
      markersRef.current = emptyMarkerStore();
      removeOwnedStyle(map);
    };

    // Defensive: a prior effect run should have removed these, but a style
    // reload or a StrictMode double-invoke can leave a source behind.
    removeOwnedStyle(map);

    map.addSource(ROUTE_SOURCES.selected, { type: 'geojson', data: EMPTY_LINES });
    map.addSource(ROUTE_SOURCES.alternatives, { type: 'geojson', data: EMPTY_LINES });
    map.addSource(ROUTE_SOURCES.focus, { type: 'geojson', data: EMPTY_LINES });
    map.addSource(ROUTE_SOURCES.transfers, { type: 'geojson', data: EMPTY_POINTS });
    map.addSource(ROUTE_SOURCES.approximate, { type: 'geojson', data: EMPTY_LINES });

    // Bottom → top: alternative casing/line, selected casing, legs, focus, dots,
    // then the invisible hit lines (the only layers that receive clicks).
    map.addLayer({
      id: ROUTE_LAYERS.altCasing,
      type: 'line',
      source: ROUTE_SOURCES.alternatives,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CASING_COLOR, 'line-width': ALT_CASING_WIDTH, 'line-opacity': 0.85 },
    });
    map.addLayer({
      id: ROUTE_LAYERS.altLine,
      type: 'line',
      source: ROUTE_SOURCES.alternatives,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ALT_COLOR,
        'line-width': ALT_LINE_WIDTH,
        'line-opacity': 0.55,
      },
    });

    map.addLayer({
      id: ROUTE_LAYERS.casing,
      type: 'line',
      source: ROUTE_SOURCES.selected,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': CASING_COLOR,
        'line-width': SELECTED_CASING_WIDTH,
        'line-opacity': 0.95,
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
        'line-width': WALK_LINE_WIDTH,
        'line-dasharray': [2, 2],
        'line-opacity': 1,
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
        'line-width': RIDE_LINE_WIDTH,
        'line-opacity': 1,
      },
    });

    // Legs whose geometry is a straight chord (no routed shape in the feed) are
    // dashed and muted instead of claiming a walkable path through buildings.
    map.addLayer({
      id: ROUTE_LAYERS.approxCasing,
      type: 'line',
      source: ROUTE_SOURCES.approximate,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': CASING_COLOR,
        'line-width': APPROX_CAUSING_WIDTH,
        'line-opacity': 0.85,
      },
    });
    map.addLayer({
      id: ROUTE_LAYERS.approxLine,
      type: 'line',
      source: ROUTE_SOURCES.approximate,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': APPROX_LINE_WIDTH,
        'line-dasharray': [1.5, 2],
        'line-opacity': 0.85,
      },
    });

    // The focused leg (detail/live) always has a layer ready; its source is
    // empty until a leg is focused, so there is nothing to add later.
    map.addLayer({
      id: ROUTE_LAYERS.focusHalo,
      type: 'line',
      source: ROUTE_SOURCES.focus,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CASING_COLOR, 'line-width': FOCUS_HALO_WIDTH, 'line-opacity': 0.95 },
    });
    map.addLayer({
      id: ROUTE_LAYERS.focusLine,
      type: 'line',
      source: ROUTE_SOURCES.focus,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': FOCUS_LINE_WIDTH,
        'line-opacity': 1,
      },
    });

    map.addLayer({
      id: ROUTE_LAYERS.transfers,
      type: 'circle',
      source: ROUTE_SOURCES.transfers,
      paint: {
        'circle-radius': 4,
        'circle-color': '#0b1d24',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
    });

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

    if (canSelectLeg) {
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

    return removeOwned;
    // `onSelect`/`onSelectLeg` are read through refs on purpose; including them
    // would tear down every layer on each parent render.
  }, [map, styleVersion, canSelectLeg]);

  // Data + paint: the only work a card tap, a filter change or a walkthrough
  // step does on the style. No source or layer is removed here, so MapLibre
  // keeps its tiles and the map does not flash (choppiness pass).
  useEffect(() => {
    if (!map) return;

    const store = markersRef.current;
    const clearMarkers = () => {
      store.origin?.remove();
      store.destination?.remove();
      store.origin = undefined;
      store.destination = undefined;
      for (const entry of store.alternatives.values()) entry.marker.remove();
      store.alternatives.clear();
    };

    if (selected === null) {
      setData(map, ROUTE_SOURCES.selected, EMPTY_LINES);
      setData(map, ROUTE_SOURCES.alternatives, EMPTY_LINES);
      setData(map, ROUTE_SOURCES.transfers, EMPTY_POINTS);
      setData(map, ROUTE_SOURCES.focus, EMPTY_LINES);
      setData(map, ROUTE_SOURCES.approximate, EMPTY_LINES);
      setPaint(map, ROUTE_LAYERS.casing, 'line-opacity', 0.95);
      setPaint(map, ROUTE_LAYERS.walk, 'line-opacity', 1);
      setPaint(map, ROUTE_LAYERS.ride, 'line-opacity', 1);
      setPaint(map, ROUTE_LAYERS.transfers, 'circle-opacity', 1);
      clearMarkers();
      return;
    }

    const legFeatures = legLayers.solid;

    const altFeatures: Feature<LineString>[] = [];
    const altMarkers: { id: string; coordinates: [number, number]; label: string }[] = [];
    const selectedCells =
      selected === null ? undefined : coverageCells(itineraryCoordinates(selected));
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
      // A numbered badge goes where the alternative visibly differs from the
      // selected line; an alternative that shares the whole corridor without a
      // distinguishing vertex is drawn (mostly hidden) but not badged.
      const point =
        selectedCells === undefined
          ? midpoint(coordinates)
          : distinguishingPoint(selectedCells, coordinates);
      if (point !== undefined) {
        altMarkers.push({
          id: itinerary.id,
          coordinates: point,
          label: String(itineraryOrder.get(itinerary.id) ?? 0),
        });
      }
    }

    const focusedLeg =
      activeLegIndex !== null ? selected.legs[activeLegIndex] ?? undefined : undefined;
    const focusFeature =
      focusedLeg !== undefined ? legFeature(focusedLeg, activeLegIndex ?? 0) : undefined;
    const dimmed = focusedLeg !== undefined;

    setData(map, ROUTE_SOURCES.selected, {
      type: 'FeatureCollection',
      features: legFeatures,
    } satisfies FeatureCollection<LineString>);
    setData(map, ROUTE_SOURCES.alternatives, {
      type: 'FeatureCollection',
      features: altFeatures,
    } satisfies FeatureCollection<LineString>);
    setData(map, ROUTE_SOURCES.transfers, {
      type: 'FeatureCollection',
      features: transferPoints(selected),
    } satisfies FeatureCollection<Point>);
    setData(map, ROUTE_SOURCES.approximate, {
      type: 'FeatureCollection',
      features: legLayers.approximate,
    } satisfies FeatureCollection<LineString>);
    setData(
      map,
      ROUTE_SOURCES.focus,
      focusFeature === undefined
        ? EMPTY_LINES
        : ({ type: 'FeatureCollection', features: [focusFeature] } satisfies FeatureCollection<LineString>),
    );

    // Paint: the dimming, the focused dash treatment and the transfer dots.
    setPaint(map, ROUTE_LAYERS.casing, 'line-opacity', dimmed ? 0.4 : 0.95);
    setPaint(map, ROUTE_LAYERS.walk, 'line-opacity', dimmed ? DIM_OPACITY : 1);
    setPaint(map, ROUTE_LAYERS.ride, 'line-opacity', dimmed ? DIM_OPACITY : 1);
    setPaint(map, ROUTE_LAYERS.transfers, 'circle-opacity', dimmed ? 0.5 : 1);
    setPaint(
      map,
      ROUTE_LAYERS.focusLine,
      'line-dasharray',
      focusedLeg?.mode === 'walk' ? [2, 2] : null,
    );

    // Origin / destination pins for the selected itinerary, reused across
    // selections so a tap moves the pins instead of rebuilding them.
    const origin = selected.legs[0]?.from;
    const destination = selected.legs[selected.legs.length - 1]?.to;
    if (origin !== undefined) {
      if (store.origin === undefined) {
        // MapLibre v6's `addTo()` projects the marker immediately, so the
        // position has to be set before it joins the map.
        store.origin = new Marker({ element: circleMarker('var(--primary)', 18) })
          .setLngLat([origin.lon, origin.lat])
          .addTo(map);
      } else {
        store.origin.setLngLat([origin.lon, origin.lat]);
      }
    } else if (store.origin !== undefined) {
      store.origin.remove();
      store.origin = undefined;
    }
    if (destination !== undefined) {
      if (store.destination === undefined) {
        store.destination = new Marker({ element: destinationMarker() })
          .setLngLat([destination.lon, destination.lat])
          .addTo(map);
      } else {
        store.destination.setLngLat([destination.lon, destination.lat]);
      }
    } else if (store.destination !== undefined) {
      store.destination.remove();
      store.destination = undefined;
    }

    const drawnIds = new Set<string>();
    for (const alt of altMarkers) {
      drawnIds.add(alt.id);
      const existing = store.alternatives.get(alt.id);
      if (existing === undefined) {
        const marker = new Marker({ element: numberMarker(alt.label) })
          .setLngLat(alt.coordinates)
          .addTo(map);
        store.alternatives.set(alt.id, { marker, label: alt.label });
        continue;
      }
      existing.marker.setLngLat(alt.coordinates);
      if (existing.label !== alt.label) {
        existing.marker.getElement().textContent = alt.label;
        existing.label = alt.label;
      }
    }
    for (const [id, entry] of store.alternatives) {
      if (drawnIds.has(id)) continue;
      entry.marker.remove();
      store.alternatives.delete(id);
    }
  }, [map, styleVersion, planKey, selectedId, variant, activeLegIndex, selected, drawnAlternatives, legLayers, itineraryOrder]);

  // Camera fit. MapLibre subtracts the map's own `setPadding` (the sheet detent,
  // published by MapCanvas) before applying this margin, so the sheet must never
  // be added here as well — that made `cameraForBounds` refuse the fit (R53).
  useEffect(() => {
    if (!map) return;
    const target = fit ?? 'selected';
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
      data-approximate-legs={legLayers.approximate.length}
      data-route-count={itineraries.length}
    >
      {t('map.routeCount', { count: itineraries.length })}
    </div>
  );
}
