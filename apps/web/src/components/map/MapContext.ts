import { createContext, useContext } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * The live MapLibre map, shared with overlay components.
 *
 * `null` until `MapCanvas` has constructed the map (and on the server or in
 * tests that render an overlay without a canvas). Consumers must render
 * nothing and skip map work while it is `null`.
 */
export const MapContext = createContext<MapLibreMap | null>(null);

/** The enclosing MapLibre map, or `null` while it is not mounted. */
export function useMap(): MapLibreMap | null {
  return useContext(MapContext);
}
