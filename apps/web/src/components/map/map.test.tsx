import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { HomePage } from '../../pages/home';
import { mapInstances, resetMapLibreMock } from '../../test/mocks/maplibre';
import { MapSlot } from '../layout/MapSlot';
import { MapCanvas, OPENFREEMAP_LIBERTY_STYLE } from './MapCanvas';
import { MapCredit } from './MapCredit';
import { MODE_COLORS, RoutePolylines } from './RoutePolylines';

vi.mock('maplibre-gl', async () => {
  const { mockMapLibre } = await import('../../test/mocks/maplibre');
  return { ...mockMapLibre, default: mockMapLibre };
});

// R52: jsdom has no layout engine and no canvas, so axe's colour-contrast rule
// can only report noise here; token contrast is reviewed in `tokens.css`
// instead. Every other axe rule stays on.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const osmSource: DataSource = {
  id: 'osm',
  name: 'OpenStreetMap PH extract',
  publisher: 'OSM contributors / Geofabrik',
  url: 'https://download.geofabrik.de/asia/philippines.html',
  licence_spdx: 'ODbL-1.0',
  licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  coverage: 'Philippines - Geofabrik PH extract (NCR + belt for v1)',
  last_checked: '2026-11-01',
  attribution: '© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0',
  used_for: ['roads'],
};

const openFreeMapSource: DataSource = {
  id: 'openfreemap',
  name: 'OpenFreeMap vector tiles',
  publisher: 'OpenFreeMap',
  url: 'https://openfreemap.org',
  licence_spdx: 'MIT',
  licence_url: 'https://github.com/hyperknot/openfreemap/blob/main/LICENSE',
  coverage: 'Global vector basemap tiles (OSM data under ODbL)',
  last_checked: '2026-11-01',
  attribution: '© OpenFreeMap © OpenMapTiles · Data from OpenStreetMap',
  used_for: ['base map'],
};

const itinA: ItineraryDto = {
  id: 'a',
  durationMin: 32,
  startTime: '2026-11-01T08:00:00+08:00',
  endTime: '2026-11-01T08:32:00+08:00',
  transfers: 0,
  walkDistanceM: 200,
  modes: ['walk', 'jeepney'],
  fare: {
    amount: 15,
    currency: 'PHP',
    confidence: 'official',
    effective_from: '2026-09-28',
    source_id: 'ltfrb-fares',
    breakdown: [{ label: 'Jeepney', amount: 15 }],
  },
  sources: ['osm', 'openfreemap'],
  legs: [
    {
      mode: 'walk',
      from: { name: 'Origin', lat: 14.58, lon: 121.0 },
      to: { name: 'Stop A', lat: 14.59, lon: 121.01 },
      startTime: '2026-11-01T08:00:00+08:00',
      endTime: '2026-11-01T08:05:00+08:00',
      durationMin: 5,
      landmarkHint: null,
      distanceM: 200,
      sourceIds: ['osm'],
    },
    {
      mode: 'jeepney',
      from: { name: 'Stop A', lat: 14.59, lon: 121.01 },
      to: { name: 'Destination', lat: 14.6, lon: 121.02 },
      startTime: '2026-11-01T08:05:00+08:00',
      endTime: '2026-11-01T08:32:00+08:00',
      durationMin: 27,
      routeShortName: 'T320',
      landmarkHint: null,
      distanceM: 1200,
      sourceIds: ['osm', 'openfreemap'],
    },
  ],
};

const itinB: ItineraryDto = {
  id: 'b',
  durationMin: 40,
  startTime: '2026-11-01T08:10:00+08:00',
  endTime: '2026-11-01T08:50:00+08:00',
  transfers: 1,
  walkDistanceM: 350,
  modes: ['walk', 'bus'],
  fare: {
    amount: 24,
    currency: 'PHP',
    confidence: 'official',
    effective_from: '2026-09-28',
    source_id: 'ltfrb-fares',
    breakdown: [{ label: 'Bus', amount: 24 }],
  },
  sources: ['osm', 'openfreemap'],
  legs: [
    {
      mode: 'walk',
      from: { name: 'Origin', lat: 14.58, lon: 121.0 },
      to: { name: 'Bus stop', lat: 14.58, lon: 121.005 },
      startTime: '2026-11-01T08:10:00+08:00',
      endTime: '2026-11-01T08:15:00+08:00',
      durationMin: 5,
      landmarkHint: null,
      distanceM: 350,
      sourceIds: ['osm'],
    },
    {
      mode: 'bus',
      from: { name: 'Bus stop', lat: 14.58, lon: 121.005 },
      to: { name: 'Destination', lat: 14.62, lon: 121.03 },
      startTime: '2026-11-01T08:15:00+08:00',
      endTime: '2026-11-01T08:50:00+08:00',
      durationMin: 35,
      routeShortName: 'EDSA Carousel',
      landmarkHint: null,
      distanceM: 5400,
      sourceIds: ['osm', 'openfreemap'],
    },
  ],
};

afterEach(() => {
  resetMapLibreMock();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MapCredit', () => {
  it('renders the required OSM and OpenFreeMap credit from the sources', () => {
    render(<MapCredit sources={[osmSource, openFreeMapSource]} />);

    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(/OpenFreeMap/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /openstreetmap copyright/i })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    expect(screen.getByRole('link', { name: /openfreemap/i })).toHaveAttribute(
      'href',
      'https://openfreemap.org',
    );
    expect(screen.getByRole('link', { name: /openmaptiles copyright/i })).toHaveAttribute(
      'href',
      'https://openmaptiles.org/',
    );
  });

  it('collapses to the labelled ⓘ control after five seconds and reopens the detail', () => {
    vi.useFakeTimers();
    render(<MapCredit sources={[osmSource]} />);

    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText(/© OpenStreetMap contributors/)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /data sources/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('link', { name: /openstreetmap copyright/i })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    expect(screen.getByRole('dialog', { name: /data sources/i })).toHaveTextContent(
      'OpenStreetMap PH extract',
    );
  });
});

