import { decodePolyline } from '@biyahey/shared';
import type { ItineraryDto, LegDto, LegMode } from '@biyahey/shared';
import type { Feature, LineString } from 'geojson';
import { useEffect, useRef } from 'react';
import { useMap, useMapStyleVersion } from './MapContext';

/**
 * Route lines for the itinerary shortlist.
 *
 * R53: a plan must be drawn as the route it actually takes. MOTIS sends a
 * Google-encoded `legGeometry` for every leg, the API copies it through
 * `LegDto.geometry`, and this component decodes each leg — the encoding is
 * lat-delta then lon-delta, so it is flipped into GeoJSON `[lon, lat]` order —
 * and joins the legs in travel order, dropping consecutive duplicate vertices
 * where one leg ends where the next begins.
 *
 * Payloads cached or built before geometry existed carry no `LegDto.geometry`,
 * and a malformed or too-short polyline cannot be drawn. Those legs fall back
 * to the straight `from` → `to` segment they used to be drawn as, per leg, so
 * older responses still render and a plan can mix routed and straight parts.
 * `distanceM` and travel times still come from the router.
 *
 * Colour is never the only carrier of meaning: the sheet must pair the line
 * with a text chip whose label comes from the translated `mode.*` keys (m5).
 * {@link MODE_COLORS} is the documented mode palette used for those chips and
 * for the line layer; {@link KNOWN_MODES} is the single runtime vocabulary.
 */

/** Documented mode palette. Contrast against the light basemap is reviewed. */
export const MODE_COLORS: Record<LegMode, string> = {
  walk: '#3f4949',
  jeepney: '#00696d',
  bus: '#7a5900',
  mrt3: '#c9a200',
  lrt1: '#007a3d',
  lrt2: '#7b1fa2',
  ferry: '#1565c0',
  'uv-express': '#b45309',
  p2p: '#374151',
};

/**
 * Mode vocabulary shared by the chips, the timeline and the route palette.
 * Derived from {@link MODE_COLORS} so there is no second copy of mode names:
 * rendered labels live only in the `mode.*` keys of `i18n/strings.ts` (m5).
 */
export const KNOWN_MODES: ReadonlySet<string> = new Set<string>(Object.keys(MODE_COLORS));

/** Narrow an API mode string to the v1 vocabulary. */
export function isKnownMode(mode: string): mode is LegMode {
  return KNOWN_MODES.has(mode);
}

const DIMMED_OPACITY = 0.6;
const SELECTED_WIDTH = 6;
const DIMMED_WIDTH = 4;
/** Padding around the fitted plan bounds, in CSS pixels. */
const FIT_PADDING = 48;
/** Never zoom closer than this when a very short plan is fitted. */
const FIT_MAX_ZOOM = 16;

