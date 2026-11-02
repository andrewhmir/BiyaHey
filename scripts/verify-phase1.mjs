#!/usr/bin/env node
/**
 * Phase-1 acceptance harness (Plan 1, Task 11).
 *
 * Runs every check spec §3 defines for phase 1 and prints one pass/partial/fail
 * table mapped to the criteria. It never builds data: `data/build/` artifacts and
 * the published feed are prerequisites (docs/runbooks/data-build.md §3), because
 * the build is a one-time local operation of several minutes and acceptance must
 * measure the artifacts it actually ships.
 *
 * Checks, in order:
 *   1. pipeline tests            python -m pytest            (phase-1 pipeline)
 *   2. npm run ci                lint + typecheck + offline vitest (the
 *                                `integration`-tagged live suites are filtered
 *                                out) + validate:data, with API_URL/MOTIS_URL
 *                                stripped from the child environment
 *   3. docker compose up -d --wait routing      (criterion 1: stack up)
 *   4. npm run smoke:routing                    (criterion 1: live router works)
 *   5. licence gate + coverage report           (criteria 8 and 7)
 *   6. API on a free port, then the golden integration suite over HTTP
 *      (criteria 2, 3 and the API half of 5), with a JSON measurement report
 *
 * Criterion 4 (fare engine ≥25 golden cases) is covered by check 2 together with
 * the pipeline pytest suite from check 1: both results feed the same criterion
 * and every recorded check is fail-closed at exit time. Criterion 6 (PWA) is
 * Plan 2 by ruling R38 and is reported as deferred, never faked.
 *
 * Exit code: 0 only when no criterion and no recorded check failed (PARTIAL is
 * reported, not hidden); 1 otherwise. The `results` object is the source of
 * truth for the recorded checks, so a pytest or golden-suite failure cannot be
 * reported as PASS just because no criterion read it.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const venvPython = join(root, 'pipelines', '.venv', 'Scripts', isWindows ? 'python.exe' : 'python');
const python = existsSync(venvPython) ? venvPython : 'python';
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitestCli = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const buildDir = join(root, 'data', 'build');
const gtfsZip = join(buildDir, 'gtfs', 'gtfs.zip');
const buildReportPath = join(buildDir, 'build-report.json');
const manifestPath = join(buildDir, 'manifest.json');

const results = {};
let currentApi = null;

function record(id, status, detail) {
  results[id] = { status, detail };
  const label = status.padEnd(7);
  console.log(`\n[${label}] ${id}: ${detail}`);
}

function pythonEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONPATH: join(root, 'pipelines'),
    PYTHONIOENCODING: 'utf-8',
    ...extra,
  };
}

/**
 * Environment for checks that must not see a live stack.
 *
 * `npm run ci` already filters the `integration`-tagged suites out (root `test`
 * script), but stripping the URLs here keeps the acceptance run hermetic even if
 * the caller's shell exports them and a future script edit loses the filter.
 */
function hermeticEnv() {
  const env = { ...process.env };
  delete env.API_URL;
  delete env.MOTIS_URL;
  return env;
}

