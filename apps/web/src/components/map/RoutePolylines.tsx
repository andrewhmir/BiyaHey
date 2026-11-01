import type { ItineraryDto, LegMode } from '@biyahey/shared';
import type { Feature, LineString } from 'geojson';
import { useEffect, useRef } from 'react';
import { useMap } from './MapContext';

/**
 * Route lines for the itinerary shortlist.
 *
 * R53 / v1 geometry approximation: the shared `LegDto` deliberately carries no
 * encoded polyline. Each itinerary is therefore drawn as one straight GeoJSON
 * `LineString` joining the `from` → `to` coordinates of its legs in travel
 * order (consecutive duplicate points are dropped). That is an approximation of
 * the real road alignment, not a routed shape; it is replaced when Plan 1 adds
 * leg geometry. `distanceM` and travel times still come from the router.
 *
 * Colour is never the only carrier of meaning: the sheet must pair the line
 * with a text chip built from {@link MODE_LABELS}. {@link MODE_COLORS} is the
 * documented mode palette used for those chips and for the line layer.
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

/** Taglish labels that must accompany {@link MODE_COLORS} wherever routes are listed. */
export const MODE_LABELS: Record<LegMode, string> = {
  walk: 'Lakad',
  jeepney: 'Jeepney',
  bus: 'Bus',
  mrt3: 'MRT-3',
  lrt1: 'LRT-1',
  lrt2: 'LRT-2',
  ferry: 'Ferry',
  'uv-express': 'UV Express',
  p2p: 'P2P',
};

const DIMMED_OPACITY = 0.6;
const SELECTED_WIDTH = 6;
const DIMMED_WIDTH = 4;

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
 * Straight-line approximation of an itinerary (R53): consecutive leg endpoints,
 * deduplicated where one leg ends where the next begins.
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
    push(leg.from.lon, leg.from.lat);
    push(leg.to.lon, leg.to.lat);
  }
  return coordinates;
}

export function RoutePolylines({
  itineraries,
  selectedId = null,
  onSelect,
}: RoutePolylinesProps) {
  const map = useMap();
  // Keep the latest callback without making it an effect dependency: an inline
  // arrow from the sheet must not tear down and recreate every layer.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Sources and layers are owned by this effect so unmount removes exactly what
  // was added, even if the map itself is being destroyed at the same time.
  useEffect(() => {
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
  }, [map, itineraries]);

  useEffect(() => {
    if (!map) return;
    for (const itinerary of itineraries) {
      const layerId = `route-${itinerary.id}`;
      if (!map.getLayer(layerId)) continue;
      const selected = itinerary.id === selectedId;
      map.setPaintProperty(layerId, 'line-opacity', selected ? 1 : DIMMED_OPACITY);
      map.setPaintProperty(layerId, 'line-width', selected ? SELECTED_WIDTH : DIMMED_WIDTH);
    }
  }, [map, itineraries, selectedId]);

  return null;
}
