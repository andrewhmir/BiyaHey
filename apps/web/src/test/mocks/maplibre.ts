import { vi } from 'vitest';

/**
 * Minimal MapLibre GL JS double for jsdom.
 *
 * jsdom has no WebGL context, so constructing a real `Map` throws and any real
 * style fetch would leave the test suite touching the network (R42). This mock
 * records sources, layers, paint changes, camera padding and fits instead,
 * models the style-load state (`loaded` / `styleDirty` / `isStyleLoaded()` /
 * `load` / `style.load`), and lets tests emit the map events the components
 * subscribe to.
 */

export type MapEventHandler = (event: unknown) => void;

/** The four-sided viewport padding MapLibre reports from `getPadding()`. */
export interface MockMapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface MockMapOptions {
  container: HTMLElement;
  style?: unknown;
  attributionControl?: boolean;
  center?: unknown;
  zoom?: number;
  [key: string]: unknown;
}

interface MockLayer {
  id: string;
  [key: string]: unknown;
}

interface MockGeoJSONSourceInput {
  type: 'geojson';
  data: unknown;
}

/**
 * A GeoJSON source with MapLibre's `setData()` contract. Production code updates
 * an existing marker with `setData()` instead of adding a second source, so the
 * mock has to remember the latest data for assertions.
 */
export class MockGeoJSONSource {
  readonly type = 'geojson';
  data: unknown;
  setData = vi.fn((data: unknown): this => {
    this.data = data;
    return this;
  });

  constructor(source: MockGeoJSONSourceInput) {
    this.data = source.data;
  }
}

function isGeoJSONSource(source: unknown): source is MockGeoJSONSourceInput {
  return (
    typeof source === 'object' &&
    source !== null &&
    (source as { type?: unknown }).type === 'geojson'
  );
}

export const mapInstances: MockMap[] = [];
/** Every Marker created since `resetMapLibreMock()`; cleared by the same call. */
export const markers: MockMarker[] = [];

/**
 * Minimal MapLibre `Marker` double: records the element, position and the map it
 * was added to, so tests can assert origin/destination/alternative markers and
 * the layer's teardown.
 */
export class MockMarker {
  readonly element: HTMLElement;
  lngLat: [number, number] | null = null;
  map: MockMap | null = null;

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
    markers.push(this);
  }

  setLngLat = vi.fn((lngLat: [number, number]): this => {
    this.lngLat = lngLat;
    return this;
  });

  addTo = vi.fn((map: MockMap): this => {
    this.map = map;
    return this;
  });

  remove = vi.fn((): this => {
    this.map = null;
    return this;
  });

  getElement(): HTMLElement {
    return this.element;
  }
}


export class MockMap {
  readonly options: MockMapOptions;
  readonly sources = new Map<string, unknown>();
  readonly layers = new Map<string, MockLayer>();
  /** Mirrors MapLibre: false until the style has finished loading. */
  loaded = false;
  /**
   * Mirrors MapLibre's style dirtiness: adding a source or layer marks the style
   * dirty, and `isStyleLoaded()` then reports false until the map has processed
   * the change (the next `load` / `style.load` here). Modelling this keeps
   * effects honest that mutate the style and then re-check `isStyleLoaded()` in
   * the same commit — they fail here exactly as they do in a browser.
   */
  styleDirty = false;
  /** Viewport padding, as MapLibre remembers it across `setPadding()` calls. */
  padding: MockMapPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly handlers = new Map<string, Set<MapEventHandler>>();

  constructor(options: MockMapOptions) {
    this.options = options;
    mapInstances.push(this);
  }

  isStyleLoaded = vi.fn((): boolean => this.loaded && !this.styleDirty);

  addSource = vi.fn((id: string, source: unknown): this => {
    if (this.sources.has(id)) throw new Error(`Source "${id}" already exists.`);
    this.sources.set(id, isGeoJSONSource(source) ? new MockGeoJSONSource(source) : source);
    this.styleDirty = true;
    return this;
  });

  getSource = vi.fn((id: string): unknown => this.sources.get(id));

