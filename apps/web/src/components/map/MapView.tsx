import type { DataSource } from '@biyahey/shared';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/useT';
import { MapContext } from './MapContext';
import { MapCredit } from './MapCredit';

/**
 * Code-split boundary for the live MapLibre canvas (Task 10).
 *
 * MapLibre GL JS plus its stylesheet is the single largest dependency in the
 * app (~1.1 MB minified). The initial Home/route shell must stay inside the
 * 250 KB gzip first-screen budget, so the canvas is imported dynamically: the
 * entry bundle renders the sheet and search immediately, while this chunk loads
 * in parallel and mounts the map when it arrives.
 *
 * The legal map attribution is rendered **once**, above the `Suspense`
 * boundary (R85/m1). It is required whenever the basemap is part of the screen,
 * it must not depend on 1 MB of WebGL code arriving, and it is the largest
 * painted text on the peek-detent Home screen — so painting it first is also
 * what keeps the mobile LCP inside its 3 s budget. Keeping it above the lazy
 * boundary means the fallback and the canvas share one `MapCredit` instance
 * instead of remounting it (which used to restart its 5 s auto-collapse timer).
 *
 * `MapCanvas` publishes the style-ready map through `onMapReady`, so the
 * hoisted credit can still collapse on the first map interaction. Holding that
 * map in this component's state also provides `MapContext` to the credit; the
 * canvas keeps its own provider for overlays so it remains usable standalone.
 *
 * The `import()` is triggered during the first render of `MapView` (React lazy
 * starts the request when the component first renders), so the map is not
 * deferred until an interaction. `MapCanvas` itself owns the maplibre CSS
 * import, which Vite therefore emits as this chunk's CSS rather than entry CSS.
 */
const LazyMapCanvas = lazy(async () => {
  const module = await import('./MapCanvas');
  return { default: module.MapCanvas };
});

function MapLoadingFallback() {
  const { t } = useT();
  return (
    <div
      role="region"
      aria-label={t('map.placeholder')}
      aria-busy="true"
      data-testid="map-loading"
      className="relative size-full overflow-hidden bg-surface-container-low"
    />
  );
}

export interface MapViewProps {
  /** Provenance rows from the latest plan response for the ⓘ credit detail. */
  sources?: readonly DataSource[];
  /**
   * Show the locate FAB (default true). The trip-only maps turn it off: the
   * rider is already looking at a specific planned route and a recenter control
   * that jumps to the device fix would fight the fitted route camera.
   */
  showLocate?: boolean;
  /** Overlays that need the live map (e.g. `RoutePathLayer`). */
  children?: ReactNode;
}

export function MapView({ sources, showLocate = true, children }: MapViewProps) {
  // Published by `MapCanvas` once the style is ready; `null` until then.
  const [map, setMap] = useState<MapLibreMap | null>(null);

  return (
    <MapContext.Provider value={map}>
      <div className="relative size-full">
        <Suspense fallback={<MapLoadingFallback />}>
          <LazyMapCanvas onMapReady={setMap} showLocate={showLocate}>
            {children}
          </LazyMapCanvas>
        </Suspense>

        {/* One credit for the whole map lifetime, painted before the chunk
            arrives and never remounted when it does. */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-x-3"
            style={{ bottom: 'calc(var(--map-padding-bottom, 0px) + 8px)' }}
          >
            <MapCredit sources={sources} />
          </div>
        </div>
      </div>
    </MapContext.Provider>
  );
}
