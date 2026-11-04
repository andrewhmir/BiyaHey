import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCuratedData } from '../src/domain/curated-data.js';

const created: string[] = [];

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'biyahey-curated-'));
  created.push(dir);
  return dir;
}

function writeTerminals(dir: string, document: string): void {
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(join(dir, 'build', 'tricycle-terminals.json'), document, 'utf8');
}

function terminalsDocument(terminals: unknown[]): string {
  return JSON.stringify({
    generated_at: '2026-11-05T00:00:00Z',
    source: 'osm',
    extract: 'ph.osm.pbf',
    terminals,
  });
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadCuratedData tricycle terminals', () => {
  it('returns no terminals when the artifact is absent', () => {
    expect(loadCuratedData(dataDir()).tricycleTerminals).toEqual([]);
  });

  it('loads the mapped terminals with their published names and coordinates', () => {
    const dir = dataDir();
    // The real artifact row shape (`pipelines/pipeline/publish.py`): integer
    // `osm_id`, `name: str | null`, `kind` from the mapped amenity.
    writeTerminals(
      dir,
      terminalsDocument([
        {
          osm_id: 6901,
          name: 'Wilson E-trike Terminal',
          lat: 14.62058,
          lon: 121.0528,
          kind: 'tricycle_station',
        },
        {
          osm_id: 6902,
          name: null,
          lat: 14.9542,
          lon: 120.8965,
          kind: 'motorcycle_taxi',
        },
      ]),
    );

    const terminals = loadCuratedData(dir).tricycleTerminals;
    expect(terminals).toHaveLength(2);
    expect(terminals[0]).toMatchObject({
      osmId: '6901',
      name: 'Wilson E-trike Terminal',
      lat: 14.62058,
      lon: 121.0528,
      kind: 'tricycle_station',
    });
    // A nameless node keeps `null` in the artifact; the loader carries it as ''
    // so the mapper can use the generic terminal label instead of dropping it.
    expect(terminals[1]).toMatchObject({
      osmId: '6902',
      name: '',
      kind: 'motorcycle_taxi',
    });
  });

  it('drops malformed rows and keeps the usable ones', () => {
    const dir = dataDir();
    writeTerminals(
      dir,
      terminalsDocument([
        null,
        'not-a-row',
        {},
        { name: 'No coordinates' },
        { name: 'Text coordinates', lat: 'north', lon: 121 },
        { name: 'Out of range', lat: 95, lon: 121 },
        { name: 'Out of range', lat: 14, lon: 181 },
        // The real artifact's nameless row: kept with the generic-label marker.
        { osm_id: 6903, name: null, lat: 14.6, lon: 121.0, kind: 'tricycle_stand' },
        // Tolerance for hand-written/legacy rows without `osm_id` or `kind`.
        { name: 'Kept, no name fallback', lat: 14.7, lon: 121.1 },
        { osm_id: 'node/9', name: 'String id row', lat: 14.8, lon: 121.2 },
      ]),
    );

    const terminals = loadCuratedData(dir).tricycleTerminals;
    expect(terminals).toHaveLength(3);
    expect(terminals.map((terminal) => terminal.name)).toEqual([
      '',
      'Kept, no name fallback',
      'String id row',
    ]);
    expect(terminals[2]?.osmId).toBe('node/9');
  });

  it('ignores a corrupt artifact instead of failing boot', () => {
    const dir = dataDir();
    writeTerminals(dir, '{not-json');
    expect(loadCuratedData(dir).tricycleTerminals).toEqual([]);

    writeTerminals(dir, JSON.stringify({ terminals: 'nope' }));
    expect(loadCuratedData(dir).tricycleTerminals).toEqual([]);
  });
});
