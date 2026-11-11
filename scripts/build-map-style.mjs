#!/usr/bin/env node
/**
 * Build the self-hosted BiyaHey! basemap style from OpenFreeMap Liberty.
 *
 * The app draws its map with MapLibre over OpenFreeMap's free vector tiles. The
 * stock Liberty style is fetched from `tiles.openfreemap.org` at runtime, which
 * costs an extra cross-origin round-trip before *anything* can be drawn and
 * ships a full city-browser style (POI/shop icons, one-way arrows, US highway
 * shields, 3D buildings, shaded relief) that a commuter route planner never
 * shows. This script pulls the upstream style once, trims it to the layers this
 * app actually renders, rewrites every asset URL to the absolute CDN URL (so the
 * style can be served from our own origin `GET /map/style.json` without moving
 * sprites/glyphs/tiles), and writes the result into `apps/web/public/map/`,
 * where Vite copies it verbatim into the build and the service worker can
 * precache it.
 *
 * Regenerate after an upstream Liberty release or when changing the keep list:
 *
 *   node scripts/build-map-style.mjs            # write public/map/style.json
 *   node scripts/build-map-style.mjs --check    # fail if the file is stale
 *
 * The generated JSON is committed so builds are deterministic and offline-safe.
 * What is kept: background/water/landuse/parks, buildings, the road casing+fill
 * hierarchy, rail lines (transit!), river bridges, administrative boundaries and
 * the place/road/water labels. What is dropped: every decorative POI/shop/
 * religion icon layer, one-way arrows, highway shields, airport icons, 3D
 * buildings, shaded-relief raster, tunnels and path/track clutter. Dropping the
 * last sprite consumer lets us drop the ~150 KB sprite atlas entirely, and
 * remapping the italic font to Regular drops one glyph PBF download.
 *
 * Attribution: the OpenStreetMap / OpenFreeMap / OpenMapTiles attribution from
 * the upstream TileJSON is embedded in `sources.openmaptiles.attribution`, and
 * the app also renders its own always-visible MapCredit. Do not remove either.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(REPO_ROOT, 'apps', 'web', 'public', 'map', 'style.json');

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

/**
 * Layers kept for the transit-planner look, in source order. Everything else
 * (POIs, shields, arrows, 3D buildings, relief, tunnels, paths...) is dropped.
 * Every id here must exist upstream - the build fails loudly otherwise, so an
 * upstream style change cannot silently produce a half-empty map.
 */
const KEEP_LAYERS = [
  // ground: background, parks, built-up tint, water and coast
  'background',
  'park',
  'park_outline',
  'landuse_residential',
  'landcover_wood',
  'landcover_grass',
  'landcover_sand',
  'water',
  'waterway_river',
  'waterway_other',
  // road hierarchy: casing under fill for motorway/trunk/primary/secondary/minor
  'road_motorway_casing',
  'road_trunk_primary_casing',
  'road_secondary_tertiary_casing',
  'road_minor_casing',
  'road_motorway',
  'road_trunk_primary',
  'road_secondary_tertiary',
  'road_minor',
  'road_motorway_link',
  'road_link',
  // rail: PNR/LRT/MRT lines and their hatching, on the ground and on bridges
  'road_major_rail',
  'road_major_rail_hatching',
  'road_transit_rail',
  'road_transit_rail_hatching',
  'bridge_motorway',
  'bridge_motorway_casing',
  'bridge_trunk_primary',
  'bridge_trunk_primary_casing',
  'bridge_secondary_tertiary',
  'bridge_secondary_tertiary_casing',
  'bridge_major_rail',
  'bridge_major_rail_hatching',
  'bridge_transit_rail',
  'bridge_transit_rail_hatching',
  // buildings (z13+; kept so walking legs at street level still read as a city)
  'building',
  // administrative boundaries (region + LGU)
  'boundary_2',
  'boundary_3',
  // labels: water, roads, neighbourhoods and settlements
  'water_name_point_label',
  'water_name_line_label',
  'waterway_line_label',
  'highway-name-major',
  'highway-name-minor',
  'label_other',
  'label_village',
  'label_town',
  'label_city',
  'label_city_capital',
];

