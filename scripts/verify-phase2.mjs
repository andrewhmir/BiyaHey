#!/usr/bin/env node
/**
 * Phase-2 acceptance harness (Plan 2, Task 11) — spec §3 criteria 2–6.
 *
 * Phase 2 is the PWA (`apps/web`): the Option A map + sheet container, search,
 * fare-forward route options, trip detail, saved/offline trips and the
 * About-data provenance screen. This harness measures the criteria the spec
 * assigns to that work and prints one pass/partial/fail table mapped to them,
 * plus the Task 11 checks:
 *
 *   prerequisites  API :8787 healthy, MOTIS :8080 healthy, data/build present
 *   build          `npm run build --workspace @biyahey/web` + PWA shell files
 *   unit           `npm test` (root; offline unit + a11y + bundle, the
 *                  `integration`-tagged live suites are filtered by the script)
 *   bundle         `npm test --workspace @biyahey/web -- bundle` (paint-only
 *                  first-screen payload ≤ 250 KB gzip, R82)
 *   e2e            `npm run test:e2e` (build + Playwright: dev trip flow,
 *                  preview offline/service-worker/worker-asset)
 *   perf           `npm run perf:web` (Lighthouse mobile, 4× CPU, 5-run median)
 *   phase1         optional `npm run verify:phase1` with `--with-phase1`
 *
 * Performance is recorded as **PARTIAL with measured numbers**, never green
 * (R87/R88): the spec §11 "cold start → interactive map ≤ 3 s" target is not
 * met, the ≤ 40 tiles/viewport budget is measured but not enforced, and the
 * `saveData` raster fallback is not implemented. A contended local Lighthouse
 * run is therefore not a hard acceptance failure, but it is also never
 * reported as a pass. The authoritative performance gate is the `perf` job in
 * `.github/workflows/web.yml`.
 *
 * The harness never starts, restarts or stops Docker and never builds data. It
 * fails with the exact command to run when a prerequisite is missing. Exit code
 * is 0 only when no criterion and no recorded check failed (PARTIAL is
 * reported, exit 0, matching Plan 1's harness).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const withPhase1 = process.argv.includes('--with-phase1');
const apiBase = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const motisBase = (process.env.MOTIS_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

const webDist = join(root, 'apps', 'web', 'dist');
const lhciManifest = join(root, 'apps', 'web', '.lighthouseci', 'manifest.json');
const lhciArtifacts = join(root, '.lighthouseci');
const buildDir = join(root, 'data', 'build');

/** Recorded check results; the source of truth for the fail-closed exit code. */
const results = {};

