import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { HomePage } from '../../pages/home';
import {
  MockGeoJSONSource,
  mapInstances,
  resetMapLibreMock,
  type MockMap,
} from '../../test/mocks/maplibre';
import { MapSlot } from '../layout/MapSlot';
import { MapCanvas, OPENFREEMAP_LIBERTY_STYLE } from './MapCanvas';
import { MapCredit } from './MapCredit';
import { MapView } from './MapView';
import { RoutePathLayer } from './RoutePathLayer';

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
  attribution:
    '© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0',
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

/** Let the mock map finish loading its style, as MapLibre would in a browser. */
function loadMap(): MockMap {
  const map = mapInstances[0]!;
  act(() => {
    map.emit('load');
  });
  return map;
}

function position(latitude: number, longitude: number): GeolocationPosition {
  return { coords: { latitude, longitude } } as GeolocationPosition;
}

function geolocationError(code: number): GeolocationPositionError {
  return { code, message: 'test geolocation failure' } as GeolocationPositionError;
}

function stubGeolocation(
  implementation: (success: PositionCallback, failure: PositionErrorCallback) => void,
) {
  const getCurrentPosition = vi.fn(implementation);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

afterEach(() => {
  resetMapLibreMock();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MapCredit', () => {
  it('renders the legally required basemap credit and licence links', () => {
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

  it('keeps the basemap credit with empty sources and lists data rows only when present', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MapCredit sources={[]} autoCollapseMs={0} />);

    // R45 basemap exception: this line is unconditional because the canvas is
    // always OpenFreeMap tiles over OSM data.
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(/OpenFreeMap/)).toBeInTheDocument();
    expect(screen.getByText(/© OpenMapTiles/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /pinagmulan ng data/i }));
    expect(screen.getByRole('dialog', { name: /pinagmulan ng data/i })).toHaveTextContent(
      /OpenFreeMap tiles/,
    );
    expect(screen.queryByText(osmSource.name)).not.toBeInTheDocument();
    expect(screen.queryByText(openFreeMapSource.name)).not.toBeInTheDocument();

    // Dataset rows come from `sources[]`; they are never hardcoded.
    rerender(<MapCredit sources={[osmSource, openFreeMapSource]} autoCollapseMs={0} />);
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(osmSource.name)).toBeInTheDocument();
    expect(screen.getByText(openFreeMapSource.name)).toBeInTheDocument();
  });

  it('closes the details popover with Escape and returns focus to the ⓘ toggle', async () => {
    const user = userEvent.setup();
    render(<MapCredit sources={[osmSource]} autoCollapseMs={0} />);

    const toggle = screen.getByRole('button', { name: /pinagmulan ng data/i });
    await user.click(toggle);

    const dialog = screen.getByRole('dialog', { name: /pinagmulan ng data/i });
    expect(dialog).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses to the labelled ⓘ control after five seconds and reopens the detail', () => {
    vi.useFakeTimers();
    render(<MapCredit sources={[osmSource]} />);

    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText(/© OpenStreetMap contributors/)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /pinagmulan ng data/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('link', { name: /openstreetmap copyright/i })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    expect(screen.getByRole('dialog', { name: /pinagmulan ng data/i })).toHaveTextContent(
      'OpenStreetMap PH extract',
    );
  });
});

// Route drawing coverage moved to `RoutePathLayer.test.tsx` (UX v2); this file
// keeps the map shell, credit, geolocation and canvas tests.

describe('MapView', () => {
  it('renders exactly one basemap credit and keeps it mounted across the lazy boundary', async () => {
    render(<MapView sources={[osmSource, openFreeMapSource]} />);

    // The credit is required before the ~1 MB map chunk arrives (R85).
    const credit = screen.getByTestId('map-credit');
    expect(screen.getAllByTestId('map-credit')).toHaveLength(1);
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();

    expect(await screen.findByTestId('map-canvas')).toBeInTheDocument();

    // ... and the same instance survives the fallback → canvas swap, so its
    // 5 s auto-collapse timer is never restarted (m1).
    expect(screen.getAllByTestId('map-credit')).toHaveLength(1);
    expect(screen.getByTestId('map-credit')).toBe(credit);
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
  });

  it('collapses the hoisted credit on the first map interaction', async () => {
    render(<MapView sources={[osmSource, openFreeMapSource]} />);
    await screen.findByTestId('map-canvas');
    const map = loadMap();

    await waitFor(() => expect(map.on).toHaveBeenCalledWith('dragstart', expect.any(Function)));
    act(() => {
      map.emit('dragstart');
    });

    await waitFor(() =>
      expect(screen.queryByText(/© OpenStreetMap contributors/)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /pinagmulan ng data/i })).toBeInTheDocument();
  });
});

