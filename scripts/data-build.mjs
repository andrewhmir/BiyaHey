#!/usr/bin/env node
/**
 * One-command data build: download → osm → publish (spec §7/§8.2, final-review
 * item 2). The PWA is Plan 2; this is the root entry point Plan 1 promises.
 *
 * Usage:
 *   npm run data:build                  # full chain (network: ~612 MB download)
 *   npm run data:build -- --skip-download   # reuse data/build/philippines-latest.osm.pbf
 *   npm run data:build -- --publish-only    # reuse the NCR clip, rebuild the feed
 *
 * Every stage runs from `pipelines/` with the repository virtualenv, because the
 * pipeline is a Python package (`python -m pipeline.cli`). The publish stage is
 * always invoked with `--aliases data/routes/landmark-aliases.yaml`, the
 * documented R34 alias layer; a build that silently skipped it would drop
 * curated routes.
 *
 * Timings on this machine (recorded in docs/runbooks/data-build.md §1.2): the
 * full-PH clip takes ~72 minutes, publish ~6 minutes. The download is explicit
 * (this script) and never happens in tests or CI.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pipelinesDir = join(repoRoot, 'pipelines');
const buildDir = join(repoRoot, 'data', 'build');
const downloadDest = join(buildDir, 'philippines-latest.osm.pbf');
const ncrPbf = join(buildDir, 'osm', 'ncr.osm.pbf');
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
  runStage('clip the Philippines extract to the NCR bbox (offline)', [
    '-m',
    'pipeline.cli',
    'osm',
    '--pbf',
    downloadDest,
    '--out',
    buildDir,
    '--taginfo',
    taginfo,
  ]);
} else {
  console.log(`data:build: skipping osm stage (using ${ncrPbf})`);
}

if (!existsSync(ncrPbf)) {
  console.error(
    `data:build: missing NCR extract ${ncrPbf}; run the osm stage (or the full build).`,
  );
  process.exit(1);
}

runStage('publish GTFS + fares + manifest + build report (offline)', [
  '-m',
  'pipeline.cli',
  'publish',
  '--pbf',
  ncrPbf,
  '--out',
  buildDir,
  '--aliases',
  aliases,
]);

console.log(`
data:build: done
  feed      ${join(buildDir, 'gtfs', 'gtfs.zip')}
  manifest  ${join(buildDir, 'manifest.json')}
  report    ${join(buildDir, 'build-report.json')}

MOTIS only serves the new feed after a container recreate:
  docker compose up -d --force-recreate --wait routing
Then re-run the acceptance live suites:
  npm run test:integration
`);