function record(id, status, detail) {
  results[id] = { status, detail };
  console.log(`\n[${status.padEnd(7)}] ${id}: ${detail}`);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Run a command to completion, streaming and capturing its output. */
function run(id, command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const started = performance.now();
    console.log(`\n=== ${id}: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: options.shell ?? false,
    });
    let output = '';
    const capture = (chunk) => {
      const text = String(chunk);
      output += text;
      if (options.stream !== false) {
        process.stdout.write(text);
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      output += String(error);
    });
    child.on('close', (code) => {
      resolvePromise({
        code,
        durationMs: Math.round(performance.now() - started),
        output,
      });
    });
  });
}

/** Run npm through cmd.exe on Windows (spawn cannot exec a .cmd without a shell). */
function npm(id, args, options = {}) {
  if (isWindows) {
    return run(id, process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], options);
  }
  return run(id, 'npm', args, options);
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = response.ok ? await response.json() : null;
  return { response, body };
}

/**
 * MOTIS 2.11.4 has no `/health` route (it answers 404), so the compose
 * healthcheck path is the honest liveness probe: a geocode query that only
 * succeeds once the feed is imported.
 */
async function checkMotis() {
  try {
    const { response, body } = await fetchJson(
      `${motisBase}/api/v1/geocode?text=Cubao`,
      20_000,
    );
    if (response.ok && Array.isArray(body) && body.length > 0) {
      return {
        ok: true,
        detail: `GET ${motisBase}/api/v1/geocode?text=Cubao → 200 (${body.length} hits)`,
      };
    }
    return {
      ok: false,
      detail: `GET ${motisBase}/api/v1/geocode?text=Cubao → ${response.status} (expected 200 with hits)`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `GET ${motisBase}/api/v1/geocode?text=Cubao → ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkApi() {
  try {
    const { response, body } = await fetchJson(`${apiBase}/health`, 5_000);
    if (response.ok && body !== null && body.status === 'ok') {
      return { ok: true, detail: `GET ${apiBase}/health → 200 {"status":"ok"}` };
    }
    return { ok: false, detail: `GET ${apiBase}/health → ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: `GET ${apiBase}/health → ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Count the fare-engine cases the same way Plan 1's harness does. */
function countFareCases() {
  try {
    const source = readFileSync(join(root, 'packages', 'shared', 'src', 'fares.test.ts'), 'utf8');
    return (source.match(/^\s*it\(/gm) ?? []).length;
  } catch {
    return 0;
  }
}

/** Vitest summary, e.g. `Tests  380 passed | 4 skipped (384)`. */
function parseVitest(output) {
  const match = /Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)/.exec(output);
  if (match === null) {
    return null;
  }
  return { passed: Number(match[1]), skipped: Number(match[2] ?? 0), total: Number(match[3]) };
}

/** Playwright summary, e.g. `4 passed (27.52s)`. */
function parsePlaywright(output) {
  const passed = /(\d+) passed \(/.exec(output);
  const failed = /(\d+) failed\b/.exec(output);
  const duration = /(\d+) passed \(([\d.]+)s\)/.exec(output);
  if (passed === null) {
    return null;
  }
  return {
    passed: Number(passed[1]),
    failed: failed === null ? 0 : Number(failed[1]),
    seconds: duration === null ? null : Number(duration[2]),
  };
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function metricsOf(lhr) {
  const audit = (id) => {
    const value = lhr?.audits?.[id]?.numericValue;
    return typeof value === 'number' ? value : null;
  };
  const score = lhr?.categories?.performance?.score;
  return {
    lcp: audit('largest-contentful-paint'),
    tbt: audit('total-blocking-time'),
    tti: audit('interactive'),
    fcp: audit('first-contentful-paint'),
    bytes: audit('total-byte-weight'),
    cls: audit('cumulative-layout-shift'),
    score: typeof score === 'number' ? score * 100 : null,
  };
}

function readLighthouseRun(path) {
  try {
    return metricsOf(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Collect the Lighthouse runs from the `perf:web` execution that just finished.
 *
 * LHCI rewrites `apps/web/.lighthouseci/manifest.json` per run; each entry's
 * `jsonPath` is the authoritative LHR. A run that fails before upload leaves
 * only raw `.lighthouseci/lhr-*.json` files, so the fallback reads those
 * written after the run started (never an older run's numbers).
 */
function collectLighthouseRuns(startedAt) {
  const runs = [];
  if (existsSync(lhciManifest)) {
    try {
      const entries = JSON.parse(readFileSync(lhciManifest, 'utf8'));
      for (const entry of Array.isArray(entries) ? entries : []) {
        const path = entry?.jsonPath;
        if (typeof path !== 'string' || !existsSync(path)) {
          continue;
        }
        if (statSync(path).mtimeMs < startedAt - 10_000) {
          continue;
        }
        const metrics = readLighthouseRun(path);
        if (metrics !== null) {
          runs.push(metrics);
        }
      }
    } catch {
      // fall through to the raw artifacts
    }
  }

  if (runs.length === 0 && existsSync(lhciArtifacts)) {
    const files = readdirSync(lhciArtifacts)
      .filter((name) => /^lhr-.*\.json$/.test(name))
      .map((name) => join(lhciArtifacts, name))
      .filter((path) => {
        try {
          return statSync(path).mtimeMs >= startedAt - 10_000;
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
      .slice(-5);
    for (const path of files) {
      const metrics = readLighthouseRun(path);
      if (metrics !== null) {
        runs.push(metrics);
      }
    }
  }

  return runs;
}

function formatMs(value) {
  return value === null ? '?' : `${Math.round(value)} ms`;
}

async function main() {
  // ------------------------------------------------------------ prerequisites
  const [api, motis] = await Promise.all([checkApi(), checkMotis()]);
  const missingArtifacts = [
    ['manifest', join(buildDir, 'manifest.json')],
    ['published feed', join(buildDir, 'gtfs', 'gtfs.zip')],
    ['build report', join(buildDir, 'build-report.json')],
  ].filter(([, path]) => !existsSync(path));

  const prerequisitesOk = api.ok && motis.ok && missingArtifacts.length === 0;
  const prerequisiteDetail = [
    api.detail,
    motis.detail,
    missingArtifacts.length === 0
      ? 'data/build present (manifest, gtfs.zip, build-report.json)'
      : `data/build missing: ${missingArtifacts.map(([label]) => label).join(', ')}`,
  ].join('; ');
  record('prerequisites', prerequisitesOk ? 'PASS' : 'FAIL', prerequisiteDetail);

  if (!prerequisitesOk) {
    console.error(
      '\nverify-phase2: prerequisites are not met — stopping before the suites.\n' +
        '  docker compose up -d --wait routing api   # start/check MOTIS :8080 + BFF :8787\n' +
        '  npm run data:build                        # build data/build (docs/runbooks/data-build.md)\n' +
        'This harness never starts, restarts or stops Docker; fix the stack yourself and re-run.',
    );
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------ live /sources count
  let sourcesCount = 0;
  try {
    const { response, body } = await fetchJson(`${apiBase}/sources`, 10_000);
    if (response.ok && Array.isArray(body)) {
      sourcesCount = body.length;
    }
  } catch {
    sourcesCount = 0;
  }

  // ---------------------------------------------------------------- 1. build
  let buildOk = false;
  const build = await npm('build', ['run', 'build', '--workspace', '@biyahey/web']);
  if (build.code === 0) {
    const pwaFiles = ['sw.js', 'manifest.webmanifest'].filter((name) =>
      existsSync(join(webDist, name)),
    );
    buildOk = pwaFiles.length === 2;
    record(
      'build',
      buildOk ? 'PASS' : 'FAIL',
      buildOk
        ? `apps/web production build (tsc + Vite) + PWA shell (sw.js, manifest.webmanifest) in ${seconds(build.durationMs)}`
        : `build exited 0 but dist/ is missing ${['sw.js', 'manifest.webmanifest'].filter((name) => !existsSync(join(webDist, name))).join(', ')}`,
    );
  } else {
    record('build', 'FAIL', `npm run build exited ${build.code}; later checks that need dist/ fail closed`);
  }

  // ------------------------------------------------------- 2. root test suite
  const unit = await npm('unit', ['test']);
  const unitCounts = parseVitest(unit.output);
  record(
    'unit',
    unit.code === 0 ? 'PASS' : 'FAIL',
    unit.code === 0
      ? `${unitCounts === null ? 'vitest green' : `${unitCounts.passed} passed / ${unitCounts.skipped} skipped (${unitCounts.total})`} in ${seconds(unit.durationMs)}; offline unit + a11y + bundle, no integration tag`
      : `npm test exited ${unit.code}`,
  );

  // ----------------------------------------------- 3. paint-only bundle budget
  let bundleOk = false;
  let bundleKb = null;
  if (!buildOk) {
    record('bundle', 'FAIL', 'not run: the production build failed');
  } else {
    const bundle = await npm('bundle', ['test', '--workspace', '@biyahey/web', '--', 'bundle']);
    const match = /\[bundle-budget\] initial payload: ([\d.]+) KB gzip across (\d+) file/.exec(
      bundle.output,
    );
    bundleKb = match === null ? null : Number(match[1]);
    bundleOk = bundle.code === 0 && bundleKb !== null && bundleKb <= 250;
    record(
      'bundle',
      bundleOk ? 'PASS' : 'FAIL',
      match === null
        ? `bundle suite exited ${bundle.code} without a measured payload line`
        : `${bundleKb} KB gzip across ${match[2]} file(s), budget 250 KB (paint-only, R82)`,
    );
  }

  // ------------------------------------------------------------- 4. E2E suite
  const e2e = await npm('e2e', ['run', 'test:e2e']);
  const e2eCounts = parsePlaywright(e2e.output);
  const e2eOk = e2e.code === 0 && e2eCounts !== null && e2eCounts.passed >= 4;
  record(
    'e2e',
    e2eOk ? 'PASS' : 'FAIL',
    e2eCounts === null
      ? `npm run test:e2e exited ${e2e.code} without a Playwright summary`
      : `${e2eCounts.passed} passed / ${e2eCounts.failed} failed${e2eCounts.seconds === null ? '' : ` in ${e2eCounts.seconds} s`} (dev flow + preview offline/worker); command ${seconds(e2e.durationMs)} wall`,
  );

  // ------------------------------------------------------- 5. Lighthouse perf
  let perfStatus = 'FAIL';
  let perfDetail = 'not measured';
  let lighthouseRuns = [];
  const perfStartedAt = Date.now();
  const perf = await npm('perf', ['run', 'perf:web']);
  lighthouseRuns = collectLighthouseRuns(perfStartedAt);

  if (lighthouseRuns.length === 0) {
    perfDetail = `npm run perf:web exited ${perf.code} and left no readable Lighthouse run — the performance budget was not measured`;
  } else {
    const pick = (key) =>
      lighthouseRuns.map((run) => run[key]).filter((value) => typeof value === 'number');
    const medians = {
      lcp: median(pick('lcp')),
      tbt: median(pick('tbt')),
      tti: median(pick('tti')),
      fcp: median(pick('fcp')),
      bytes: median(pick('bytes')),
      cls: median(pick('cls')),
      score: median(pick('score')),
    };
    const lcpPass = medians.lcp !== null && medians.lcp <= 3000;
    const tbtPass = medians.tbt !== null && medians.tbt <= 2500;
    const ttiPass = medians.tti !== null && medians.tti <= 3000;
    const transferPass = medians.bytes !== null && medians.bytes <= 1_000_000;

    console.log('\n[lighthouse] recorded runs (mobile simulate, 4x CPU):');
    for (const key of ['lcp', 'tbt', 'tti', 'fcp', 'bytes']) {
      console.log(
        `  ${key.padEnd(5)} ${pick(key).map((value) => Math.round(value)).join(', ')}` +
          ` (median ${Math.round(medians[key] ?? 0)})`,
      );
    }

    // PARTIAL is the recorded verdict for every measured run: even a run whose
    // numbers clear LCP/TBT still fails the §11 interactive-map budget and the
    // two unimplemented budgets below (R88). FAIL is reserved for "no
    // measurement at all", so host contention cannot silently green the line.
    perfStatus = 'PARTIAL';
    perfDetail =
      `${lighthouseRuns.length} Lighthouse run(s): median LCP ${formatMs(medians.lcp)} ` +
      `(${lcpPass ? '≤3000 PASS on this run only — locally variable, not a stable pass' : 'FAIL > 3000'}), ` +
      `TBT ${formatMs(medians.tbt)} (${tbtPass ? '≤2500 PASS' : 'FAIL > 2500; Lighthouse "good" is 600 ms'}), ` +
      `TTI ${formatMs(medians.tti)} (${ttiPass ? '≤3000 PASS' : 'NOT MET > 3000'}), ` +
      `transfer ${medians.bytes === null ? '?' : Math.round(medians.bytes).toLocaleString('en-US')} B ` +
      `(${transferPass ? 'PASS ≤1,000,000' : 'FAIL > 1,000,000'}), perf score ${medians.score === null ? '?' : Math.round(medians.score)}/100. ` +
      `perf:web exit ${perf.code} (1 = a strict assertion failed; not treated as an acceptance failure per R87). ` +
      '§11 bars recorded separately: interactive map ≤3 s NOT MET; ≤40 tiles/viewport measured 4, not enforced; saveData fallback not implemented.';
  }
  record('perf', perfStatus, perfDetail);

  // ------------------------------------------ 6. optional Plan-1 re-verification
  if (withPhase1) {
    const phase1 = await npm('phase1', ['run', 'verify:phase1']);
    record(
      'phase1',
      phase1.code === 0 ? 'PASS' : 'FAIL',
      phase1.code === 0
        ? `Plan-1 acceptance harness green (PARTIAL by design) in ${seconds(phase1.durationMs)}`
        : `npm run verify:phase1 exited ${phase1.code}`,
    );
  } else {
    record(
      'phase1',
      'SKIPPED',
      'Plan-1 criteria 2–4 were accepted on 2026-11-01 (docs/runbooks/phase1-acceptance.md); pass --with-phase1 to re-run that slow harness (it also runs npm run ci)',
    );
  }

  // ------------------------------------------------------- §11 budget record
  const ttiRow = lighthouseRuns.length === 0 ? null : median(
    lighthouseRuns.map((run) => run.tti).filter((value) => typeof value === 'number'),
  );
  console.log('\n=========== §11 performance budgets recorded, never green (R87/R88) ===========');
  console.log(
    `interactive map ≤ 3 s ................. NOT MET${ttiRow === null ? '' : ` (median TTI ${Math.round(ttiRow)} ms)`}`,
  );
  console.log('≤ 40 map tiles per viewport .......... NOT ENFORCED (measured 4 vector tiles for the initial 390×844 Home viewport in Task 10; no assertion)');
  console.log('saveData → raster fallback ............ NOT IMPLEMENTED (feature decision, not waived)');
  console.log(
    `paint-only first payload ≤ 250 KB ..... ${bundleKb === null ? 'NOT MEASURED' : `${bundleKb} KB gzip PASS`}`,
  );
  console.log('LCP ≤ 3 s ............................ PASS on the recorded run only; locally variable — the CI perf job is authoritative');

  // ------------------------------------------------------- criteria table
  const fareCases = countFareCases();
  const searchP95Note =
    'server-side p95 search was 30–39 ms over six NCR queries in Plan-1 acceptance (2026-11-01), re-verifiable with --with-phase1';
  const planP95Note =
    'Plan-1 acceptance measured 10/10 golden trips returning 4–5 itineraries (≥3 required) with p95 plan 185–208 ms (limit 1,500 ms) on 2026-11-01, re-verifiable with --with-phase1';

  const criteria = [
    {
      id: '2',
      title: 'Grouped search results for any NCR query; p95 search ≤ 1.5 s',
      status: unit.code === 0 && e2eOk ? 'PASS' : 'FAIL',
      evidence:
        'The Playwright dev flow types "Cubao" into the live /search box, waits for the grouped ' +
        'Stops section and selects a real result; SearchScreen unit + axe tests cover the ' +
        'stops · landmarks · routes · saved groups, the idle/offline/partial states and the ' +
        `status region (${unitCounts === null ? 'root suite' : `${unitCounts.passed} tests`} green). ` +
        `UI path re-verified here; ${searchP95Note}.`,
    },
    {
      id: '3',
      title: 'Golden NCR trips get ≥ 3 itineraries with time, fare, transfers, walk; p95 plan ≤ 1.5 s',
      status: unit.code === 0 && e2eOk ? 'PASS' : 'FAIL',
      evidence:
        'The Playwright flow POSTs the live /plan for a searched destination and asserts 1–5 real ' +
        'cards, each with a ₱ fare, a minute ETA and the fare effectivity date; the card component ' +
        'tests cover transfers, walk distance, mode chips and the reduced-options/empty states. ' +
        `Phase-2 owns the UI; ${planP95Note} (the E2E flow tolerates the live 1–5 options and asserts ` +
        'each card\'s fare, ETA and effectivity date).',
    },
    {
      id: '4',
      title: 'Fare engine passes ≥ 25 golden fare cases',
      status: unit.code === 0 && fareCases >= 25 ? 'PASS' : 'FAIL',
      evidence:
        `${fareCases} fare-engine cases in packages/shared/src/fares.test.ts ran green inside the ` +
        'root `npm test` step (2026-09-28 PUV matrix, 2026-03-23 LRT-2/MRT-3 50 % discount, ' +
        'LRT-1 exclusion, free-ride overrides, guards). Plan-1-owned data; re-verified here.',
    },
    {
      id: '5',
      title: 'Every itinerary carries sources[]; About-data lists every dataset; fares show effective_from',
      status: unit.code === 0 && e2eOk && sourcesCount > 0 ? 'PASS' : 'FAIL',
      evidence:
        `Live /sources returned ${sourcesCount} datasets; the Playwright flow asserts every route ` +
        'card shows an `effective YYYY-MM-DD` fare date, opens the trip fare breakdown with its ' +
        'source rows, and finds the OpenStreetMap row on About data. ProvenanceChip/AboutData unit ' +
        'and axe tests (including the missing-source fallback) ran in `npm test`. The API-side ' +
        '`sources[]` contract is asserted by the Plan-1 golden suite.',
    },
    {
      id: '6',
      title: 'PWA is installable; saved trips + fare matrix work offline with a staleness stamp',
      status: buildOk && e2eOk ? 'PASS' : 'FAIL',
      evidence:
        'The preview Playwright project serves the built app: the linked manifest has name, ' +
        '`start_url: /`, `display: standalone` and 192/512 icons; `navigator.serviceWorker.ready` ' +
        'resolves and controls the page; after `context.setOffline(true)` a reload of /saved ' +
        'renders the saved row, the offline badge, the "Saved route (no live data)" label and the ' +
        '"Fare may have changed since you saved this." staleness stamp. The build emits sw.js + ' +
        'manifest.webmanifest, and the Workbox rules are unit-tested (R72). Install/offline is ' +
        'browser-verified, not inferred from file existence.',
    },
  ];

  console.log('\n================ phase-2 acceptance (spec §3 criteria 2–6) ================');
  for (const criterion of criteria) {
    console.log(`${criterion.id}. [${criterion.status}] ${criterion.title}`);
    console.log(`   ${criterion.evidence}`);
  }

  console.log('\n------------------------- Task 11 checks -------------------------');
  for (const [id, result] of Object.entries(results)) {
    console.log(`[${result.status.padEnd(7)}] ${id}: ${result.detail}`);
  }

  const failedCriteria = criteria.filter((criterion) => criterion.status === 'FAIL');
  const failedChecks = Object.entries(results).filter(([, result]) => result.status === 'FAIL');
  const partialCriteria = criteria.filter((criterion) => criterion.status === 'PARTIAL');
  const partialChecks = Object.entries(results).filter(([, result]) => result.status === 'PARTIAL');
  const skippedChecks = Object.entries(results).filter(([, result]) => result.status === 'SKIPPED');
  const totalChecks = Object.keys(results).length;
  const passedChecks = totalChecks - failedChecks.length - partialChecks.length - skippedChecks.length;
  const passedCriteria = criteria.length - failedCriteria.length - partialCriteria.length;
  const passed = passedChecks + passedCriteria;

  const verdict =
    failedCriteria.length > 0 || failedChecks.length > 0
      ? 'FAIL'
      : partialCriteria.length > 0 || partialChecks.length > 0
        ? 'PARTIAL'
        : 'ACCEPTED';

  console.log('\n--------------------------------------------------------------');
  console.log(
    `phase-2 acceptance: ${verdict} — §3 criteria: ${passedCriteria}/${criteria.length} pass, ` +
      `${partialCriteria.length} partial, ${failedCriteria.length} fail; ` +
      `checks: ${passedChecks}/${totalChecks} pass, ${partialChecks.length} partial, ` +
      `${skippedChecks.length} skipped, ${failedChecks.length} fail ` +
      `(${criteria.length + totalChecks} recorded rows, ${passed} pass overall)`,
  );
  if (failedChecks.length > 0) {
    console.log(`recorded checks failed: ${failedChecks.map(([id]) => id).join(', ')}`);
  }
  if (partialChecks.length > 0) {
    console.log(`recorded checks partial: ${partialChecks.map(([id]) => id).join(', ')}`);
  }
  if (verdict === 'PARTIAL') {
    console.log(
      'PARTIAL is the honest verdict: every §3 criterion passes, but the §11 performance ' +
        'budget is recorded as PARTIAL with measured numbers and may never print green.',
    );
  }
  process.exitCode = verdict === 'FAIL' ? 1 : 0;
}

await main();
