import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Stable id for every dataset, service or computed estimate the app draws on (spec §8.1). */
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
  | 'crowd-reports'
  /** BiyaHey!-computed walking estimate (derived; no external dataset). */
  | 'walk-estimate';

/**
 * One row of the provenance registry.
 *
 * The registry can also hold a `kind: 'derived'` row (`walk-estimate`): it is
 * computed by BiyaHey! rather than sourced from a dataset, so it claims no
 * dataset licence (`licence_spdx: NOASSERTION`, no `licence_url`) and uses the
 * registry's `"—"` sentinel for "no external URL". Its `method` field states
 * the computation. The schema in `data/provenance/schema/sources.schema.json`
 * is the authority for that branch.
 */
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

/**
 * A loaded provenance registry, keyed by source id in canonical registry order.
 *
 * Routes that resolve ids for a specific data directory pass their registry in
 * instead of letting the helpers fall back to the repository's own `data/`, so
 * validation and served `DataSource` rows cannot disagree.
 */
export type ProvenanceRegistry = ReadonlyMap<SourceId, DataSource>;

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
 * Assert that every id is registered in `registry` and return the known ids in
 * canonical registry order, deduplicated.
 *
 * @param registry registry to validate against; defaults to the repository's
 *   own registry (see {@link loadProvenance}).
 */
export function assertKnownSources(
  ids: string[],
  registry: ProvenanceRegistry = loadProvenance(),
): SourceId[] {
  const unknown = [...new Set(ids.filter((id) => !registry.has(id as SourceId)))];
  if (unknown.length > 0) {
    throw new UnknownSourceError(`Unknown source id(s): ${unknown.join(', ')}`);
  }
  const requested = new Set(ids);
  return [...registry.keys()].filter((id) => requested.has(id));
}

/**
 * Return registry entries for `ids` in canonical registry order, deduplicated.
 *
 * @param registry registry to read from; defaults to the repository's own
 *   registry (see {@link loadProvenance}).
 */
export function provenanceFor(
  ids: SourceId[],
  registry: ProvenanceRegistry = loadProvenance(),
): DataSource[] {
  return assertKnownSources(ids, registry).map((id) => registry.get(id)!);
}

/**
 * Join the attributions for `ids` with ` · `, in canonical registry order.
 *
 * @param registry registry to read from; defaults to the repository's own
 *   registry (see {@link loadProvenance}).
 */
export function attributionFor(
  ids: SourceId[],
  registry: ProvenanceRegistry = loadProvenance(),
): string {
  return provenanceFor(ids, registry)
    .map((source) => source.attribution)
    .join(' · ');
}
