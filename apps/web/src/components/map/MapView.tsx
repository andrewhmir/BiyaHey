import type { DataSource } from '@biyahey/shared';
import { lazy, Suspense } from 'react';
import { useT } from '../../i18n/useT';
import { MapCredit } from './MapCredit';
import type { MapCanvasProps } from './MapCanvas';

/**
 * Code-split boundary for the live MapLibre canvas (Task 10).
 *
 * MapLibre GL JS plus its stylesheet is the single largest dependency in the
 * app (~1.1 MB minified). The initial Home/route shell must stay inside the
 * 250 KB gzip first-screen budget, so the canvas is imported dynamically: the
 * entry bundle renders the sheet and search immediately, while this chunk loads
 * in parallel and mounts the map when it arrives.
 *
 * The legal map attribution is deliberately rendered by the loading fallback as
 * well. It is required whenever the basemap is part of the screen, it must not
 * depend on 1 MB of WebGL code arriving, and it is the largest painted text on
 * the peek-detent Home screen — so painting it first is also what keeps the
 * mobile LCP inside its 3 s budget.
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

function MapLoadingFallback({ sources }: { sources?: readonly DataSource[] }) {
  const { t } = useT();
  return (
    <div
      role="region"
      aria-label={t('map.placeholder')}
      aria-busy="true"
      data-testid="map-loading"
      className="relative size-full overflow-hidden bg-surface-container-low"
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-x-3"
          style={{ bottom: 'calc(var(--map-padding-bottom, 0px) + 8px)' }}
        >
          <MapCredit sources={sources} />
        </div>
      </div>
    </div>
  );
}

export type MapViewProps = MapCanvasProps;

export function MapView({ sources, children }: MapViewProps) {
  return (
    <Suspense fallback={<MapLoadingFallback sources={sources} />}>
      <LazyMapCanvas sources={sources}>{children}</LazyMapCanvas>
    </Suspense>
  );
}
