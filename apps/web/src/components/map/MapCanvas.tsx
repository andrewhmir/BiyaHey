import type { Feature, Point } from 'geojson';
import { LocateFixed } from 'lucide-react';
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/useT';
import { useMapPadding } from '../layout/MapSlot';
import { MapContext } from './MapContext';

// MapLibre v6 resolves its worker with a runtime `new URL()` that Vite cannot
// statically follow: the production build emitted no `assets/maplibre-gl-worker.mjs`,
// and `vite preview`'s SPA fallback answered the request with index.html, so the
// worker never started and the built map fetched **zero** tiles (the dev server
// happened to resolve it from `node_modules`). Importing the packaged worker as
// a URL asset emits it with the build and points MapLibre at the emitted file.
setWorkerUrl(maplibreWorkerUrl);

/**
 * The live MapLibre canvas.
 *
 * R42: the basemap is OpenFreeMap "Liberty" and needs no API key. We turn off
 * MapLibre's own attribution control because `MapCredit` renders the required
 * OSM/OpenFreeMap credit ourselves (and stays reachable when collapsed).
 *
 * MapLibre throws `Style is not done loading.` if `addSource`/`addLayer` run
 * before the style has loaded. `MapContext` therefore publishes the map only
 * once `style.load`/`load` has fired, and every data overlay (routes, locate
 * markers) creates its sources against that style-ready map. A style reload
 * fires `style.load` again; the marker effect below is keyed on the reload
 * counter so its sources come back too.
 *
 * The canvas is full-bleed: the sheet detent is published by `MapSlot` as
 * `--map-padding-bottom` and through `useMapPadding`. We apply it to
 * `map.setPadding({ bottom })` so future MapLibre controls and gestures keep
 * clear of the sheet, while our own floating controls offset themselves from
 * the same CSS variable. The map box itself never shrinks.
 *
 * Tiles only load in a real browser; tests mock `maplibre-gl` (jsdom has no
 * WebGL) so no request ever reaches OpenFreeMap.
 */

export const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Manila City Hall area — a sensible v1 default until the map fits a plan. */
const INITIAL_CENTER: [number, number] = [120.9842, 14.5995];
const INITIAL_ZOOM = 11;

const USER_LOCATION_SOURCE_ID = 'user-location';
const MANUAL_PIN_SOURCE_ID = 'manual-pin';
const USER_LOCATION_COLOR = '#00696d';
const MANUAL_PIN_COLOR = '#ba1a1a';
const LOCATION_FAILURE_STATUSES: ReadonlySet<LocateStatus> = new Set([
  'denied',
  'unavailable',
  'timeout',
]);

type LocateStatus =
  'idle' | 'locating' | 'located' | 'denied' | 'unavailable' | 'timeout' | 'pinned';

const LOCATE_MESSAGE_KEYS: Partial<Record<LocateStatus, string>> = {
  locating: 'map.locating',
  located: 'map.located',
  denied: 'map.denied',
  unavailable: 'map.unavailable',
  timeout: 'map.timeout',
  pinned: 'map.pinned',
};

export interface MapCanvasProps {
  /** Overlays that need the live map (e.g. `RoutePathLayer`). */
  children?: ReactNode;
  /**
   * Publishes the style-ready map to `MapView`, which owns the single
   * `MapCredit` above the lazy boundary (R85/m1). `null` while loading and on
   * unmount. Optional so `MapCanvas` stays directly renderable in isolation.
   */
  onMapReady?: (map: MapLibreMap | null) => void;
  /** Show the locate FAB + manual-pin fallback (default true). */
  showLocate?: boolean;
}

function pointFeature(lon: number, lat: number): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

/**
 * Create the marker source, or move it with `setData()` when it already exists.
 * Only called with a style-ready map: `getSource`/`addSource` would otherwise
 * throw inside MapLibre.
 */