  removeSource = vi.fn((id: string): this => {
    this.sources.delete(id);
    return this;
  });

  addLayer = vi.fn((layer: MockLayer): this => {
    if (this.layers.has(layer.id)) throw new Error(`Layer "${layer.id}" already exists.`);
    this.layers.set(layer.id, layer);
    this.styleDirty = true;
    return this;
  });

  getLayer = vi.fn((id: string): MockLayer | undefined => this.layers.get(id));

  removeLayer = vi.fn((id: string): this => {
    this.layers.delete(id);
    return this;
  });

  setPaintProperty = vi.fn((): this => this);

  setPadding = vi.fn((padding: Partial<MockMapPadding>): this => {
    this.padding = { ...this.padding, ...padding };
    return this;
  });

  getPadding = vi.fn((): MockMapPadding => ({ ...this.padding }));

  fitBounds = vi.fn((): this => this);

  flyTo = vi.fn((): this => this);

  resize = vi.fn((): this => this);

  remove = vi.fn((): this => this);

  getCanvas = vi.fn((): HTMLCanvasElement => document.createElement('canvas'));

  getContainer = vi.fn((): HTMLElement => this.options.container);

  on = vi.fn(
    (
      type: string,
      layerOrHandler: string | MapEventHandler,
      maybeHandler?: MapEventHandler,
    ): this => {
      const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
      if (!handler) return this;
      const key = typeof layerOrHandler === 'string' ? `${type}:${layerOrHandler}` : type;
      const handlers = this.handlers.get(key) ?? new Set<MapEventHandler>();
      handlers.add(handler);
      this.handlers.set(key, handlers);
      return this;
    },
  );

  off = vi.fn(
    (
      type: string,
      layerOrHandler: string | MapEventHandler,
      maybeHandler?: MapEventHandler,
    ): this => {
      const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
      if (!handler) return this;
      const key = typeof layerOrHandler === 'string' ? `${type}:${layerOrHandler}` : type;
      this.handlers.get(key)?.delete(handler);
      return this;
    },
  );

  once = vi.fn((type: string, handler: MapEventHandler): this => {
    const wrapper: MapEventHandler = (event) => {
      this.handlers.get(type)?.delete(wrapper);
      handler(event);
    };
    const handlers = this.handlers.get(type) ?? new Set<MapEventHandler>();
    handlers.add(wrapper);
    this.handlers.set(type, handlers);
    return this;
  });

  /** Test-only: dispatch an event (optionally to a layer handler). */
  emit(type: string, event?: unknown, layerId?: string): void {
    // `load` / `style.load` mean the style is usable again: reset the dirtiness
    // before dispatching so handlers observe `isStyleLoaded() === true`.
    if (type === 'load' || type === 'style.load') {
      this.loaded = true;
      this.styleDirty = false;
    }
    this.dispatch(type, event);
    if (layerId) this.dispatch(`${type}:${layerId}`, event);
  }

  /** Test-only: simulate `setStyle()`, which drops every source and layer. */
  reloadStyle(): void {
    this.sources.clear();
    this.layers.clear();
    this.emit('style.load');
  }

  private dispatch(key: string, event: unknown): void {
    for (const handler of [...(this.handlers.get(key) ?? [])]) handler(event);
  }
}

/** Forget maps and markers created by an earlier test. Called from the shared test setup. */
export function resetMapLibreMock(): void {
  mapInstances.length = 0;
  markers.length = 0;
}

/**
 * Shape returned by `vi.mock('maplibre-gl', ...)`. `default` mirrors the
 * namespace because MapLibre supports both default and named imports.
 *
 * `setWorkerUrl` is called at module scope in `MapCanvas` (the production
 * worker asset cannot be resolved by MapLibre's own runtime `new URL()`); the
 * double only needs the export to exist.
 */
export const mockMapLibre = {
  Map: MockMap,
  Marker: MockMarker,
  setWorkerUrl: (): void => undefined,
  default: undefined as unknown,
};

mockMapLibre.default = mockMapLibre;