/** Layout properties that only exist to place a sprite icon next to the text. */
const ICON_LAYOUT_PREFIX = 'icon-';
/** Fonts we are willing to download; anything else is mapped to Regular. */
const ALLOWED_FONTS = new Set(['Noto Sans Regular', 'Noto Sans Bold']);
const FONT_REMAP = { 'Noto Sans Italic': 'Noto Sans Regular' };

function log(message) {
  console.log(`build-map-style: ${message}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} responded HTTP ${response.status}`);
  return { url: response.url || url, body: await response.json() };
}

/** Turn a possibly relative style URL into an absolute CDN URL. */
function absolute(url, base) {
  if (typeof url !== 'string') return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    return url.startsWith('//') ? `https:${url}` : url;
  }
  return new URL(url, base).href;
}

/** Rewrite sprite/glyphs/source URLs in place so the style works from our origin. */
function absolutizeStyleUrls(style, styleUrl) {
  const base = styleUrl;
  if (typeof style.sprite === 'string') style.sprite = absolute(style.sprite, base);
  if (typeof style.glyphs === 'string') style.glyphs = absolute(style.glyphs, base);
  for (const source of Object.values(style.sources ?? {})) {
    if (typeof source.url === 'string') source.url = absolute(source.url, base);
    if (Array.isArray(source.tiles)) source.tiles = source.tiles.map((tile) => absolute(tile, base));
  }
}

/**
 * Strip sprite icon placement from a kept symbol layer. At Metro Manila zoom
 * levels the upstream place labels resolve their icon to "" anyway; low-zoom
 * labels lose a decorative dot so the whole sprite atlas can be dropped.
 */
function stripSpriteLayout(layer) {
  const layout = layer.layout ?? {};
  for (const key of Object.keys(layout)) {
    if (key.startsWith(ICON_LAYOUT_PREFIX)) delete layout[key];
  }
  const paint = layer.paint ?? {};
  delete paint['fill-pattern'];
  return layout;
}

/** Keep the two font stacks the map actually needs (no italic glyph download). */
function remapFonts(layer) {
  const layout = layer.layout ?? {};
  if (!Array.isArray(layout['text-font'])) return;
  layout['text-font'] = layout['text-font'].map((font) =>
    ALLOWED_FONTS.has(font) ? font : (FONT_REMAP[font] ?? 'Noto Sans Regular'),
  );
}

/**
 * The exact build transform. Exported so tests/perf tooling could reuse it:
 * takes the upstream style + TileJSON and returns the trimmed, self-hosted style.
 */