describe('RoutePolylines', () => {
  it('draws one GeoJSON source and one line layer per itinerary', () => {
    render(
      <MapCanvas>
        <RoutePolylines itineraries={[itinA, itinB]} selectedId="a" />
      </MapCanvas>,
    );

    const map = mapInstances[0]!;
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenCalledWith(
      'route-a',
      expect.objectContaining({
        type: 'geojson',
        // R53: v1 has no leg polyline, so the line joins consecutive leg
        // endpoints (deduplicated where a leg ends where the next begins).
        data: expect.objectContaining({
          geometry: {
            type: 'LineString',
            coordinates: [
              [121.0, 14.58],
              [121.01, 14.59],
              [121.02, 14.6],
            ],
          },
        }),
      }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'route-a',
        type: 'line',
        source: 'route-a',
        paint: expect.objectContaining({ 'line-color': MODE_COLORS.jeepney }),
      }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'route-b',
        source: 'route-b',
        paint: expect.objectContaining({ 'line-color': MODE_COLORS.bus }),
      }),
    );
  });

  it('emphasises the selected itinerary and dims the others to 60%', () => {
    render(
      <MapCanvas>
        <RoutePolylines itineraries={[itinA, itinB]} selectedId="a" />
      </MapCanvas>,
    );

    const map = mapInstances[0]!;
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-a', 'line-opacity', 1);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-b', 'line-opacity', 0.6);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-a', 'line-width', 6);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-b', 'line-width', 4);
  });

  it('removes every source and layer on unmount', () => {
    const { unmount } = render(
      <MapCanvas>
        <RoutePolylines itineraries={[itinA, itinB]} selectedId="a" />
      </MapCanvas>,
    );
    const map = mapInstances[0]!;

    unmount();

    expect(map.removeLayer).toHaveBeenCalledWith('route-a');
    expect(map.removeLayer).toHaveBeenCalledWith('route-b');
    expect(map.removeSource).toHaveBeenCalledWith('route-a');
    expect(map.removeSource).toHaveBeenCalledWith('route-b');
    expect(map.remove).toHaveBeenCalledTimes(1);
  });
});

describe('MapCanvas', () => {
  it('mounts MapLibre with the keyless OpenFreeMap Liberty style and its own credit', () => {
    render(<MapCanvas />);

    const map = mapInstances[0]!;
    expect(OPENFREEMAP_LIBERTY_STYLE).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(map.options.style).toBe(OPENFREEMAP_LIBERTY_STYLE);
    expect(map.options.attributionControl).toBe(false);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(/OpenFreeMap/)).toBeInTheDocument();
  });

  it('applies the map slot padding whenever the sheet detent changes', async () => {
    const { rerender } = render(
      <MapSlot mapPadding={96}>
        <MapCanvas />
      </MapSlot>,
    );
    const map = mapInstances[0]!;

    await waitFor(() => expect(map.setPadding).toHaveBeenCalledWith({ bottom: 96 }));

    rerender(
      <MapSlot mapPadding={400}>
        <MapCanvas />
      </MapSlot>,
    );

    await waitFor(() => expect(map.setPadding).toHaveBeenLastCalledWith({ bottom: 400 }));
    expect(screen.getByTestId('map-slot')).toHaveAttribute('data-map-padding-bottom', '400');
  });

  it('collapses the credit on the first map interaction', async () => {
    render(<MapCanvas sources={[osmSource, openFreeMapSource]} />);
    const map = mapInstances[0]!;

    await waitFor(() => expect(map.on).toHaveBeenCalledWith('dragstart', expect.any(Function)));
    act(() => {
      map.emit('dragstart');
    });

    await waitFor(() =>
      expect(screen.queryByText(/© OpenStreetMap contributors/)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /data sources/i })).toBeInTheDocument();
  });

  it('falls back to a manual pin when geolocation permission is denied', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, failure: PositionErrorCallback): void => {
        failure({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError);
      },
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = mapInstances[0]!;

    await user.click(screen.getByRole('button', { name: /lokasyon/i }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(/hindi ma-access/i);
    // No fake success: nothing claims a current position and no marker is added.
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();

    act(() => {
      map.emit('click', { lngLat: { lng: 121.0, lat: 14.6 } });
    });

    await waitFor(() =>
      expect(map.addSource).toHaveBeenCalledWith(
        'manual-pin',
        expect.objectContaining({ type: 'geojson' }),
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/pin/i);
  });

  it('has no axe violations with the credit and routes rendered', async () => {
    const { container } = render(
      <MapSlot mapPadding={96}>
        <MapCanvas sources={[osmSource, openFreeMapSource]}>
          <RoutePolylines itineraries={[itinA, itinB]} selectedId="a" />
        </MapCanvas>
      </MapSlot>,
    );

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('Home map integration', () => {
  it('shows the live map under the sheet and follows the detent padding', async () => {
    render(<HomePage />);
    const map = mapInstances[0]!;

    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    await waitFor(() => expect(map.setPadding).toHaveBeenCalledWith({ bottom: 96 }));

    await userEvent.click(screen.getByRole('button', { name: /expand sheet/i }));

    await waitFor(() =>
      expect(map.setPadding).toHaveBeenLastCalledWith({
        bottom: Math.round(window.innerHeight / 2),
      }),
    );
  });
});
