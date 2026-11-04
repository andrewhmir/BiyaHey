import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { normalizeRouteId, type TricycleTerminal } from '../routing/map-itinerary.js';

/** Curated data the plan adapter adds to the raw MOTIS itineraries. */
export interface CuratedData {
  /** Normalized route ids whose fare is overridden to a free ride. */
  freeRideRouteIds: ReadonlySet<string>;
  /** Normalized curated route id → its `stop_landmarks` names, in travel order. */
  curatedLandmarks: ReadonlyMap<string, readonly string[]>;
  /**
   * Normalized route ids listed in the curated jeep/UV inventory. Only these
   * routes actually used the OSM Wiki dataset; every other jeep/UV route in the
   * live feed is OSM-relation-derived.
   */
  curatedRouteIds: ReadonlySet<string>;
  /**
   * Mapped tricycle terminals from the build artifact, used only to hint at a
   * walk leg (PH-wide coverage D5). Empty when the artifact is absent or carries
   * no usable rows: a missing artifact is a legitimate degradation, not an
   * error.
   */
  tricycleTerminals: readonly TricycleTerminal[];
}

const FREE_RIDE_FILE = join('fares', 'free-ride-routes.yaml');
const INVENTORY_FILE = join('routes', 'jeepney-inventory.yaml');
/**
 * Canonical terminal artifact written by the data build (Task 8). The BFF's
 * data root is `/data`, so the runtime path is
 * `/data/build/tricycle-terminals.json`.
 */
const TRICYCLE_TERMINALS_FILE = join('build', 'tricycle-terminals.json');

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'));
}

/**
 * Load the mapped tricycle terminals, or `[]` when the artifact is absent.
 *
 * The artifact is produced by a different lane and may legitimately not exist
 * yet, so it is loaded defensively rather than failing boot the way the two
 * hand-curated YAML files do: a corrupt JSON document, a document without a
 * `terminals` array, or a row without usable coordinates is ignored. A hint is
 * an optional annotation, so degrading to no hints is always safe.
 */
function loadTricycleTerminals(dataDir: string): TricycleTerminal[] {
  const path = join(dataDir, TRICYCLE_TERMINALS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const record = asRecord(document);
  const rows = record === undefined ? undefined : asArray(record.terminals);
  if (rows === undefined) {
    return [];
  }
  const terminals: TricycleTerminal[] = [];
  for (const entry of rows) {
    const row = asRecord(entry);
    if (row === undefined) {
      continue;
    }
    const lat = asNumber(row.lat);
    const lon = asNumber(row.lon);
    if (lat === undefined || lon === undefined) {
      continue;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      continue;
    }
    const terminal: TricycleTerminal = {
      name: asString(row.name)?.trim() ?? '',
      lat,
      lon,
    };
    const osmId = asString(row.osm_id) ?? asNumber(row.osm_id)?.toString();
    if (osmId !== undefined) {
      terminal.osmId = osmId;
    }
    const kind = asString(row.kind);
    if (kind !== undefined) {
      terminal.kind = kind;
    }
    terminals.push(terminal);
  }
  return terminals;
}

function loadFreeRideRoutes(dataDir: string): Set<string> {
  const path = join(dataDir, FREE_RIDE_FILE);
  const routeIds = new Set<string>();
  if (!existsSync(path)) {
    return routeIds;
  }
  const document = asRecord(readYaml(path));
  const routes = document === undefined ? undefined : asArray(document.routes);
  if (routes === undefined) {
    throw new Error(`Invalid free-ride override list at ${path}: expected a "routes" array`);
  }
  for (const entry of routes) {
    const route = asRecord(entry);
    const routeId = route === undefined ? undefined : asString(route.route_id);
    if (routeId === undefined) {
      throw new Error(`Invalid free-ride override at ${path}: every row needs a string route_id`);
    }
    const normalized = normalizeRouteId(routeId);
    if (normalized === undefined) {
      throw new Error(
        `Invalid free-ride override at ${path}: route_id "${routeId}" is not a GTFS route id`,
      );
    }
    routeIds.add(normalized);
  }
  return routeIds;
}

interface CuratedInventory {
  landmarks: Map<string, readonly string[]>;
  routeIds: Set<string>;
}

function loadCuratedInventory(dataDir: string): CuratedInventory {
  const path = join(dataDir, INVENTORY_FILE);
  const landmarks = new Map<string, readonly string[]>();
  const routeIds = new Set<string>();
  if (!existsSync(path)) {
    return { landmarks, routeIds };
  }
  const document = asRecord(readYaml(path));
  const routes = document === undefined ? undefined : asArray(document.routes);
  if (routes === undefined) {
    throw new Error(`Invalid curated inventory at ${path}: expected a "routes" array`);
  }
  for (const entry of routes) {
    const route = asRecord(entry);
    if (route === undefined) {
      continue;
    }
    const code = asString(route.code);
    const mode = asString(route.mode);
    if (code === undefined || mode === undefined) {
      continue;
    }
    const prefix = mode === 'jeepney' ? 'jeep' : mode === 'uv-express' ? 'uv' : undefined;
    if (prefix === undefined) {
      continue;
    }
    const routeId = `${prefix}-${code.toLowerCase()}`;
    routeIds.add(routeId);
    const published = asArray(route.stop_landmarks)?.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (published !== undefined) {
      landmarks.set(routeId, published);
    }
  }
  return { landmarks, routeIds };
}

/**
 * Load the optional curated data files and built artifacts next to the
 * provenance registry.
 *
 * Missing files are legitimate (a test data dir may only carry
 * `provenance/sources.yaml`); malformed hand-curated YAML fails at boot, where
 * an operator can see the error, rather than degrading every later plan
 * request. The machine-built tricycle terminal artifact is the exception: a
 * missing or corrupt artifact degrades to no walk hints and no error.
 */
export function loadCuratedData(dataDir: string): CuratedData {
  const inventory = loadCuratedInventory(dataDir);
  return {
    freeRideRouteIds: loadFreeRideRoutes(dataDir),
    curatedLandmarks: inventory.landmarks,
    curatedRouteIds: inventory.routeIds,
    tricycleTerminals: loadTricycleTerminals(dataDir),
  };
}
