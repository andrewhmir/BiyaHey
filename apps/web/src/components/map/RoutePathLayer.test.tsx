import type { ItineraryDto } from '@biyahey/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { FeatureCollection, LineString } from 'geojson';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodePolyline,
  makeItinerary,
  makeLeg,
  makeLongItinerary,
  makeRailTrip,
  makeWalkOnlyItinerary,
} from '../../test/fixtures/itinerary';
import {
  MockGeoJSONSource,
  mapInstances,
  markers,
  resetMapLibreMock,
  type MockMap,
} from '../../test/mocks/maplibre';
import { MODE_COLORS } from '../transit/modeMeta';
import { MapCanvas } from './MapCanvas';
import {
  ROUTE_LAYERS,
  ROUTE_SOURCES,
  RoutePathLayer,
  itineraryCoordinates,
} from './RoutePathLayer';

vi.mock('maplibre-gl', async () => {
  const { mockMapLibre } = await import('../../test/mocks/maplibre');
  return { ...mockMapLibre, default: mockMapLibre };
});

function loadMap(): MockMap {
  const map = mapInstances[0]!;
  act(() => {
    map.emit('load');
  });
  return map;
}

function collectionOf(map: MockMap, sourceId: string): FeatureCollection<LineString> {
  const source = map.getSource(sourceId) as MockGeoJSONSource | undefined;
  expect(source).toBeDefined();
  return source!.data as FeatureCollection<LineString>;
}

function altItinerary(id: string, shift = 0): ItineraryDto {
  const stopLon = 121.005 + shift;
  const endLon = 121.02 + shift;
  return {
    ...makeItinerary([
      makeLeg({
        mode: 'walk',
        from: { name: 'Origin', lat: 14.58, lon: 121.0 },
        to: { name: 'Stop', lat: 14.585, lon: stopLon },
      }),
      makeLeg({
        mode: 'bus',
        from: { name: 'Stop', lat: 14.585, lon: stopLon },
        to: { name: 'Destination', lat: 14.6, lon: endLon },
      }),
    ]),
    id,
  };
}

afterEach(() => {
  resetMapLibreMock();
  vi.unstubAllGlobals();
});