export interface RoutePolylinesProps {
  itineraries: readonly ItineraryDto[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

/** The mode that names an itinerary's line: the first non-walk leg, else walk. */
export function primaryMode(itinerary: ItineraryDto): LegMode {
  return itinerary.legs.find((leg) => leg.mode !== 'walk')?.mode ?? 'walk';
}

/** Colour for an itinerary's line and for its text chip (never colour-only). */
export function routeColor(itinerary: ItineraryDto): string {
  return MODE_COLORS[primaryMode(itinerary)];
}

/**
 * One leg's line in GeoJSON `[lon, lat]` order: the decoded router shape when
 * the leg carries drawable geometry, else the straight `from` → `to` segment.
 */
function legCoordinates(leg: LegDto): [number, number][] {
  const geometry = leg.geometry;
  if (geometry !== undefined) {
    // `decodePolyline` yields [lat, lon]; GeoJSON coordinates are [lon, lat].
    const decoded: [number, number][] = [];
    for (const [lat, lon] of decodePolyline(geometry.points, geometry.precision)) {
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        decoded.push([lon, lat]);
      }
    }
    if (decoded.length >= 2) {
      return decoded;
    }
  }
  return [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
}

/**
 * Drawable line for an itinerary: every leg's shape joined in travel order,
 * with consecutive duplicate vertices dropped where one leg ends where the next
 * begins. A leg without usable geometry contributes its straight from → to
 * segment (see {@link legCoordinates}).
 */
export function itineraryCoordinates(itinerary: ItineraryDto): [number, number][] {
  const coordinates: [number, number][] = [];
  const push = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const last = coordinates[coordinates.length - 1];
    if (last && last[0] === lon && last[1] === lat) return;
    coordinates.push([lon, lat]);
  };

  for (const leg of itinerary.legs) {
    for (const [lon, lat] of legCoordinates(leg)) {
      push(lon, lat);
    }
  }
  return coordinates;
}

/**
 * Bounds of every plan on the map, as `[[minLon, minLat], [maxLon, maxLat]]`.
 * `undefined` when there is nothing worth fitting: fewer than two route points,
 * or every point identical (a degenerate walk pin, not a route).
 */
function routeBounds(
  itineraries: readonly ItineraryDto[],
): [[number, number], [number, number]] | undefined {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const itinerary of itineraries) {
    for (const [lon, lat] of itineraryCoordinates(itinerary)) {
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

export function RoutePolylines({
  itineraries,
  selectedId = null,
  onSelect,
}: RoutePolylinesProps) {
  const map = useMap();
  // Bumped after a style reload, which drops every source and layer; the
  // effects below re-add what this component owns.
  const styleVersion = useMapStyleVersion();
  // Keep the latest callback without making it an effect dependency: an inline
  // arrow from the sheet must not tear down and recreate every layer.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Sources and layers are owned by this effect so unmount removes exactly what
  // was added, even if the map itself is being destroyed at the same time.
  useEffect(() => {
    // `MapContext` publishes only a style-ready map, so `null` is the only
    // local gate. Do NOT re-check `isStyleLoaded()`: MapLibre reports the style
    // dirty while sources/layers are being added — including the
    // `addSource`/`addLayer` below — so that check would silently skip this
    // work in a real browser. Style reloads still re-run the effect: the
    // `styleVersion` dependency is fed by `style.load` through
    // `useMapStyleVersion`.
    if (!map) return;

    const added: string[] = [];
    const clickHandlers: { layerId: string; handler: () => void }[] = [];

    for (const itinerary of itineraries) {
      const sourceId = `route-${itinerary.id}`;
      if (map.getSource(sourceId)) continue;
      const coordinates = itineraryCoordinates(itinerary);
      if (coordinates.length < 2) continue;

      const feature: Feature<LineString> = {
        type: 'Feature',
        properties: { itineraryId: itinerary.id },
        geometry: { type: 'LineString', coordinates },
      };

      map.addSource(sourceId, { type: 'geojson', data: feature });
      map.addLayer({
        id: sourceId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': routeColor(itinerary),
          'line-width': DIMMED_WIDTH,
          'line-opacity': DIMMED_OPACITY,
        },
      });
      added.push(sourceId);

      const handler = () => onSelectRef.current?.(itinerary.id);
      map.on('click', sourceId, handler);
      clickHandlers.push({ layerId: sourceId, handler });
    }

    return () => {
      for (const { layerId, handler } of clickHandlers) map.off('click', layerId, handler);
      for (const sourceId of added) {
        try {
          if (map.getLayer(sourceId)) map.removeLayer(sourceId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch {
          // MapCanvas may already have removed the map; nothing left to clean.
        }
      }
    };
  }, [map, itineraries, styleVersion]);

  // Fit the camera once per plan (and per style reload) so the drawn routes are
  // actually visible: the canvas is constructed with a fixed Manila centre and
  // zoom. MapLibre already subtracts the map's own padding (MapCanvas mirrors the
  // bottom-sheet detent through `setPadding`) from the box it fits into, so this
  // effect passes only the fixed margin. Adding `getPadding()` here as well would
  // count the sheet twice and `cameraForBounds` would then refuse to fit.
  // This effect follows the source effect above, so a fit only ever runs once the
  // route sources exist.
  useEffect(() => {
    // Same style-ready contract as the source effect above: the sources it just
    // added leave `isStyleLoaded()` false while MapLibre processes them, and
    // this fit must still run for the plan to be visible.
    if (!map) return;
    const bounds = routeBounds(itineraries);
    if (bounds === undefined) return;
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [map, itineraries, styleVersion]);

  useEffect(() => {
    // Same style-ready contract: re-checking `isStyleLoaded()` here would skip
    // the selected/dimmed emphasis because our own `addSource` just dirtied the
    // style.
    if (!map) return;
    for (const itinerary of itineraries) {
      const layerId = `route-${itinerary.id}`;
      if (!map.getLayer(layerId)) continue;
      const selected = itinerary.id === selectedId;
      map.setPaintProperty(layerId, 'line-opacity', selected ? 1 : DIMMED_OPACITY);
      map.setPaintProperty(layerId, 'line-width', selected ? SELECTED_WIDTH : DIMMED_WIDTH);
    }
  }, [map, itineraries, selectedId, styleVersion]);

  return null;
}
