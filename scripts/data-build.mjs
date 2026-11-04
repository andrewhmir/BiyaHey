#!/usr/bin/env node
/**
 * One-command data build: download → osm → publish (spec §7/§8.2, final-review
 * item 2). The PWA is Plan 2; this is the root entry point Plan 1 promises.
 *
 * Usage:
 *   npm run data:build                  # full NCR chain (network: ~612 MB download)
 *   npm run data:build -- --region ph   # national chain: no clip, and no download
 *                                       # when data/build/philippines-latest.osm.pbf exists
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
 * The printed next step recreates the `routing` service because MOTIS imports
 * its graph at startup. NCR uses the image's default config, so its command is
 * unchanged; `--region ph` selects the national config through
 * `BIYAHEY_ROUTING_CONFIG` (mapped to `MOTIS_CONFIG` in docker-compose.yml), so
 * an operator following the national build's output cannot leave the NCR graph
 * serving by mistake.
 *
 * Every stage runs from `pipelines/` with the repository virtualenv, because the
 * pipeline is a Python package (`python -m pipeline.cli`). The publish stage is
 * always invoked with `--aliases data/routes/landmark-aliases.yaml`, the
 * documented R34 alias layer; a build that silently skipped it would drop
 * curated routes.
 *
 * The national publish also passes `--landmarks-pbf data/build/osm/ncr.osm.pbf`
 * (ruling R17): the curated inventory is NCR-only, so resolving its terminals
 * against the 612 MB national extract would dominate the build for no gain.
 * The NCR clip must therefore exist before `--region ph` publishes; the script
 * checks that explicitly instead of letting landmark resolution be skipped.
 *
 * Timings on this machine (recorded in docs/runbooks/data-build.md §1.2): the
 * NCR clip takes ~72 minutes, publish ~6 minutes. The national region skips the
 * clip entirely (it copies the downloaded extract only when needed) and skips
 * the download whenever data/build/philippines-latest.osm.pbf already exists,
 * so a repeat `--region ph` build is offline; only a missing download is
 * fetched. NCR keeps today's behaviour (download unless --skip-download). The
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
const downloadFlag =
  argv.includes('--skip-download') || argv.includes('--publish-only');
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
  ncr: {
    pbf: join(buildDir, 'osm', 'ncr.osm.pbf'),
    publishDir: buildDir,
    // null: landmark resolution reuses the main --pbf extract, so the NCR
    // publish command and its feed bytes are unchanged.
    landmarksPbf: null,
    // null: the image's default MOTIS config (/etc/motis/config.yml).
    routingConfig: null,
  },
  ph: {
    pbf: join(buildDir, 'osm', 'ph.osm.pbf'),
    // Ruling R6: publish writes <out>/gtfs/gtfs.zip, <out>/manifest.json,
    // <out>/build-report.json and <out>/coverage-regional.json, so the national
    // root stays data/build/gtfs/ph (the NCR root stays data/build/gtfs).
    publishDir: join(buildDir, 'gtfs', 'ph'),
    // Ruling R17: the curated inventory is NCR-only, so the national build
    // resolves its terminals against the NCR clip instead of running a
    // locations=True pass over the 612 MB national extract.
    landmarksPbf: join(buildDir, 'osm', 'ncr.osm.pbf'),
    // Selected through the compose env override; see the next-step text below.
    routingConfig: '/etc/motis/config.ph.yml',
  },
};
// Own-property check: `REGION_TARGETS[region]` would also find inherited names
// such as `constructor`, then crash on `target.publishDir` instead of failing
// with the clean unknown-region error.
if (!Object.hasOwn(REGION_TARGETS, region)) {
  console.error(
    `data:build: unknown --region ${region}; accepted regions: ${Object.keys(REGION_TARGETS).join(', ')}`,
  );
  process.exit(1);
}
const target = REGION_TARGETS[region];

// `--region ph` builds from the national extract that is already on disk: the
// download *is* the national input, so a repeat build must not pull another
// 612 MB. A missing download still falls through to the download stage below
// (or to the --skip-download error), and NCR keeps today's behaviour.
const skipDownload = downloadFlag || (region === 'ph' && existsSync(downloadDest));

const feedPath = join(target.publishDir, 'gtfs', 'gtfs.zip');
const manifestPath = join(target.publishDir, 'manifest.json');

// The routing service must be recreated after a build because MOTIS imports the
// graph at startup. Both the label and the env override come from the region
// target, so a new region cannot silently print the NCR command.
const ROUTING_SERVICE = 'routing';
const ROUTING_CONFIG_ENV = 'BIYAHEY_ROUTING_CONFIG';

function nextStepLines(regionTarget) {
  const recreate = `docker compose up -d --force-recreate --wait ${ROUTING_SERVICE}`;
  const national = regionTarget.routingConfig !== null;
  const lines = [
    `MOTIS only serves ${national ? 'the national feed' : 'the new feed'} after a container recreate:`,
  ];
  if (national) {
    lines.push(
      `  PowerShell:  $env:${ROUTING_CONFIG_ENV}='${regionTarget.routingConfig}'; ${recreate}`,
      `  POSIX:       ${ROUTING_CONFIG_ENV}=${regionTarget.routingConfig} ${recreate}`,
      `  feed:        ${feedPath}`,
    );
  } else {
    lines.push(`  ${recreate}`);
  }
  lines.push('Then re-run the acceptance live suites:', '  npm run test:integration');
  return lines;
}

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
  let reason = `--region ${region} reuses the national extract`;
  if (argv.includes('--skip-download')) {
    reason = '--skip-download';
  } else if (publishOnly) {
    reason = '--publish-only';
  }
  console.log(`data:build: skipping download (${reason}; using ${downloadDest})`);
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

// Ruling R17: a national publish must not silently fall back to landmark
// resolution on the national extract. Fail here with the reason before the
// stage starts; the pipeline also fails loudly (exit 2) if the file disappears.
if (target.landmarksPbf !== null && !existsSync(target.landmarksPbf)) {
  console.error(
    `data:build: --region ${region} needs the NCR clip ${target.landmarksPbf} ` +
      'for curated landmark resolution (the inventory is NCR-only). ' +
      'Build it with `npm run data:build -- --region ncr` (or the osm stage) first.',
  );
  process.exit(1);
}

const publishArgs = [
  '-m',
  'pipeline.cli',
  'publish',
  '--pbf',
  target.pbf,
  '--out',
  target.publishDir,
  '--aliases',
  aliases,
];
if (target.landmarksPbf !== null) {
  publishArgs.push('--landmarks-pbf', target.landmarksPbf);
}

runStage(
  'publish GTFS + fares + manifest + report + regional coverage (offline)',
  publishArgs,
);

console.log(`
data:build: done (region ${region})
  feed      ${feedPath}
  manifest  ${manifestPath}
  report    ${join(target.publishDir, 'build-report.json')}
  coverage  ${join(target.publishDir, 'coverage-regional.json')}
${
  target.landmarksPbf !== null
    ? `  landmarks ${target.landmarksPbf}\n`
    : ''
}
${nextStepLines(target).join('\n')}
`);
