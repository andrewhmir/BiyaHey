#!/usr/bin/env node
/**
 * One-command data build: download → osm → publish (spec §7/§8.2, final-review
 * item 2). The PWA is Plan 2; this is the root entry point Plan 1 promises.
 *
 * Usage:
 *   npm run data:build                  # full NCR chain (network: ~612 MB download)
 *   npm run data:build -- --region ph   # national chain (no clip: reuses the download)
 *   npm run data:build -- --skip-download   # reuse data/build/philippines-latest.osm.pbf
 *   npm run data:build -- --publish-only    # reuse the region extract, rebuild the feed
 *
 * `--region ncr` (default) writes `data/build/osm/ncr.osm.pbf` and publishes into
 * `data/build/gtfs`; `--region ph` writes `data/build/osm/ph.osm.pbf` and
 * publishes into `data/build/gtfs/ph` so the national feed sits beside the NCR
 * one instead of replacing it. The `osm` stage also accepts an explicit
 * `bbox:min_lat,min_lon,max_lat,max_lon` region, but this script only drives the
 * two named regional builds.
 *
 * Every stage runs from `pipelines/` with the repository virtualenv, because the
 * pipeline is a Python package (`python -m pipeline.cli`). The publish stage is
 * always invoked with `--aliases data/routes/landmark-aliases.yaml`, the
 * documented R34 alias layer; a build that silently skipped it would drop
 * curated routes.
 *
 * Timings on this machine (recorded in docs/runbooks/data-build.md §1.2): the
 * NCR clip takes ~72 minutes, publish ~6 minutes. The national region skips the
 * clip entirely (it copies the downloaded extract only when needed). The
 * download is explicit (this script) and never happens in tests or CI.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pipelinesDir = join(repoRoot, 'pipelines');
const buildDir = join(repoRoot, 'data', 'build');
const downloadDest = join(buildDir, 'philippines-latest.osm.pbf');
const taginfo = join(pipelinesDir, 'tests', 'fixtures', 'taginfo_philippines.json');
const aliases = join(repoRoot, 'data', 'routes', 'landmark-aliases.yaml');

const isWindows = process.platform === 'win32';
const venvPython = join(
  pipelinesDir,
  '.venv',
  isWindows ? 'Scripts' : 'bin',
  isWindows ? 'python.exe' : 'python',
);
const python = existsSync(venvPython) ? venvPython : isWindows ? 'python' : 'python3';

const argv = process.argv.slice(2);
const skipDownload = argv.includes('--skip-download') || argv.includes('--publish-only');
const publishOnly = argv.includes('--publish-only');

/** Read a `--name value` or `--name=value` flag (undefined when absent). */
function flagValue(name) {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline !== undefined) {
    return inline.slice(`--${name}=`.length);
  }
  const index = argv.indexOf(`--${name}`);
  if (index !== -1) {
    return argv[index + 1] ?? '';
  }
  return undefined;
}

// Region presets. `ph` publishes below data/build/gtfs/ph so the national feed
// cannot overwrite the NCR feed; the `osm` stage copies the downloaded national
// extract instead of clipping, so the second run is cheap.
const region = (flagValue('region') ?? 'ncr').toLowerCase();
const REGION_TARGETS = {
  ncr: { pbf: join(buildDir, 'osm', 'ncr.osm.pbf'), publishDir: buildDir },
  ph: {
    pbf: join(buildDir, 'osm', 'ph.osm.pbf'),
    publishDir: join(buildDir, 'gtfs', 'ph'),
  },
};
const target = REGION_TARGETS[region];
if (target === undefined) {
  console.error(
    `data:build: unknown --region ${region}; accepted regions: ${Object.keys(REGION_TARGETS).join(', ')}`,
  );
  process.exit(1);
}
const feedPath = join(target.publishDir, 'gtfs', 'gtfs.zip');
const manifestPath = join(target.publishDir, 'manifest.json');

function runStage(label, args) {
  console.log(`\ndata:build: ${label}`);
  console.log(`  ${python} ${args.join(' ')}`);
  const result = spawnSync(python, args, {
    cwd: pipelinesDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: pipelinesDir,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  if (result.error !== undefined) {
    console.error(`data:build: could not run python: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`data:build: ${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(pipelinesDir)) {
  console.error('data:build: pipelines/ directory not found; run from the repository root.');
  process.exit(1);
}
if (!existsSync(python) && python !== 'python' && python !== 'python3') {
  console.error(
    `data:build: no pipeline virtualenv interpreter at ${venvPython}. ` +
      'Create it with the commands in docs/runbooks/data-build.md §0.',
  );
  process.exit(1);
}

if (!skipDownload) {
  runStage('download the Geofabrik Philippines extract (network)', [
    '-m',
    'pipeline.cli',
    'download',
    '--dest',
    downloadDest,
  ]);
} else {
  console.log(`data:build: skipping download (using ${downloadDest})`);
  if (!existsSync(downloadDest) && !publishOnly) {
    console.error(
      `data:build: --skip-download was passed but ${downloadDest} does not exist.`,
    );
    process.exit(1);
  }
}

if (!publishOnly) {
  if (!existsSync(downloadDest)) {
    console.error(`data:build: missing input ${downloadDest}; run without --skip-download.`);
    process.exit(1);
  }
  const osmLabel =
    region === 'ph'
      ? 'copy the national extract unchanged (offline)'
      : 'clip the Philippines extract to the NCR bbox (offline)';
  runStage(osmLabel, [
    '-m',
    'pipeline.cli',
    'osm',
    '--pbf',
    downloadDest,
    '--out',
    buildDir,
    '--taginfo',
    taginfo,
    '--region',
    region,
  ]);
} else {
  console.log(`data:build: skipping osm stage (using ${target.pbf})`);
}

if (!existsSync(target.pbf)) {
  console.error(
    `data:build: missing ${region} extract ${target.pbf}; run the osm stage (or the full build).`,
  );
  process.exit(1);
}

runStage('publish GTFS + fares + manifest + build report (offline)', [
  '-m',
  'pipeline.cli',
  'publish',
  '--pbf',
  target.pbf,
  '--out',
  target.publishDir,
  '--aliases',
  aliases,
]);

console.log(`
data:build: done (region ${region})
  feed      ${feedPath}
  manifest  ${manifestPath}
  report    ${join(target.publishDir, 'build-report.json')}

MOTIS only serves the new feed after a container recreate:
  docker compose up -d --force-recreate --wait routing
Then re-run the acceptance live suites:
  npm run test:integration
`);