describe('MapCanvas', () => {
  it('mounts MapLibre with the keyless OpenFreeMap Liberty style and no duplicate credit', () => {
    render(<MapCanvas />);

    const map = mapInstances[0]!;
    expect(OPENFREEMAP_LIBERTY_STYLE).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(map.options.style).toBe(OPENFREEMAP_LIBERTY_STYLE);
    expect(map.options.attributionControl).toBe(false);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    // The credit is owned by `MapView` (one instance above the Suspense
    // boundary); the canvas itself must not paint a second copy.
    expect(screen.queryByTestId('map-credit')).not.toBeInTheDocument();
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

  it('falls back to a manual pin when geolocation permission is denied', async () => {
    stubGeolocation((_success, failure) => failure(geolocationError(1)));
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();

    await user.click(screen.getByRole('button', { name: /lokasyon/i }));

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
    expect(map.flyTo).toHaveBeenCalledWith({ center: [121.0, 14.6], zoom: 15 });
    expect(screen.getByRole('status')).toHaveTextContent(/pin/i);
  });

  it('draws the current-location marker after a successful geolocation fix', async () => {
    stubGeolocation((success) => success(position(14.65, 121.05)));
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();

    await user.click(screen.getByRole('button', { name: /lokasyon/i }));

    await waitFor(() =>
      expect(map.addSource).toHaveBeenCalledWith(
        'user-location',
        expect.objectContaining({ type: 'geojson' }),
      ),
    );
    expect(map.flyTo).toHaveBeenCalledWith({ center: [121.05, 14.65], zoom: 15 });
    expect(screen.getByRole('status')).toHaveTextContent(/nakita/i);
  });

  it('waits for the style before drawing a marker from an early geolocation fix', async () => {
    stubGeolocation((success) => success(position(14.65, 121.05)));
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = mapInstances[0]!;
    await user.click(screen.getByRole('button', { name: /lokasyon/i }));

    // The fix arrived (the camera moved) but the style cannot accept sources.
    expect(map.isStyleLoaded()).toBe(false);
    expect(map.flyTo).toHaveBeenCalledWith({ center: [121.05, 14.65], zoom: 15 });
    expect(map.addSource).not.toHaveBeenCalled();

    act(() => {
      map.emit('load');
    });

    await waitFor(() =>
      expect(map.addSource).toHaveBeenCalledWith(
        'user-location',
        expect.objectContaining({ type: 'geojson' }),
      ),
    );
  });

  it('moves the current-location marker on a second successful fix', async () => {
    const fixes = [position(14.65, 121.05), position(14.71, 121.11)];
    let call = 0;
    stubGeolocation((success) => success(fixes[call++]!));
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();
    const locate = screen.getByRole('button', { name: /lokasyon/i });

    await user.click(locate);
    await waitFor(() => expect(map.getSource('user-location')).toBeDefined());
    const source = map.getSource('user-location') as MockGeoJSONSource;

    await user.click(locate);

    await waitFor(() =>
      expect(source.data).toMatchObject({
        geometry: { type: 'Point', coordinates: [121.11, 14.71] },
      }),
    );
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.flyTo).toHaveBeenLastCalledWith({ center: [121.11, 14.71], zoom: 15 });
  });

  it('moves the manual pin on a second map tap', async () => {
    stubGeolocation((_success, failure) => failure(geolocationError(1)));
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();
    await user.click(screen.getByRole('button', { name: /lokasyon/i }));
    await screen.findByRole('status');

    act(() => {
      map.emit('click', { lngLat: { lng: 121.1, lat: 14.7 } });
    });
    await waitFor(() => expect(map.getSource('manual-pin')).toBeDefined());
    const source = map.getSource('manual-pin') as MockGeoJSONSource;

    act(() => {
      map.emit('click', { lngLat: { lng: 121.2, lat: 14.8 } });
    });

    await waitFor(() =>
      expect(source.data).toMatchObject({
        geometry: { type: 'Point', coordinates: [121.2, 14.8] },
      }),
    );
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.flyTo).toHaveBeenLastCalledWith({ center: [121.2, 14.8], zoom: 15 });
  });

  it('removes the manual pin when a real location fix arrives', async () => {
    let call = 0;
    stubGeolocation((success, failure) => {
      call += 1;
      if (call === 1) failure(geolocationError(1));
      else success(position(14.66, 121.06));
    });
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();
    const locate = screen.getByRole('button', { name: /lokasyon/i });

    await user.click(locate);
    await screen.findByRole('status');
    act(() => {
      map.emit('click', { lngLat: { lng: 121.1, lat: 14.7 } });
    });
    await waitFor(() => expect(map.getSource('manual-pin')).toBeDefined());

    await user.click(locate);

    await waitFor(() => expect(map.getSource('manual-pin')).toBeUndefined());
    expect(map.removeLayer).toHaveBeenCalledWith('manual-pin');
    expect(map.removeSource).toHaveBeenCalledWith('manual-pin');
    expect(map.getSource('user-location')).toBeDefined();
  });

  it('ignores a superseded geolocation result', async () => {
    const requests: { success: PositionCallback; failure: PositionErrorCallback }[] = [];
    stubGeolocation((success, failure) => {
      requests.push({ success, failure });
    });
    const user = userEvent.setup();

    render(<MapCanvas />);
    const map = loadMap();
    const locate = screen.getByRole('button', { name: /lokasyon/i });

    await user.click(locate);
    await user.click(locate);

    act(() => {
      requests[0]!.success(position(14.1, 120.1));
    });
    expect(map.addSource).not.toHaveBeenCalled();

    act(() => {
      requests[1]!.success(position(14.2, 120.2));
    });
    await waitFor(() => expect(map.getSource('user-location')).toBeDefined());
    const source = map.getSource('user-location') as MockGeoJSONSource;
    expect(source.data).toMatchObject({
      geometry: { type: 'Point', coordinates: [120.2, 14.2] },
    });
  });

  it('ignores a geolocation result that arrives after unmount', async () => {
    const requests: { success: PositionCallback; failure: PositionErrorCallback }[] = [];
    stubGeolocation((success, failure) => {
      requests.push({ success, failure });
    });
    const user = userEvent.setup();

    const { unmount } = render(<MapCanvas />);
    const map = loadMap();
    await user.click(screen.getByRole('button', { name: /lokasyon/i }));

    unmount();

    expect(() => requests[0]!.success(position(14.2, 120.2))).not.toThrow();
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('exposes the dev-only map handle and removes it on unmount', () => {
    const { unmount } = render(<MapCanvas />);
    const map = mapInstances[0]!;
    const handle = (window as unknown as { __biyaheyMap?: MockMap }).__biyaheyMap;
    expect(handle).toBe(map);

    unmount();

    expect((window as unknown as { __biyaheyMap?: MockMap }).__biyaheyMap).toBeUndefined();
  });

  it('has no axe violations with the credit and routes rendered', async () => {
    const { container } = render(
      <MapSlot mapPadding={96}>
        <MapView sources={[osmSource, openFreeMapSource]}>
          <RoutePathLayer itineraries={[itinA, itinB]} selectedId="a" />
        </MapView>
      </MapSlot>,
    );
    await screen.findByTestId('map-canvas');
    const map = loadMap();
    // The layer owns three sources: the selected legs, the alternatives and the
    // transfer dots (plus a focus source when a leg is isolated).
    await waitFor(() => expect(map.addSource).toHaveBeenCalledTimes(3));
    expect(screen.getAllByTestId('map-credit')).toHaveLength(1);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('Home map integration', () => {
  it('shows the live map under the sheet and follows the detent padding', async () => {
    render(<HomePage />);

    // MapLibre is a lazy chunk (Task 10), so the canvas appears after `MapView`
    // resolves its dynamic import; the sheet is interactive throughout.
    expect(await screen.findByTestId('map-canvas')).toBeInTheDocument();
    const map = loadMap();
    // The Home path mounts the route overlay with no itineraries yet, so no
    // route source exists until a plan arrives.
    expect(map.sources.size).toBe(0);
    await waitFor(() => expect(map.setPadding).toHaveBeenCalledWith({ bottom: 96 }));

    await userEvent.click(screen.getByRole('button', { name: /expand sheet/i }));

    await waitFor(() =>
      expect(map.setPadding).toHaveBeenLastCalledWith({
        bottom: Math.round(window.innerHeight / 2),
      }),
    );
  });
});