function upsertMarker(
  map: MapLibreMap,
  sourceId: string,
  color: string,
  coordinates: [number, number],
): void {
  const data = pointFeature(coordinates[0], coordinates[1]);
  const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }

  map.addSource(sourceId, { type: 'geojson', data });
  map.addLayer({
    id: sourceId,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 8,
      'circle-color': color,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
}

/** Remove a marker layer before its source, as MapLibre requires. */
function removeMarker(map: MapLibreMap, sourceId: string): void {
  if (map.getLayer(sourceId)) map.removeLayer(sourceId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

export function MapCanvas({ children, onMapReady, showLocate = true }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapPadding = useMapPadding();
  const { t } = useT();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  // The context only exposes a map whose style is ready; `map` stays available
  // for camera calls and padding while the style is still fetching.
  const [styledMap, setStyledMap] = useState<MapLibreMap | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [locateStatus, setLocateStatus] = useState<LocateStatus>('idle');
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [manualPin, setManualPin] = useState<[number, number] | null>(null);
  // Read by asynchronous geolocation callbacks: null means the canvas has been
  // removed, so a late success/failure must be ignored.
  const mapRef = useRef<MapLibreMap | null>(null);
  const locateRequestRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new MapLibreMap({
      container,
      style: OPENFREEMAP_LIBERTY_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });
    mapRef.current = instance;
    setMap(instance);
    // Playwright needs a handle on the real map to prove what the overlays draw
    // (layers/sources/paint) against the live stack. Dev-only: the production
    // build has `import.meta.env.DEV === false`, so the handle is never shipped.
    if (import.meta.env.DEV) {
      (window as unknown as { __biyaheyMap?: MapLibreMap }).__biyaheyMap = instance;
    }

    return () => {
      if (mapRef.current === instance) mapRef.current = null;
      if (import.meta.env.DEV) {
        const handle = (window as unknown as { __biyaheyMap?: MapLibreMap }).__biyaheyMap;
        if (handle === instance) {
          delete (window as unknown as { __biyaheyMap?: MapLibreMap }).__biyaheyMap;
        }
      }
      instance.remove();
      setMap((current) => (current === instance ? null : current));
      setStyledMap((current) => (current === instance ? null : current));
    };
  }, []);

  // Publish the map only after the style can accept sources/layers. `load`
  // covers the first load; `style.load` covers later `setStyle()` calls.
  useEffect(() => {
    if (!map) {
      setStyledMap(null);
      return;
    }

    const handleLoad = () => {
      if (!map.isStyleLoaded()) return;
      setStyledMap(map);
    };
    const handleStyleLoad = () => {
      if (!map.isStyleLoaded()) return;
      setStyledMap(map);
      setStyleVersion((version) => version + 1);
    };

    // The event may have fired between construction and this subscription.
    if (map.isStyleLoaded()) handleLoad();
    map.on('load', handleLoad);
    map.on('style.load', handleStyleLoad);

    return () => {
      map.off('load', handleLoad);
      map.off('style.load', handleStyleLoad);
    };
  }, [map]);

  // Publish the style-ready map upward so the single `MapCredit` in `MapView`
  // (rendered above the lazy boundary) can collapse on map interactions.
  useEffect(() => {
    onMapReady?.(styledMap);
  }, [onMapReady, styledMap]);

  // Clear the published map only when this canvas goes away, so a style-ready
  // transition never briefly reports `null` to the credit.
  useEffect(() => {
    return () => onMapReady?.(null);
  }, [onMapReady]);

  // The sheet owns the detent; the map only consumes the resulting padding.
  useEffect(() => {
    map?.setPadding({ bottom: mapPadding });
  }, [map, mapPadding]);

  // Keep the locate markers in sync with React state. Running only against
  // `styledMap` gates every addSource/addLayer on the style being ready, and
  // `styleVersion` re-creates them after a style reload. Existing sources are
  // moved with setData() rather than added a second time.
  useEffect(() => {
    if (!styledMap) return;

    if (userLocation) {
      upsertMarker(styledMap, USER_LOCATION_SOURCE_ID, USER_LOCATION_COLOR, userLocation);
    } else {
      removeMarker(styledMap, USER_LOCATION_SOURCE_ID);
    }

    if (manualPin) {
      upsertMarker(styledMap, MANUAL_PIN_SOURCE_ID, MANUAL_PIN_COLOR, manualPin);
    } else {
      removeMarker(styledMap, MANUAL_PIN_SOURCE_ID);
    }
  }, [styledMap, styleVersion, userLocation, manualPin]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateStatus('unavailable');
      return;
    }

    // A newer tap supersedes this request; a late reply from the old one is
    // ignored instead of moving the marker back to stale coordinates.
    const requestId = locateRequestRef.current + 1;
    locateRequestRef.current = requestId;
    setLocateStatus('locating');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const activeMap = mapRef.current;
        if (requestId !== locateRequestRef.current || !activeMap) return;
        const { latitude, longitude } = position.coords;
        setUserLocation([longitude, latitude]);
        // A real fix replaces the manual fallback pin.
        setManualPin(null);
        setLocateStatus('located');
        activeMap.flyTo({ center: [longitude, latitude], zoom: 15 });
      },
      (error) => {
        if (requestId !== locateRequestRef.current || !mapRef.current) return;
        // No fake success: denial never moves the map or draws a "current
        // location" marker. The manual-pin path below is the fallback.
        setLocateStatus(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    );
  }, []);

  // Manual pin-drop fallback: armed after geolocation fails and stays armed
  // while the pin is shown, so a second tap can correct the chosen origin.
  // Nothing pretends it is a real fix. Not armed at all when the map is used as
  // a route-only view (`showLocate={false}`), where there is no locate control.
  const manualPinArmed = locateStatus === 'pinned' || LOCATION_FAILURE_STATUSES.has(locateStatus);
  useEffect(() => {
    if (!map || !manualPinArmed || !showLocate) return;

    const handleMapClick = (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      setManualPin([lng, lat]);
      setLocateStatus('pinned');
      map.flyTo({ center: [lng, lat], zoom: 15 });
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [map, manualPinArmed, showLocate]);

  const locateMessageKey = LOCATE_MESSAGE_KEYS[locateStatus];
  const locateMessage = locateMessageKey === undefined ? undefined : t(locateMessageKey);

  return (
    <div role="region" aria-label={t('map.region')} className="relative size-full overflow-hidden">
      {/* `h-full w-full`, not `absolute inset-0`: MapLibre adds its own
          `.maplibregl-map { position: relative }` rule, which wins over the
          `absolute` utility (unlayered CSS outranks Tailwind's layered
          utilities) and collapsed this container to 0 px height. The canvas
          then rendered into a zero-height box — the built map was never
          visible. Percentage sizing survives the `position` override. */}
      <div
        ref={containerRef}
        data-testid="map-canvas"
        data-map-ready={styledMap !== null ? 'true' : 'false'}
        className="h-full w-full"
      />

      <MapContext.Provider value={styledMap}>
        <div className="pointer-events-none absolute inset-0">
          {children}

          <div
            className="absolute right-3 flex flex-col items-end gap-2"
            style={{ bottom: 'calc(var(--map-padding-bottom, 0px) + 88px)' }}
          >
            {showLocate && locateMessage && (
              <p
                role="status"
                className="max-w-64 rounded-card bg-inverse-surface px-3 py-2 text-xs leading-5 text-inverse-on-surface shadow-elevation-2"
              >
                {locateMessage}
              </p>
            )}
            {showLocate ? (
              <button
                type="button"
                onClick={requestLocation}
                aria-label={t('map.locate')}
                aria-busy={locateStatus === 'locating'}
                className="pointer-events-auto flex size-12 items-center justify-center rounded-pill bg-surface-container-lowest text-primary shadow-elevation-2 transition hover:shadow-elevation-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <LocateFixed aria-hidden="true" className="size-5" />
              </button>
            ) : null}
          </div>
        </div>
      </MapContext.Provider>
    </div>
  );
}
