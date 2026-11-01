import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { normalizeRouteId } from '../routing/map-itinerary.js';

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
}

const FREE_RIDE_FILE = join('fares', 'free-ride-routes.yaml');
const INVENTORY_FILE = join('routes', 'jeepney-inventory.yaml');

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

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'));
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
 * Load the two optional curated data files next to the provenance registry.
 *
 * Missing files are legitimate (a test data dir may only carry
 * `provenance/sources.yaml`); malformed files fail at boot, where an operator
 * can see the error, rather than degrading every later plan request.
 */
export function loadCuratedData(dataDir: string): CuratedData {
  const inventory = loadCuratedInventory(dataDir);
  return {
    freeRideRouteIds: loadFreeRideRoutes(dataDir),
    curatedLandmarks: inventory.landmarks,
    curatedRouteIds: inventory.routeIds,
  };
}