describe('RoutePathLayer', () => {
  it('does not touch the style before it has loaded', () => {
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[{ ...makeRailTrip(), id: 'a' }]} selectedId="a" />
      </MapCanvas>,
    );
    const map = mapInstances[0]!;
    expect(map.isStyleLoaded()).toBe(false);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('draws the selected itinerary leg-by-leg in the mode colours over a white casing', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    const legs = collectionOf(map, ROUTE_SOURCES.selected).features;
    expect(legs).toHaveLength(3);
    expect(legs.map((feature) => feature.properties?.['mode'])).toEqual(['walk', 'mrt3', 'walk']);
    expect(legs[1]?.properties?.['colour']).toBe(MODE_COLORS.mrt3);

    // Casing under everything, then a dashed walk layer and a coloured ride layer.
    expect(map.getLayer(ROUTE_LAYERS.casing)).toBeDefined();
    expect(map.getLayer(ROUTE_LAYERS.walk)).toMatchObject({
      filter: ['==', ['get', 'mode'], 'walk'],
      paint: expect.objectContaining({ 'line-dasharray': [2, 2] }),
    });
    expect(map.getLayer(ROUTE_LAYERS.ride)).toMatchObject({
      filter: ['!=', ['get', 'mode'], 'walk'],
      paint: expect.objectContaining({ 'line-color': ['get', 'colour'] }),
    });
    expect(map.getLayer(ROUTE_LAYERS.transfers)).toMatchObject({ type: 'circle' });
    // Routed fixtures are solid: nothing falls back to the approximate chord.
    expect(screen.getByTestId('route-map-state')).toHaveAttribute('data-approximate-legs', '0');
  });

  it('puts an origin and a destination marker on the selected itinerary', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    loadMap();

    await waitFor(() => expect(markers.filter((marker) => marker.map !== null)).toHaveLength(2));
    const placed = markers.filter((marker) => marker.map !== null);
    const origin = itinerary.legs[0]!.from;
    const destination = itinerary.legs[itinerary.legs.length - 1]!.to;
    expect(placed[0]?.lngLat).toEqual([origin.lon, origin.lat]);
    expect(placed[1]?.lngLat).toEqual([destination.lon, destination.lat]);
  });

  it('draws every alternative as its own faded line with a numbered marker', async () => {
    const a = { ...makeRailTrip(), id: 'a' };
    const b = altItinerary('b');
    const c = altItinerary('c', 0.01);
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b, c]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.alternatives)).toBeDefined());
    const alternatives = collectionOf(map, ROUTE_SOURCES.alternatives).features;
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map((feature) => feature.properties?.['itineraryId'])).toEqual(['b', 'c']);
    expect(alternatives[0]?.properties?.['colour']).toBe(MODE_COLORS.bus);
    // Alternatives are muted context, not competing answers: one neutral hue,
    // thin, below full opacity (the selected route keeps its mode colours).
    expect(map.getLayer(ROUTE_LAYERS.altLine)).toMatchObject({
      paint: expect.objectContaining({ 'line-color': '#7a878d', 'line-opacity': 0.55 }),
    });

    // Two selected-itinerary markers plus one numbered badge per alternative.
    await waitFor(() => expect(markers.filter((marker) => marker.map !== null)).toHaveLength(4));
    const labels = markers
      .filter((marker) => marker.map !== null)
      .map((marker) => marker.element.textContent);
    expect(labels).toEqual(['', '', '2', '3']);
  });

  it('draws duplicate fan-out routes once, with one numbered marker', async () => {
    // MOTIS's fan-out can return the same physical route twice with different
    // ids; the map must not stack numbered badges or overdraw the same line.
    const a = { ...makeRailTrip(), id: 'a' };
    const duplicate = altItinerary('b');
    const duplicateAgain = altItinerary('c');
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, duplicate, duplicateAgain]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.alternatives)).toBeDefined());
    expect(collectionOf(map, ROUTE_SOURCES.alternatives).features).toHaveLength(1);
    await waitFor(() => expect(markers.filter((marker) => marker.map !== null)).toHaveLength(3));
  });

  it('collapses an alternative that runs along the selected corridor instead of stacking a badge on it', async () => {
    const selected = { ...makeRailTrip(), id: 'a' };
    // The same corridor with both endpoints nudged ~22 m: MOTIS fan-out emits
    // variants like this for different departures, and drawing them would put a
    // numbered badge on top of the selected line.
    const nudged = makeItinerary(
      selected.legs.map((leg) => ({
        ...leg,
        geometry: {
          points: encodePolyline([
            [leg.from.lat + 0.0002, leg.from.lon + 0.0002],
            [leg.to.lat + 0.0002, leg.to.lon + 0.0002],
          ]),
          precision: 6,
        },
      })),
      { id: 'near' },
    );
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[selected, nudged]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.alternatives)).toBeDefined());
    expect(collectionOf(map, ROUTE_SOURCES.alternatives).features).toHaveLength(0);
    expect(screen.getByTestId('route-map-state')).toHaveAttribute('data-alternative-count', '0');
  });

  it('reports an alternative tap through onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <MapCanvas>
        <RoutePathLayer
          itineraries={[{ ...makeRailTrip(), id: 'a' }, altItinerary('b')]}
          selectedId="a"
          onSelect={onSelect}
        />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getLayer(ROUTE_LAYERS.altHit)).toBeDefined());

    act(() => {
      map.emit(
        'click',
        { features: [{ properties: { itineraryId: 'b' } }] },
        ROUTE_LAYERS.altHit,
      );
    });

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('isolates the active leg and reports leg taps in the detail variant', async () => {
    const onSelectLeg = vi.fn();
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer
          itineraries={[itinerary]}
          variant="detail"
          selectedId="a"
          activeLegIndex={1}
          onSelectLeg={onSelectLeg}
        />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.focus)).toBeDefined());
    const focus = collectionOf(map, ROUTE_SOURCES.focus).features;
    expect(focus).toHaveLength(1);
    expect(focus[0]?.properties?.['legIndex']).toBe(1);
    expect(focus[0]?.properties?.['colour']).toBe(MODE_COLORS.mrt3);

    // The rest of the plan dims; the focused leg draws a wider halo on top.
    expect(map.getLayer(ROUTE_LAYERS.ride)).toMatchObject({
      paint: expect.objectContaining({ 'line-opacity': 0.3 }),
    });
    expect(map.getLayer(ROUTE_LAYERS.focusHalo)).toMatchObject({
      paint: expect.objectContaining({ 'line-width': 17 }),
    });

    await waitFor(() => expect(map.getLayer(ROUTE_LAYERS.legHit)).toBeDefined());
    act(() => {
      map.emit('click', { features: [{ properties: { legIndex: 2 } }] }, ROUTE_LAYERS.legHit);
    });
    expect(onSelectLeg).toHaveBeenCalledWith(2);
  });

  it('draws a geometry-less long leg as a dashed approximate chord, not a solid route', async () => {
    const from = { name: 'Cubao', lat: 14.6195, lon: 121.0528 };
    const to = { name: 'Ayala', lat: 14.5547, lon: 121.0244 };
    // Legacy/cached payload: no geometry, so the only drawable line is the
    // straight from→to chord — the reported "line through buildings".
    const leg = { ...makeLeg({ mode: 'mrt3', from, to }), geometry: undefined };
    const itinerary = { ...makeItinerary([leg]), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.approximate)).toBeDefined());
    const chord = collectionOf(map, ROUTE_SOURCES.approximate).features;
    expect(chord).toHaveLength(1);
    expect(chord[0]?.geometry.coordinates).toEqual([
      [from.lon, from.lat],
      [to.lon, to.lat],
    ]);
    // It is never mixed into the solid selected path...
    expect(collectionOf(map, ROUTE_SOURCES.selected).features).toHaveLength(0);
    // ...and the layer marks it dashed + muted, plus counts it for the state mirror.
    expect(map.getLayer(ROUTE_LAYERS.approxLine)?.paint).toMatchObject({
      'line-dasharray': [1.5, 2],
      'line-color': ['get', 'colour'],
    });
    expect(screen.getByTestId('route-map-state')).toHaveAttribute('data-approximate-legs', '1');
  });

  it('decodes routed MOTIS geometry into drawn coordinates', async () => {
    // Real MOTIS geometry copied from services/api/test/fixtures (precision 6).
    const WALK_POLYLINE = 'iilwZ{vryeFfNeV??oBeA??fDcGtD}K??lXyd@??fHgM??|HaNtDsG??nf@vR';
    const WALK_SHAPE: [number, number][] = [
      [121.022334, 14.555813],
      [121.022705, 14.555569],
      [121.02274, 14.555625],
      [121.02287, 14.555541],
      [121.023077, 14.55545],
      [121.023682, 14.555043],
      [121.02391, 14.554895],
      [121.024151, 14.554736],
      [121.024289, 14.554645],
      [121.023973, 14.554013],
    ];
    const itinerary = makeItinerary([
      makeLeg({
        mode: 'walk',
        from: { name: 'Start', lat: 14.555813, lon: 121.022334 },
        to: { name: 'End', lat: 14.554013, lon: 121.023973 },
        geometry: { points: WALK_POLYLINE, precision: 6 },
      }),
    ]);
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId={itinerary.id} />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    expect(collectionOf(map, ROUTE_SOURCES.selected).features[0]?.geometry.coordinates).toEqual(
      WALK_SHAPE,
    );
  });

  it('draws a 15-leg itinerary without losing or merging legs', async () => {
    const itinerary = makeLongItinerary(15);
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId={itinerary.id} />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    expect(collectionOf(map, ROUTE_SOURCES.selected).features).toHaveLength(15);
  });

  it('renders a walk-only itinerary', async () => {
    const itinerary = makeWalkOnlyItinerary();
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId={itinerary.id} />
      </MapCanvas>,
    );
    const map = loadMap();

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    const legs = collectionOf(map, ROUTE_SOURCES.selected).features;
    expect(legs).toHaveLength(1);
    expect(legs[0]?.properties?.['mode']).toBe('walk');
  });

  it('fits the camera to all alternatives, then to the selection and the active leg', async () => {
    const a = { ...makeRailTrip(), id: 'a' };
    const b = altItinerary('b');
    const { rerender } = render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="a" fit="all" />
      </MapCanvas>,
    );
    const map = loadMap();

    const allBounds = [
      ...itineraryCoordinates(a).map((coordinate) => coordinate),
      ...itineraryCoordinates(b),
    ];
    const minLon = Math.min(...allBounds.map(([lon]) => lon));
    const minLat = Math.min(...allBounds.map(([, lat]) => lat));
    const maxLon = Math.max(...allBounds.map(([lon]) => lon));
    const maxLat = Math.max(...allBounds.map(([, lat]) => lat));

    await waitFor(() =>
      expect(map.fitBounds).toHaveBeenCalledWith(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        expect.objectContaining({ maxZoom: 16, duration: 350, padding: 56 }),
      ),
    );

    rerender(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="b" fit="selected" animated={false} />
      </MapCanvas>,
    );
    const selectedBounds = itineraryCoordinates(b);
    const selMinLon = Math.min(...selectedBounds.map(([lon]) => lon));
    const selMaxLon = Math.max(...selectedBounds.map(([lon]) => lon));
    await waitFor(() =>
      expect(map.fitBounds).toHaveBeenLastCalledWith(
        [
          [selMinLon, Math.min(...selectedBounds.map(([, lat]) => lat))],
          [selMaxLon, Math.max(...selectedBounds.map(([, lat]) => lat))],
        ],
        expect.objectContaining({ duration: 0 }),
      ),
    );

    rerender(
      <MapCanvas>
        <RoutePathLayer
          itineraries={[a]}
          variant="detail"
          selectedId="a"
          activeLegIndex={1}
          fit="active-leg"
        />
      </MapCanvas>,
    );
    await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ maxZoom: 17 })));
  });

  it('re-adds its sources and layers after a style reload', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());

    act(() => {
      map.reloadStyle();
    });

    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    expect(map.getLayer(ROUTE_LAYERS.ride)).toBeDefined();
    expect(markers.filter((marker) => marker.map !== null)).toHaveLength(2);
  });

  it('removes every source, layer and marker on unmount', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    const { unmount } = render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());

    unmount();

    for (const layerId of Object.values(ROUTE_LAYERS)) {
      expect(map.getLayer(layerId)).toBeUndefined();
    }
    for (const sourceId of Object.values(ROUTE_SOURCES)) {
      expect(map.getSource(sourceId)).toBeUndefined();
    }
    expect(markers.every((marker) => marker.map === null)).toBe(true);
  });

  it('publishes a screen-reader summary and a machine-readable state mirror', () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" activeLegIndex={2} />
      </MapCanvas>,
    );

    const summary = screen.getByTestId('route-map-state');
    expect(summary).toHaveTextContent('1 ruta sa mapa');
    expect(summary).toHaveAttribute('data-selected-id', 'a');
    expect(summary).toHaveAttribute('data-active-leg', '2');
    expect(summary).toHaveAttribute('data-alternative-count', '0');
  });

  it('paints transfer joins as an ink dot with a white ring', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getLayer(ROUTE_LAYERS.transfers)).toBeDefined());
    expect(map.getLayer(ROUTE_LAYERS.transfers)).toMatchObject({
      paint: expect.objectContaining({
        'circle-color': '#0b1d24',
        'circle-stroke-color': '#ffffff',
      }),
    });
  });

  it('never adds the leg hit layer when the caller does not handle leg taps', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    expect(map.getLayer(ROUTE_LAYERS.legHit)).toBeUndefined();
  });

  it('fits the true bounds of a 15-leg itinerary with a bounded zoom', async () => {
    const itinerary = makeLongItinerary(15);
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId={itinerary.id} fit="all" />
      </MapCanvas>,
    );
    const map = loadMap();
    const coordinates = itineraryCoordinates(itinerary);
    const bounds = [
      [Math.min(...coordinates.map(([lon]) => lon)), Math.min(...coordinates.map(([, lat]) => lat))],
      [Math.max(...coordinates.map(([lon]) => lon)), Math.max(...coordinates.map(([, lat]) => lat))],
    ];
    await waitFor(() =>
      expect(map.fitBounds).toHaveBeenCalledWith(
        bounds,
        expect.objectContaining({ maxZoom: 16 }),
      ),
    );
  });

  it('does not animate the camera when the reduced-motion preference is set', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const itinerary = { ...makeRailTrip(), id: 'a' };
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" fit="all" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() =>
      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ duration: 0 }),
      ),
    );
  });

  it('keeps the overlays and camera when a parent passes a same-content array', async () => {
    const itinerary = { ...makeRailTrip(), id: 'a' };
    const { rerender } = render(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" fit="all" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() => expect(map.getSource(ROUTE_SOURCES.selected)).toBeDefined());
    const sourceCalls = map.addSource.mock.calls.length;
    const fitCalls = map.fitBounds.mock.calls.length;

    // The trip/live pages build `[itinerary]` inside a render prop, so every
    // parent render allocates a new array with the same content (review I4).
    rerender(
      <MapCanvas>
        <RoutePathLayer itineraries={[itinerary]} selectedId="a" fit="all" />
      </MapCanvas>,
    );

    expect(map.addSource.mock.calls.length).toBe(sourceCalls);
    expect(map.fitBounds.mock.calls.length).toBe(fitCalls);
  });

  it('draws the selected route wider and in its mode colours over muted alternatives', async () => {
    const a = { ...makeRailTrip(), id: 'a' };
    const b = altItinerary('b');
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() =>
      expect(collectionOf(map, ROUTE_SOURCES.alternatives).features).toHaveLength(1),
    );
    const ride = map.getLayer(ROUTE_LAYERS.ride)?.paint as Record<string, unknown>;
    const alt = map.getLayer(ROUTE_LAYERS.altLine)?.paint as Record<string, unknown>;
    expect(ride['line-color']).toEqual(['get', 'colour']);
    expect(ride['line-width']).toBeGreaterThan(alt['line-width'] as number);
    expect(map.getLayer(ROUTE_LAYERS.casing)?.paint).toMatchObject({ 'line-width': 16 });
  });

  it('switches the highlighted route by pushing data, not rebuilding the style', async () => {
    const a = { ...makeRailTrip(), id: 'a' };
    const b = altItinerary('b');
    const { rerender } = render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    await waitFor(() =>
      expect(
        collectionOf(map, ROUTE_SOURCES.alternatives).features[0]?.properties?.['itineraryId'],
      ).toBe('b'),
    );
    const sourceCalls = map.addSource.mock.calls.length;
    const layerCalls = map.addLayer.mock.calls.length;
    const removeLayerCalls = map.removeLayer.mock.calls.length;
    const removeSourceCalls = map.removeSource.mock.calls.length;
    const fitCalls = map.fitBounds.mock.calls.length;

    rerender(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="b" />
      </MapCanvas>,
    );

    await waitFor(() =>
      expect(
        collectionOf(map, ROUTE_SOURCES.selected).features.map(
          (feature) => feature.properties?.['mode'],
        ),
      ).toEqual(b.legs.map((leg) => leg.mode)),
    );
    expect(
      collectionOf(map, ROUTE_SOURCES.alternatives).features[0]?.properties?.['itineraryId'],
    ).toBe('a');

    // A card tap must not tear the style down: that was what made the map flash
    // and stall while MapLibre rebuilt every render tile.
    expect(map.addSource.mock.calls.length).toBe(sourceCalls);
    expect(map.addLayer.mock.calls.length).toBe(layerCalls);
    expect(map.removeLayer.mock.calls.length).toBe(removeLayerCalls);
    expect(map.removeSource.mock.calls.length).toBe(removeSourceCalls);
    await waitFor(() => expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitCalls));
  });

  it('fits the camera to the selected route by default on the shortlist', async () => {
    const a = { ...makeRailTrip(), id: 'a' };
    const b = altItinerary('b');
    render(
      <MapCanvas>
        <RoutePathLayer itineraries={[a, b]} selectedId="a" />
      </MapCanvas>,
    );
    const map = loadMap();
    const selectedBounds = itineraryCoordinates(a);
    await waitFor(() =>
      expect(map.fitBounds).toHaveBeenCalledWith(
        [
          [
            Math.min(...selectedBounds.map(([lon]) => lon)),
            Math.min(...selectedBounds.map(([, lat]) => lat)),
          ],
          [
            Math.max(...selectedBounds.map(([lon]) => lon)),
            Math.max(...selectedBounds.map(([, lat]) => lat)),
          ],
        ],
        expect.objectContaining({ padding: 56, maxZoom: 16 }),
      ),
    );
  });
});
