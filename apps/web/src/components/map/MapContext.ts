import { createContext, useContext, useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * The live MapLibre map, shared with overlay components.
 *
 * `null` until `MapCanvas` has constructed the map **and** its style has
 * finished loading. MapLibre throws `Style is not done loading.` if a source or
 * layer is added earlier, so data overlays must treat `null` as "not ready yet"
 * and skip all map work.
 */
export const MapContext = createContext<MapLibreMap | null>(null);

/** The enclosing style-ready MapLibre map, or `null` while it is not ready. */
export function useMap(): MapLibreMap | null {
  return useContext(MapContext);
}

/**
 * Counter that increments whenever the map's style finishes loading again
 * (for example after a `setStyle()` call). A style reload drops every source
 * and layer, so data overlays include this value in their effect dependencies to
 * re-add what they own.
 */
export function useMapStyleVersion(): number {
  const map = useMap();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!map) return;
    const bump = () => setVersion((current) => current + 1);
    map.on('style.load', bump);
    return () => {
      map.off('style.load', bump);
    };
  }, [map]);

  return version;
}
