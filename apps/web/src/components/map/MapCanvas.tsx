import type { DataSource } from '@biyahey/shared';
import type { Feature, Point } from 'geojson';
import { LocateFixed } from 'lucide-react';
import { Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMapPadding } from '../layout/MapSlot';
import { MapContext } from './MapContext';
import { MapCredit } from './MapCredit';

/**
 * The live MapLibre canvas.
 *
 * R42: the basemap is OpenFreeMap "Liberty" and needs no API key. We turn off
 * MapLibre's own attribution control because `MapCredit` renders the required
 * OSM/OpenFreeMap credit ourselves (and stays reachable when collapsed).
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
const LOCATION_FAILURE_STATUSES: ReadonlySet<LocateStatus> = new Set([
  'denied',
  'unavailable',
  'timeout',
]);

type LocateStatus =
  | 'idle'
  | 'locating'
  | 'located'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'pinned';

const LOCATE_MESSAGES: Partial<Record<LocateStatus, string>> = {
  locating: 'Hinahanap ang lokasyon mo…',
  located: 'Nakita ang lokasyon mo.',
  denied: 'Hindi ma-access ang lokasyon. Pindutin ang mapa para maglagay ng pin.',
  unavailable:
    'Hindi available ang lokasyon sa device na ito. Pindutin ang mapa para maglagay ng pin.',
  timeout: 'Matagal bago natagpuan ang lokasyon. Pindutin ang mapa para maglagay ng pin.',
  pinned: 'Nakalagay na ang pin. Pindutin muli ang lokasyon para subukan ulit.',
};

export interface MapCanvasProps {
  /** Provenance rows from the latest plan response for the ⓘ credit detail. */
  sources?: readonly DataSource[];
  /** Overlays that need the live map (e.g. `RoutePolylines`). */
  children?: ReactNode;
}

function pointFeature(lon: number, lat: number): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

export function MapCanvas({ sources = [], children }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapPadding = useMapPadding();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [locateStatus, setLocateStatus] = useState<LocateStatus>('idle');

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
    setMap(instance);

    return () => {
      instance.remove();
      setMap((current) => (current === instance ? null : current));
    };
  }, []);

  // The sheet owns the detent; the map only consumes the resulting padding.
  useEffect(() => {
    map?.setPadding({ bottom: mapPadding });
  }, [map, mapPadding]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateStatus('unavailable');
      return;
    }

    setLocateStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocateStatus('located');
        if (!map) return;
        if (!map.getSource(USER_LOCATION_SOURCE_ID)) {
          map.addSource(USER_LOCATION_SOURCE_ID, {
            type: 'geojson',
            data: pointFeature(longitude, latitude),
          });
          map.addLayer({
            id: USER_LOCATION_SOURCE_ID,
            type: 'circle',
            source: USER_LOCATION_SOURCE_ID,
            paint: {
              'circle-radius': 8,
              'circle-color': '#00696d',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
        }
        map.flyTo({ center: [longitude, latitude], zoom: 15 });
      },
      (error) => {
        // No fake success: denial never moves the map or draws a "current
        // location" marker. The manual-pin path below is the fallback.
        setLocateStatus(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    );
  }, [map]);

  // Manual pin-drop fallback: only armed after geolocation fails, and the next
  // map tap becomes the user's chosen origin. Nothing pretends it is a fix.
  useEffect(() => {
    if (!map || !LOCATION_FAILURE_STATUSES.has(locateStatus)) return;

    const handleMapClick = (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      setLocateStatus('pinned');
      if (!map.getSource(MANUAL_PIN_SOURCE_ID)) {
        map.addSource(MANUAL_PIN_SOURCE_ID, {
          type: 'geojson',
          data: pointFeature(lng, lat),
        });
        map.addLayer({
          id: MANUAL_PIN_SOURCE_ID,
          type: 'circle',
          source: MANUAL_PIN_SOURCE_ID,
          paint: {
            'circle-radius': 8,
            'circle-color': '#ba1a1a',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
      }
      map.flyTo({ center: [lng, lat], zoom: 15 });
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [map, locateStatus]);

  const locateMessage = LOCATE_MESSAGES[locateStatus];

  return (
    <div role="region" aria-label="Mapa ng ruta" className="relative size-full overflow-hidden">
      <div ref={containerRef} data-testid="map-canvas" className="absolute inset-0" />

      <MapContext.Provider value={map}>
        <div className="pointer-events-none absolute inset-0">
          {children}

          <div
            className="absolute right-3 flex flex-col items-end gap-2"
            style={{ bottom: 'calc(var(--map-padding-bottom, 0px) + 88px)' }}
          >
            {locateMessage && (
              <p
                role="status"
                className="max-w-64 rounded-card bg-inverse-surface px-3 py-2 text-xs leading-5 text-inverse-on-surface shadow-elevation-2"
              >
                {locateMessage}
              </p>
            )}
            <button
              type="button"
              onClick={requestLocation}
              aria-label="Hanapin ang lokasyon ko"
              aria-busy={locateStatus === 'locating'}
              className="pointer-events-auto flex size-12 items-center justify-center rounded-pill bg-surface-container-lowest text-primary shadow-elevation-2 transition hover:shadow-elevation-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <LocateFixed aria-hidden="true" className="size-5" />
            </button>
          </div>

          <div
            className="absolute inset-x-3"
            style={{ bottom: 'calc(var(--map-padding-bottom, 0px) + 8px)' }}
          >
            <MapCredit sources={sources} />
          </div>
        </div>
      </MapContext.Provider>
    </div>
  );
}
