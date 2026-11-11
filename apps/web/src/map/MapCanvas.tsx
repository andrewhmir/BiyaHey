import { decodePolyline, type ItineraryDto } from '@biyahey/shared';
import {
  LngLatBounds,
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { useEffect, useRef, useState } from 'react';
import { useCopy } from '../i18n';
import { modeColorExpression } from './modes';
import { getMapState, mapActions, useMapState, type FitKind, type MapState } from './store';

// MapLibre v6 ships its worker as a separate bundle. Vite emits it as an
// asset and MapLibre loads it from here in dev and in the built PWA.
setWorkerUrl(maplibreWorkerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const INITIAL_CENTER: [number, number] = [120.9842, 14.5995];
const INITIAL_ZOOM = 11;

const ROUTES_SOURCE = 'biyahey-routes';
const PINS_SOURCE = 'biyahey-pins';
const ROUTE_LAYERS = [
  'route-other',
  'route-selected',
  'route-selected-walk',
  'route-active',
] as const;

type LonLat = [number, number];

interface RouteFeature extends Feature<LineString, {
  routeId: string;
  legIndex: number;
  mode: string;
  selected: boolean;
  active: boolean;
}> {
  type: 'Feature';
  properties: {
    routeId: string;
    legIndex: number;
    mode: string;
    selected: boolean;
    active: boolean;
  };
  geometry: { type: 'LineString'; coordinates: LonLat[] };
}

function legCoordinates(itinerary: ItineraryDto, legIndex: number): LonLat[] {
  const leg = itinerary.legs[legIndex];
  if (leg === undefined) return [];
  if (leg.geometry !== undefined) {
    const points = decodePolyline(leg.geometry.points, leg.geometry.precision);
    if (points.length >= 2) return points.map(([lat, lon]): LonLat => [lon, lat]);
  }
  return [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
}

function routeFeatures(state: MapState): RouteFeature[] {
  const features: RouteFeature[] = [];
  for (const itinerary of state.itineraries) {
    const selected = itinerary.id === state.selectedId;
    itinerary.legs.forEach((leg, legIndex) => {
      const coordinates = legCoordinates(itinerary, legIndex);
      if (coordinates.length < 2) return;
      features.push({
        type: 'Feature',
        properties: {
          routeId: itinerary.id,
          legIndex,
          mode: leg.mode,
          selected,
          active: selected && state.activeLegIndex === legIndex,
        },
        geometry: { type: 'LineString', coordinates },
      });
    });
  }
  return features;
}

type PinFeature = Feature<Point, { kind: string }>;

function pinFeatures(state: MapState): FeatureCollection<Point, { kind: string }> {
  const endpoints =
    state.endpoints.length > 0
      ? state.endpoints
      : (() => {
          const selected = state.itineraries.find((itinerary) => itinerary.id === state.selectedId);
          if (selected === undefined || selected.legs.length === 0) return [];
          const first = selected.legs[0]!;
          const last = selected.legs[selected.legs.length - 1]!;
          return [
            { lat: first.from.lat, lon: first.from.lon, label: first.from.name, kind: 'origin' as const },
            { lat: last.to.lat, lon: last.to.lon, label: last.to.name, kind: 'destination' as const },
          ];
        })();
  const features: PinFeature[] = endpoints.map((endpoint) => ({
    type: 'Feature',
    properties: { kind: endpoint.kind },
    geometry: { type: 'Point', coordinates: [endpoint.lon, endpoint.lat] },
  }));
  if (state.userLocation !== null) {
    features.push({
      type: 'Feature',
      properties: { kind: 'user' },
      geometry: {
        type: 'Point',
        coordinates: [state.userLocation.lon, state.userLocation.lat],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function fitCoordinates(state: MapState, kind: FitKind): LonLat[] {
  const selected =
    state.itineraries.find((itinerary) => itinerary.id === state.selectedId) ?? state.itineraries[0];
  if (selected === undefined) return [];
  if (kind === 'all') {
    return state.itineraries.flatMap((itinerary) =>
      itinerary.legs.flatMap((_, index) => legCoordinates(itinerary, index)),
    );
  }
  if (kind === 'active-leg' && state.activeLegIndex !== null) {
    return legCoordinates(selected, state.activeLegIndex);
  }
  return selected.legs.flatMap((_, index) => legCoordinates(selected, index));
}

function boundsOf(coordinates: LonLat[]): LngLatBounds | null {
  if (coordinates.length === 0) return null;
  const first = coordinates[0]!;
  const bounds = new LngLatBounds(first, first);
  for (const coordinate of coordinates) bounds.extend(coordinate);
  return bounds;
}

function addLayers(map: MapLibreMap): void {
  map.addSource(ROUTES_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource(PINS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'route-other',
    type: 'line',
    source: ROUTES_SOURCE,
    filter: ['!', ['get', 'selected']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.7 },
  });
  map.addLayer({
    id: 'route-active',
    type: 'line',
    source: ROUTES_SOURCE,
    filter: ['get', 'active'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': modeColorExpression() as ExpressionSpecification,
      'line-width': 11,
      'line-opacity': 0.25,
    },
  });
  map.addLayer({
    id: 'route-selected',
    type: 'line',
    source: ROUTES_SOURCE,
    filter: ['all', ['get', 'selected'], ['!=', ['get', 'mode'], 'walk']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': modeColorExpression() as ExpressionSpecification,
      'line-width': 6,
    },
  });
  map.addLayer({
    id: 'route-selected-walk',
    type: 'line',
    source: ROUTES_SOURCE,
    filter: ['all', ['get', 'selected'], ['==', ['get', 'mode'], 'walk']],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#6b7280',
      'line-width': 4,
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: 'pin-dot',
    type: 'circle',
    source: PINS_SOURCE,
    filter: ['!=', ['get', 'kind'], 'user'],
    paint: {
      'circle-radius': 8,
      'circle-color': [
        'match',
        ['get', 'kind'],
        'origin',
        '#00af5f',
        'destination',
        '#e12e2e',
        '#495057',
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'pin-user',
    type: 'circle',
    source: PINS_SOURCE,
    filter: ['==', ['get', 'kind'], 'user'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#0066eb',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

function updateMap(map: MapLibreMap, state: MapState, lastFit: { current: number }): void {
  const routeSource = map.getSource(ROUTES_SOURCE) as GeoJSONSource | undefined;
  routeSource?.setData({ type: 'FeatureCollection', features: routeFeatures(state) } as never);
  const pinSource = map.getSource(PINS_SOURCE) as GeoJSONSource | undefined;
  pinSource?.setData(pinFeatures(state) as never);

  if (state.fit.nonce === lastFit.current) return;
  lastFit.current = state.fit.nonce;
  const coordinates = fitCoordinates(state, state.fit.kind);
  const bounds = boundsOf(coordinates);
  if (bounds === null) return;
  map.fitBounds(bounds, {
    padding: {
      top: 64,
      right: 48,
      bottom: Math.max(48, state.inset.bottom + 24),
      left: Math.max(48, state.inset.left + 24),
    },
    maxZoom: 16.5,
    duration: 700,
  });
}

export function MapCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const lastFit = useRef(0);
  const [ready, setReady] = useState(false);
  const [locateState, setLocateState] = useState<'idle' | 'locating'>('idle');
  const state = useMapState();
  const { t } = useCopy();

  useEffect(() => {
    if (container.current === null) return;
    const map = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    const onStyleLoad = () => {
      if (map.getSource(ROUTES_SOURCE) === undefined) addLayers(map);
      setReady(true);
      updateMap(map, getMapState(), lastFit);
    };
    map.on('style.load', onStyleLoad);

    map.on('click', (event) => {
      const current = getMapState();
      const features = map.queryRenderedFeatures(event.point, {
        layers: ROUTE_LAYERS as unknown as string[],
      });
      const feature = features[0];
      if (feature === undefined) return;
      const properties = feature.properties ?? {};
      const routeId = String(properties.routeId ?? '');
      const legIndex = Number(properties.legIndex ?? 0);
      if (current.mode === 'options' && routeId.length > 0) {
        mapActions.selectItinerary(routeId);
      } else if (current.mode === 'detail') {
        mapActions.focusLeg(current.activeLegIndex === legIndex ? null : legIndex);
      }
    });

    map.on('mousemove', (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: ROUTE_LAYERS as unknown as string[],
      });
      map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Created once; store state is pushed in by the effect below.
  }, []);

  useEffect(() => {
    if (!ready || mapRef.current === null) return;
    updateMap(mapRef.current, state, lastFit);
  }, [ready, state]);

  const locate = () => {
    const map = mapRef.current;
    if (map === null || !('geolocation' in navigator)) return;
    setLocateState('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lon: position.coords.longitude };
        mapActions.setUserLocation(location);
        map.flyTo({ center: [location.lon, location.lat], zoom: 15, duration: 900 });
        setLocateState('idle');
      },
      () => setLocateState('idle'),
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  };

  return (
    <div className="relative size-full" aria-label={t('map.region')} role="region">
      <div className="absolute inset-0">
        {/* MapLibre sets `position: relative` on its container, so this wrapper
            owns the layout size and the container only fills it. */}
        <div ref={container} className="size-full bg-[#eceff1]" />
      </div>

      <button
        type="button"
        onClick={locate}
        aria-label={locateState === 'locating' ? t('map.locating') : t('map.locate')}
        className="absolute right-4 z-20 flex size-11 items-center justify-center rounded-full border border-line bg-white text-ink shadow-md transition hover:bg-canvas"
        style={{ bottom: Math.max(16, state.inset.bottom + 16) }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default MapCanvas;
