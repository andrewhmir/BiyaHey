import { vi } from 'vitest';

/**
 * Minimal MapLibre GL JS double for jsdom.
 *
 * jsdom has no WebGL context, so constructing a real `Map` throws and any real
 * style fetch would leave the test suite touching the network (R42). This mock
 * records sources, layers and paint changes instead, models the style-load state
 * (`loaded` / `isStyleLoaded()` / `load`), and lets tests emit the map events
 * the components subscribe to.
 */

export type MapEventHandler = (event: unknown) => void;

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

export class MockMap {
  readonly options: MockMapOptions;
  readonly sources = new Map<string, unknown>();
  readonly layers = new Map<string, MockLayer>();
  /** Mirrors MapLibre: false until the style has finished loading. */
  loaded = false;
  private readonly handlers = new Map<string, Set<MapEventHandler>>();

  constructor(options: MockMapOptions) {
    this.options = options;
    mapInstances.push(this);
  }

  isStyleLoaded = vi.fn((): boolean => this.loaded);

  addSource = vi.fn((id: string, source: unknown): this => {
    if (this.sources.has(id)) throw new Error(`Source "${id}" already exists.`);
    this.sources.set(id, isGeoJSONSource(source) ? new MockGeoJSONSource(source) : source);
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
    return this;
  });

  getLayer = vi.fn((id: string): MockLayer | undefined => this.layers.get(id));

  removeLayer = vi.fn((id: string): this => {
    this.layers.delete(id);
    return this;
  });

  setPaintProperty = vi.fn((): this => this);

  setPadding = vi.fn((): this => this);

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
    // The style is only usable once `load` / `style.load` has fired; handlers
    // must therefore observe `isStyleLoaded() === true` while running.
    if (type === 'load' || type === 'style.load') this.loaded = true;
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

/** Forget maps created by an earlier test. Called from the shared test setup. */
export function resetMapLibreMock(): void {
  mapInstances.length = 0;
}

/**
 * Shape returned by `vi.mock('maplibre-gl', ...)`. `default` mirrors the
 * namespace because MapLibre supports both default and named imports.
 */
export const mockMapLibre = {
  Map: MockMap,
  default: undefined as unknown,
};

mockMapLibre.default = mockMapLibre;
