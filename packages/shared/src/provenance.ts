import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Stable id for every dataset or service the app draws on (spec §8.1). */
export type SourceId =
  | 'osm'
  | 'osm-wiki-jeepney'
  | 'ltfrb-fares'
  | 'rail-fares'
  | 'mmda-ferry'
  | 'psgc'
  | 'photon'
  | 'openfreemap'
  | 'motis'
  | 'crowd-reports';

/** One row of the provenance registry. */
export interface DataSource {
  id: SourceId;
  name: string;
  publisher: string;
  url: string;
  licence_spdx: string;
  licence_url: string;
  coverage: string;
  last_checked: string;
  attribution: string;
  used_for: string[];
}

/** Thrown when a caller refers to a source id that is not in the registry. */
export class UnknownSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownSourceError';
  }
}

const REGISTRY_PATH = join('provenance', 'sources.yaml');

let cachedSources: DataSource[] | undefined;

/**
 * Resolve the repository `data/` directory by walking up from this module.
 *
 * Deliberately not `process.cwd()`: the loader is called both from Vitest
 * (whose cwd is the repo root) and from services that may run with their own
 * package directory as cwd. Walking up from the module URL finds `<repo>/data`
 * in both cases, and keeps working if the package is compiled (its `dist/`)
 * or hoisted into `node_modules` inside the same repository.
 *
 * Exported so `services/api` can log the directory it will read.
 */
export function resolveDataDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'data');
    if (existsSync(join(candidate, REGISTRY_PATH))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate ${join('data', REGISTRY_PATH)} from ${import.meta.url}`);
    }
    dir = parent;
  }
}

function readSources(dataDir: string): DataSource[] {
  const file = join(dataDir, REGISTRY_PATH);
  const document: unknown = parse(readFileSync(file, 'utf8'));
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`Invalid provenance registry at ${file}: expected a YAML mapping`);
  }
  const sources = (document as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`Invalid provenance registry at ${file}: expected a non-empty "sources" array`);
  }
  return sources.map((entry: unknown, index: number): DataSource => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Invalid source at ${file} sources[${index}]: expected a mapping`);
    }
    const source = entry as Partial<DataSource>;
    if (typeof source.id !== 'string' || typeof source.attribution !== 'string') {
      throw new Error(
        `Invalid source at ${file} sources[${index}]: "id" and "attribution" must be strings`,
      );
    }
    return source as DataSource;
  });
}

/**
 * Load the provenance registry, keyed by source id, preserving registry order.
 *
 * @param dataDir repository `data/` directory; defaults to the repo's own
 *   `data/` directory resolved from this module (see {@link resolveDataDir}).
 */
export function loadProvenance(dataDir?: string): Map<SourceId, DataSource> {
  const sources =
    dataDir === undefined && cachedSources !== undefined
      ? cachedSources
      : readSources(dataDir ?? resolveDataDir());
  if (dataDir === undefined) {
    cachedSources = sources;
  }
  const registry = new Map<SourceId, DataSource>();
  for (const source of sources) {
    registry.set(source.id, source);
  }
  return registry;
}

/**
 * Assert that every id is registered and return the known ids in canonical
 * registry order, deduplicated.
 */
export function assertKnownSources(ids: string[]): SourceId[] {
  const registry = loadProvenance();
  const unknown = [...new Set(ids.filter((id) => !registry.has(id as SourceId)))];
  if (unknown.length > 0) {
    throw new UnknownSourceError(`Unknown source id(s): ${unknown.join(', ')}`);
  }
  const requested = new Set(ids);
  return [...registry.keys()].filter((id) => requested.has(id));
}

/** Return registry entries for `ids` in canonical registry order, deduplicated. */
export function provenanceFor(ids: SourceId[]): DataSource[] {
  const registry = loadProvenance();
  return assertKnownSources(ids).map((id) => registry.get(id)!);
}

/** Join the attributions for `ids` with ` · `, in canonical registry order. */
export function attributionFor(ids: SourceId[]): string {
  return provenanceFor(ids)
    .map((source) => source.attribution)
    .join(' · ');
}
