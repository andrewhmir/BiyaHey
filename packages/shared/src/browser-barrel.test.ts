import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { joinAttributions } from '@biyahey/shared';
import type { DataSource } from '@biyahey/shared';

/**
 * Plan 2 (the PWA) may only import `@biyahey/shared`, the browser-safe barrel.
 * The Node-only registry loader lives at `@biyahey/shared/provenance`, which
 * imports `node:fs`; a barrel re-export of it (even accidentally) would break
 * the Vite bundle. This suite is the cheap guard the final review asked for:
 * it exercises the real package specifier and statically walks the barrel's
 * runtime import graph. It cannot run the module in a browser, so it asserts
 * the two properties that would break one: no `node:` specifier and no runtime
 * import of `provenance.ts` (type-only imports are erased by the compiler and
 * are therefore allowed).
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

interface Component {
  id: string;
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

function source(id: string, attribution: string): DataSource {
  const component: Component = {
    id,
    name: `name for ${id}`,
    publisher: 'publisher',
    url: 'https://example.test',
    licence_spdx: 'ODbL-1.0',
    licence_url: 'https://example.test/licence',
    coverage: 'test coverage',
    last_checked: '2026-11-01',
    attribution,
    used_for: ['test'],
  };
  return component as DataSource;
}

/** Drop type-only imports/re-exports: they do not reach the browser bundle. */
function stripTypeOnly(sourceText: string): string {
  return sourceText
    .replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g, '');
}

/** Runtime import specifiers of one source file. */
function runtimeImports(file: string): string[] {
  const text = stripTypeOnly(readFileSync(file, 'utf8'));
  const specifiers: string[] = [];
  const pattern = /(?:from\s*|import\s*)['"]([^'"]+)['"]/g;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) {
      return specifiers;
    }
    specifiers.push(match[1]);
  }
}

/** Walk the barrel's relative runtime imports, collecting the files reached. */
function runtimeGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (graph.has(file)) {
      continue;
    }
    const imports = runtimeImports(file);
    graph.set(file, imports);
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) {
        continue;
      }
      const resolved = join(dirname(file), specifier.replace(/\.js$/, '.ts'));
      pending.push(resolved);
    }
  }
  return graph;
}

describe('browser-safe barrel', () => {
  it('exposes joinAttributions through the package entry point', () => {
    expect(typeof joinAttributions).toBe('function');
    expect(joinAttributions([source('osm', '© OpenStreetMap contributors')])).toBe(
      '© OpenStreetMap contributors',
    );
  });

  it('joins attributions in the given registry order and skips blanks', () => {
    const rows = [
      source('osm', '© OpenStreetMap contributors'),
      source('ltfrb-fares', 'Fares per LTFRB matrix effective 28 Sept 2026'),
      source('mmda-ferry', '   '),
    ];
    expect(joinAttributions(rows)).toBe(
      '© OpenStreetMap contributors · Fares per LTFRB matrix effective 28 Sept 2026',
    );
    expect(joinAttributions([])).toBe('');
  });

  it('has no node built-in or runtime provenance loader in its import graph', () => {
    const graph = runtimeGraph(join(SRC_DIR, 'index.ts'));
    const offenders: string[] = [];
    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        if (specifier.startsWith('node:')) {
          offenders.push(`${file} -> ${specifier}`);
        }
        if (specifier.startsWith('.') && specifier.replace(/\.js$/, '.ts').endsWith('provenance.ts')) {
          offenders.push(`${file} -> ${specifier} (runtime import of the Node-only loader)`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('does not export the Node-only attributionFor from the barrel', async () => {
    const barrel = (await import('@biyahey/shared')) as Record<string, unknown>;
    expect(barrel.attributionFor).toBeUndefined();
    expect(barrel.joinAttributions).toBeTypeOf('function');
  });
});