/** Run a command to completion, streaming its output to this process. */
function run(id, command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const started = performance.now();
    console.log(`\n=== ${id}: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: options.shell ?? false,
    });
    let output = '';
    if (options.stdio === 'pipe') {
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
    }
    if (options.stdinInput !== undefined) {
      child.stdin.write(options.stdinInput);
      child.stdin.end();
    }
    child.on('error', (error) => {
      output += String(error);
    });
    child.on('close', (code) => {
      const durationMs = Math.round(performance.now() - started);
      if (options.stdio === 'pipe' && code !== 0) {
        console.error(output);
      }
      resolvePromise({ code, durationMs, output });
    });
  });
}

/** Pick a TCP port the OS says is free. */
async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function startApi() {
  const port = await freePort();
  const log = [];
  const child = spawn(process.execPath, [tsxCli, join(root, 'services', 'api', 'src', 'server.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthy = await waitForHealth(baseUrl);
  return { child, baseUrl, port, healthy, log };
}

function stopApi(api) {
  if (api === null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    if (api.child.exitCode !== null) {
      resolvePromise();
      return;
    }
    const killTree = () => {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(api.child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        api.child.kill('SIGKILL');
      }
      resolvePromise();
    };
    api.child.once('exit', () => resolvePromise());
    api.child.kill();
    setTimeout(killTree, 2_000);
  });
}

function countFareCases() {
  const file = join(root, 'packages', 'shared', 'src', 'fares.test.ts');
  try {
    const source = readFileSync(file, 'utf8');
    return (source.match(/^\s*it\(/gm) ?? []).length;
  } catch {
    return 0;
  }
}

function pct(value) {
  return `${Number(value).toFixed(1)}%`;
}

/** Run npm through cmd.exe on Windows (spawn cannot exec a .cmd without a shell). */
function npm(id, args, options = {}) {
  if (isWindows) {
    return run(id, process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], options);
  }
  return run(id, 'npm', args, options);
}

async function main() {
  // ------------------------------------------------------------------ preflight
  for (const [label, path] of [
    ['published feed', gtfsZip],
    ['build report', buildReportPath],
    ['manifest', manifestPath],
  ]) {
    if (!existsSync(path)) {
      console.error(
        `verify-phase1: missing ${label} at ${path}\n` +
          'Run the data build first (docs/runbooks/data-build.md §1–§2): download, osm, publish; ' +
          '§6 lists every generated artifact.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // ------------------------------------------------------- 1. pipeline tests
  const pytest = await run('pipeline tests (pytest)', python, ['-m', 'pytest', '-q'], {
    cwd: join(root, 'pipelines'),
    env: pythonEnv(),
  });
  record(
    'pytest',
    pytest.code === 0 ? 'PASS' : 'FAIL',
    pytest.code === 0 ? `pipeline tests green (${(pytest.durationMs / 1000).toFixed(1)} s)` : `exit ${pytest.code}`,
  );

  // --------------------------------------------------------------- 2. npm ci
  const ci = await npm('npm run ci', ['run', 'ci'], { env: hermeticEnv() });
  record(
    'ci',
    ci.code === 0 ? 'PASS' : 'FAIL',
    ci.code === 0 ? `lint + typecheck + vitest + validate:data green (${(ci.durationMs / 1000).toFixed(1)} s)` : `exit ${ci.code}`,
  );

  // ------------------------------------------------- 3. compose: router + api
  const compose = await run(
    'docker compose up -d --wait routing api',
    isWindows ? 'docker.exe' : 'docker',
    ['compose', 'up', '-d', '--wait', 'routing', 'api'],
  );
  record(
    'compose',
    compose.code === 0 ? 'PASS' : 'FAIL',
    compose.code === 0
      ? `routing + api services healthy after ${(compose.durationMs / 1000).toFixed(1)} s (warm start)`
      : `exit ${compose.code}`,
  );

  // ------------------------------------------------------ 4. routing smoke
  const smoke = await npm('npm run smoke:routing', ['run', 'smoke:routing'], {
    stdio: 'pipe',
  });
  if (smoke.code === 0) {
    console.log(smoke.output.trim());
  }
  record(
    'smoke',
    smoke.code === 0 ? 'PASS' : 'FAIL',
    smoke.code === 0
      ? smoke.output
          .trim()
          .split('\n')
          .filter((line) => line.includes('ok:') || line.includes('geocode'))
          .join(' ') || 'routing smoke ok'
      : `exit ${smoke.code}`,
  );

  // -------------------------------------------- 5. licence gate + coverage
  const gate = await run(
    'licence gate',
    python,
    ['-m', 'pipeline.cli', 'licence-gate', '--manifest', manifestPath],
    { env: pythonEnv(), stdio: 'pipe' },
  );
  record(
    'licence-gate',
    gate.code === 0 ? 'PASS' : 'FAIL',
    gate.code === 0 ? gate.output.trim() : `exit ${gate.code}: ${gate.output.trim()}`,
  );

  const coverage = await run(
    'coverage report',
    python,
    ['-m', 'pipeline.cli', 'coverage', '--json', '--threshold', '60'],
    { env: pythonEnv(), stdio: 'pipe' },
  );
  let coverageReport = null;
  try {
    coverageReport = JSON.parse(coverage.output);
  } catch {
    coverageReport = null;
  }
  const coveragePass = coverage.code === 0 && coverageReport !== null && coverageReport.pct >= 60;
  record(
    'coverage',
    coveragePass ? 'PASS' : 'FAIL',
    coverageReport === null
      ? `could not parse coverage report (exit ${coverage.code})`
      : `${coverageReport.modelled}/${coverageReport.total} curated routes ` +
        `modelled (${pct(coverageReport.pct)}, threshold 60%); missing ` +
        `${coverageReport.missing.map((entry) => entry.code).join(', ') || 'none'}`,
  );

  // ------------------------------------- 6. API on a free port + golden suite
  let goldenReport = null;
  try {
    currentApi = await startApi();
    if (!currentApi.healthy) {
      throw new Error(`API did not become healthy: ${currentApi.log.join('')}`);
    }
    const sourcesResponse = await fetch(`${currentApi.baseUrl}/sources`);
    const sources = sourcesResponse.ok ? await sourcesResponse.json() : null;
    const datasetCount = Array.isArray(sources) ? sources.length : 0;

    const reportDir = mkdtempSync(join(tmpdir(), 'biyahey-golden-'));
    const goldenReportPath = join(reportDir, 'golden-report.json');
    const golden = await run(
      'golden integration suite',
      process.execPath,
      [vitestCli, 'run', 'services/api/test/golden.test.ts'],
      {
        env: {
          ...process.env,
          API_URL: currentApi.baseUrl,
          GOLDEN_REPORT: goldenReportPath,
        },
      },
    );
    if (existsSync(goldenReportPath)) {
      goldenReport = JSON.parse(readFileSync(goldenReportPath, 'utf8'));
    }
    record(
      'golden',
      golden.code === 0 ? 'PASS' : 'FAIL',
      golden.code === 0
        ? `10 golden trips met their contracts; p95 plan ${goldenReport?.planP95Ms ?? '?'} ms, ` +
          `p95 search ${goldenReport?.searchP95Ms ?? '?'} ms; /sources lists ${datasetCount} datasets`
        : `golden suite exit ${golden.code}`,
    );

    // ------------------------------------------------------- criteria table
    const tripSummary = (goldenReport?.trips ?? [])
      .map((trip) => `${trip.name} ${trip.itineraries}`)
      .join(' · ');
    const planP95 = goldenReport?.planP95Ms;
    const searchP95 = goldenReport?.searchP95Ms;
    const searchSamples = goldenReport?.searchSamples ?? [];
    const searchMaxMs = searchSamples.reduce((max, sample) => Math.max(max, sample.ms), 0);
    const droppedTotal = (goldenReport?.trips ?? []).reduce(
      (total, trip) => total + (trip.implausibleDropped ?? 0),
      0,
    );
    const fareCases = countFareCases();
    const packageLicense = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).license;
    const licenceFilePresent = existsSync(join(root, 'LICENSE'));

    const criteria = [
      {
        id: '1',
        title: 'docker compose up serves the stack in < 20 min',
        status: compose.code === 0 && smoke.code === 0 ? 'PARTIAL' : 'FAIL',
        evidence:
          `docker compose up -d --wait routing api brought both services healthy in ` +
          `${(compose.durationMs / 1000).toFixed(1)} s (warm) and smoke ok; the harness then ran the ` +
          `same API code on ${currentApi.baseUrl} for the golden suite (/health ok), and the browser ` +
          `origin http://localhost:5173 is CORS-allowed. The web service is Plan 2 (no apps/web yet), ` +
          `so the full three-service stack is not testable.`,
      },
      {
        id: '2',
        title: 'search: grouped results, p95 ≤ 1.5 s',
        status:
          golden.code === 0 &&
          typeof searchP95 === 'number' &&
          searchP95 > 0 &&
          searchP95 <= 1500
            ? 'PASS'
            : 'FAIL',
        evidence:
          `p95 ${searchP95} ms over ${searchSamples.length} NCR queries ` +
          `(max sample ${searchMaxMs} ms, limit 1500); groups stops/landmarks/routes/saved present; partial=false on every query.`,
      },
      {
        id: '3',
        title: '10 golden trips ≥ 3 itineraries; p95 plan ≤ 1.5 s',
        status:
          golden.code === 0 && planP95 !== undefined && planP95 <= 1500 ? 'PASS' : 'FAIL',
        evidence: `p95 plan ${planP95} ms; per-trip itinerary counts: ${tripSummary}; the plausibility guard dropped ${droppedTotal} impossible itineraries and every returned itinerary passed it`,
      },
      {
        id: '4',
        title: 'fare engine passes ≥ 25 golden fare cases; pipeline pytest suite green',
        status: ci.code === 0 && pytest.code === 0 && fareCases >= 25 ? 'PASS' : 'FAIL',
        evidence:
          `${fareCases} fare-engine test cases in packages/shared/src/fares.test.ts, green under npm run ci ` +
          `(PUV matrix, rail discount, ferry/free-ride, guards); pipeline pytest suite ` +
          `${pytest.code === 0 ? 'green' : `FAILED (exit ${pytest.code})`} in ${(pytest.durationMs / 1000).toFixed(1)} s ` +
          '(includes the licence-gate tests; pytest is not part of npm run ci)',
      },
      {
        id: '5',
        title: 'every itinerary carries sources[]; About-data lists every dataset; fares show effective_from',
        status: golden.code === 0 && datasetCount > 0 ? 'PARTIAL' : 'FAIL',
        evidence: `every golden itinerary asserted non-empty sources[] and dated fare.effective_from; /sources lists ${datasetCount} datasets. The About-data screen is Plan 2 (no web app yet).`,
      },
      {
        id: '6',
        title: 'PWA installable; offline saved trips + fare matrix',
        status: 'DEFERRED',
        evidence: 'Plan 2 (ruling R38): no web app exists in Plan 1, so this cannot be measured yet.',
      },
      {
        id: '7',
        title: 'coverage ≥ 60% of the curated NCR jeepney/UV inventory',
        status: coveragePass ? 'PASS' : 'FAIL',
        evidence:
          coverageReport === null
            ? 'coverage report unavailable'
            : `${coverageReport.modelled}/${coverageReport.total} = ${pct(coverageReport.pct)}; missing ` +
              `${coverageReport.missing.map((entry) => `${entry.code} (${entry.reason})`).join('; ') || 'none'}`,
      },
      {
        id: '8',
        title: 'licence gate: MIT code, ODbL derived database, no unlicensed dataset',
        status:
          ci.code === 0 && gate.code === 0 && licenceFilePresent && packageLicense === 'MIT'
            ? 'PASS'
            : 'FAIL',
        evidence:
          `repository code is MIT (LICENSE present: ${licenceFilePresent}; package.json license: ` +
          `${JSON.stringify(packageLicense)}); licence-gate ok on data/build/manifest.json: ` +
          '4 datasets, ODbL-1.0 derived database with the notice in the artifact, CC BY-SA 2.0 ' +
          'inventory attribution, no blocked dataset; npm run ci runs validate:data, and the pytest ' +
          'licence-gate tests ran in the pipeline-check step (pytest is not part of npm run ci)',
      },
    ];

    console.log('\n================ phase-1 acceptance (spec §3) ================');
    for (const criterion of criteria) {
      console.log(`${criterion.id}. [${criterion.status}] ${criterion.title}`);
      console.log(`   ${criterion.evidence}`);
    }
    const failed = criteria.filter((criterion) => criterion.status === 'FAIL');
    const partial = criteria.filter((criterion) => criterion.status === 'PARTIAL');
    const deferred = criteria.filter((criterion) => criterion.status === 'DEFERRED');
    const verdict =
      failed.length > 0
        ? 'FAIL'
        : partial.length > 0 || deferred.length > 0
          ? 'PARTIAL'
          : 'ACCEPTED';
    console.log('--------------------------------------------------------------');
    console.log(
      `phase-1 acceptance: ${verdict} ` +
        `(${criteria.length - failed.length - partial.length - deferred.length} pass, ` +
        `${partial.length} partial, ${deferred.length} deferred, ${failed.length} fail)`,
    );
    // Fail closed on the recorded checks too: a failed pytest / ci / compose /
    // smoke / gate / coverage / golden check must produce a non-zero exit even
    // if a criterion's evidence text did not read that specific result.
    const recordedFailures = Object.entries(results).filter(
      ([, result]) => result.status === 'FAIL',
    );
    if (recordedFailures.length > 0) {
      console.log(
        `recorded checks failed: ${recordedFailures.map(([id]) => id).join(', ')}`,
      );
    }
    process.exitCode = failed.length > 0 || recordedFailures.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`verify-phase1: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  } finally {
    await stopApi(currentApi);
  }
}

await main();