export function buildMapStyle(upstream, tileJson, { styleUrl = STYLE_URL } = {}) {
  const style = JSON.parse(JSON.stringify(upstream));
  absolutizeStyleUrls(style, styleUrl);

  const byId = new Map((style.layers ?? []).map((layer) => [layer.id, layer]));
  const kept = [];
  for (const id of KEEP_LAYERS) {
    const layer = byId.get(id);
    if (layer === undefined) {
      throw new Error(`upstream style no longer has layer "${id}" - update KEEP_LAYERS`);
    }
    kept.push(layer);
  }

  for (const layer of kept) {
    if (layer.type === 'symbol') {
      stripSpriteLayout(layer);
      remapFonts(layer);
    }
  }

  // Drop any source no kept layer uses (the Natural Earth relief raster).
  const usedSources = new Set(kept.map((layer) => layer.source).filter((source) => source !== undefined));
  const sources = {};
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    if (!usedSources.has(id)) continue;
    sources[id] = source;
  }

  // No kept layer may reference the sprite atlas or a font we do not fetch.
  const leftoverSprite = kept.filter((layer) =>
    /"(icon-[a-z-]+|fill-pattern)"|"(text-font|icon-image)":\s*\[\s*"Noto Sans (?!Regular|Bold)/.test(
      JSON.stringify(layer),
    ),
  );
  if (leftoverSprite.length > 0) {
    throw new Error(`trim left sprite/unsupported-font references in: ${leftoverSprite.map((l) => l.id).join(', ')}`);
  }

  // Required attribution travels with the style so it survives even if the
  // upstream TileJSON changes; MapLibre uses it and the app's MapCredit mirrors it.
  if (sources.openmaptiles !== undefined && typeof tileJson.attribution === 'string') {
    sources.openmaptiles.attribution = tileJson.attribution;
  }

  const trimmed = {
    version: style.version ?? 8,
    name: 'BiyaHey Liberty (trimmed)',
    metadata: {
      'biyahey:generator': 'scripts/build-map-style.mjs',
      'biyahey:upstream-style': STYLE_URL,
      'biyahey:upstream-tiles': sources.openmaptiles?.url ?? TILEJSON_URL,
      'biyahey:attribution':
        'Map data © OpenStreetMap contributors, tiles © OpenFreeMap / OpenMapTiles. Attribution is kept in sources.openmaptiles.attribution and rendered by the app MapCredit - do not remove.',
      'biyahey:trimmed': `kept ${kept.length} of ${(style.layers ?? []).length} upstream layers`,
    },
    // `sprite` is intentionally absent: every icon consumer was dropped, which
    // removes the ~118 KB atlas PNG + its JSON from the critical path.
    glyphs: style.glyphs,
    sources,
    layers: kept,
  };
  if (trimmed.glyphs === undefined) throw new Error('upstream style has no glyphs URL');

  // Validate against MapLibre's own style spec when it is installed (it ships
  // with maplibre-gl), so a bad trim fails here instead of on a phone.
  let warnings = [];
  try {
    const spec = require('@maplibre/maplibre-gl-style-spec');
    const errors = spec.validateStyleMin(trimmed, spec.latest);
    if (errors.length > 0) {
      throw new Error(`trimmed style is invalid:\n${errors.slice(0, 10).map((e) => `  ${e.message}`).join('\n')}`);
    }
    warnings = spec.validateStyleMin(trimmed);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('trimmed style is invalid')) throw error;
    // Validator not installed (e.g. npm ci without maplibre-gl) - not fatal.
  }

  return {
    style: trimmed,
    stats: {
      upstreamLayers: (style.layers ?? []).length,
      keptLayers: kept.length,
      removedLayers: (style.layers ?? []).length - kept.length,
      removedIds: (style.layers ?? []).map((layer) => layer.id).filter((id) => !KEEP_LAYERS.includes(id)),
      sources: Object.keys(sources),
      fonts: [...new Set(kept.flatMap((layer) => layer.layout?.['text-font'] ?? []))],
      warnings: warnings.map((warning) => warning.message),
    },
  };
}

async function main() {
  const check = process.argv.includes('--check');
  if (new Set(KEEP_LAYERS).size !== KEEP_LAYERS.length) {
    throw new Error('KEEP_LAYERS contains duplicates');
  }

  log(`fetching ${STYLE_URL}`);
  const upstream = await fetchJson(STYLE_URL);
  log(`fetching ${TILEJSON_URL} (attribution)`);
  const tileJson = await fetchJson(TILEJSON_URL);
  const { style, stats } = buildMapStyle(upstream.body, tileJson.body, { styleUrl: upstream.url });
  const serialized = `${JSON.stringify(style)}\n`;
  const upstreamBytes = Buffer.byteLength(JSON.stringify(upstream.body));

  if (check) {
    let current;
    try {
      current = await readFile(OUTPUT, 'utf8');
    } catch {
      throw new Error(`${OUTPUT} is missing - run: node scripts/build-map-style.mjs`);
    }
    if (current !== serialized) {
      throw new Error(`${OUTPUT} is stale - run: node scripts/build-map-style.mjs`);
    }
    log(`up to date (${stats.keptLayers} layers, ${Buffer.byteLength(serialized)} bytes)`);
    return;
  }

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, serialized);

  const relative = OUTPUT.slice(REPO_ROOT.length + 1);
  log(`wrote ${relative}`);
  log(`layers: ${stats.upstreamLayers} upstream -> ${stats.keptLayers} kept (${stats.removedLayers} removed)`);
  log(`bytes: ${upstreamBytes} upstream JSON -> ${Buffer.byteLength(serialized)} self-hosted JSON`);
  log(`sources: ${stats.sources.join(', ')} | fonts: ${stats.fonts.join(', ')} | sprite: none`);
  if (stats.warnings.length > 0) {
    log(`style-spec warnings (${stats.warnings.length}):`);
    for (const warning of stats.warnings.slice(0, 12)) log(`  - ${warning}`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`build-map-style: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
