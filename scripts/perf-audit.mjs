#!/usr/bin/env node
/**
 * Load-performance audit for the BiyaHey! PWA.
 *
 * Drives a real Chromium (Playwright) at a phone viewport, optionally over an
 * emulated slow network, and reports what a rider actually pays to open the
 * app: bytes pulled, request count, paint timings, when the map canvas shows
 * up, which resources are slow, and which external hosts are on the critical
 * path. Use it before/after an optimisation and compare the tables.
 *
 * Usage (from the repository root; the stack must already be running):
 *
 *   node scripts/perf-audit.mjs http://localhost:5173/
 *   node scripts/perf-audit.mjs --runs 3 --throttle tailnet \\
 *     http://127.0.0.1:8099/ https://devvm1.tailf19a1a.ts.net/
 *   node scripts/perf-audit.mjs --warm --throttle tailnet http://127.0.0.1:8099/
 *
 * Options:
 *   --url <url>        a target (repeatable; positional URLs also work)
 *   --label <name>     label for the next URL (default: its host+path)
 *   --runs <n>         cold runs per URL, median reported (default 2)
 *   --throttle <p>     none | tailnet | fast3g | slow3g (default none)
 *   --wait <ms>        settle time after map canvas before reading counters
 *                      (default 2500)
 *   --warm             also measure repeat visits in one persistent context
 *                      with the service worker allowed: the first load
 *                      registers/precaches, then `--warm-runs` repeat
 *                      navigations are measured. `warm network KB` is the real
 *                      wire transfer counted by CDP, so service-worker/cache
 *                      answers show up as ~0; `warm page reqs` is how many
 *                      subresource requests the page made (many can be served
 *                      from cache, hence 0 KB).
 *   --warm-runs <n>    repeat navigations measured in warm mode (default 2)
 *   --json <file>      write full JSON results
 *   --quiet            only print the final tables
 *   --help             print this header
 *
 * Throttle profiles mimic the environments the app is judged in:
 *   tailnet   12 Mbps down, 30 ms RTT  (WireGuard over home/office Wi-Fi)
 *   fast3g    1.6 Mbps down, 150 ms RTT
 *   slow3g    0.4 Mbps down, 400 ms RTT
 *
 * Exits non-zero when a target fails to load or logs an app-origin console
 * error. Numbers are medians of `runs`.
 */
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const CHROME =
  process.env.CHROME_PATH ??
  '/home/sysadmin/.cache/ms-playwright/chromium-1187/chrome-linux/chrome';

const VIEWPORT = { width: 390, height: 844 };
const CANVAS_SELECTOR = '.maplibregl-canvas';
const THROTTLES = {
  none: null,
  tailnet: { latency: 30, downloadThroughput: (12 * 1000 * 1000) / 8, uploadThroughput: (4 * 1000 * 1000) / 8 },
  fast3g: { latency: 150, downloadThroughput: (1.6 * 1000 * 1000) / 8, uploadThroughput: (750 * 1000) / 8 },
  slow3g: { latency: 400, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 },
};

/** Third-party CDN hosts: a blip there is not an app regression (matches e2e guard). */
const EXTERNAL_NOISE = /tiles\.openfreemap\.org|fonts\.(googleapis|gstatic)\.com/;

function parseArgs(argv) {
  const options = {
    runs: 2,
    warm: false,
    warmRuns: 2,
    throttle: 'none',
    wait: 2500,
    json: null,
    quiet: false,
    targets: [],
  };
  let pendingLabel = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    const pushTarget = (url) => {
      options.targets.push({ url, label: pendingLabel, explicitLabel: pendingLabel !== null });
      pendingLabel = null;
    };
    if (arg === '--url') pushTarget(next());
    else if (arg === '--label') pendingLabel = next();
    else if (arg === '--runs') options.runs = Number(next());
    else if (arg === '--throttle') options.throttle = next();
    else if (arg === '--wait') options.wait = Number(next());
    else if (arg === '--warm') options.warm = true;
    else if (arg === '--warm-runs') options.warmRuns = Number(next());
    else if (arg === '--json') options.json = next();
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else pushTarget(arg);
  }
  if (options.help) return options;
  if (options.targets.length === 0) {
    throw new Error('no target URLs given (see --help)');
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error(`--runs must be a positive integer (got ${options.runs})`);
  }
  if (!Number.isInteger(options.warmRuns) || options.warmRuns < 1) {
    throw new Error(`--warm-runs must be a positive integer (got ${options.warmRuns})`);
  }
  if (!(options.throttle in THROTTLES)) {
    throw new Error(`unknown throttle "${options.throttle}" (none|tailnet|fast3g|slow3g)`);
  }
  return options;
}

function labelFor(target) {
  if (target.label !== null) return target.label;
  try {
    const parsed = new URL(target.url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return target.url;
  }
}

/** LCP is only reachable through a buffered PerformanceObserver. */
const LCP_INIT_SCRIPT = () => {
  window.__biyaheyLcp = null;
  try {
    const observer = new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last !== undefined) window.__biyaheyLcp = Math.round(last.startTime);
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // LCP unsupported: leave null
  }
};

/** Resource-timing snapshot of the page's current navigation. */
const READ_METRICS = () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(
    performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)]),
  );
  const lcp = window.__biyaheyLcp === undefined ? null : window.__biyaheyLcp;
  const resources = performance
    .getEntriesByType('resource')
    .filter((entry) => entry.name.startsWith('http'))
    .map((entry) => ({
      name: entry.name,
      type: entry.initiatorType,
      start: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      transfer: entry.transferSize ?? 0,
      decoded: entry.decodedBodySize ?? 0,
    }));
  return {
    paint,
    lcp,
    dcl: nav === undefined ? null : Math.round(nav.domContentLoadedEventEnd),
    loadEvent: nav === undefined ? null : Math.round(nav.loadEventEnd),
    resources,
    domNodes: document.getElementsByTagName('*').length,
  };
};

const READ_LONG_TASKS = () =>
  new Promise((resolve) => {
    const durations = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(Math.round(entry.duration));
      });
      observer.observe({ type: 'longtask', buffered: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(durations);
      }, 1200);
    } catch {
      resolve([]);
    }
  });

/**
 * Records request failures, uncaught page errors and app-origin console errors.
 * Third-party CDN noise (tiles/fonts) is recorded separately so a flaky CDN
 * cannot fail the audit, exactly like apps/web/e2e/helpers/app.ts.
 */
function makeGuard(page, origin) {
  const guard = { failures: [], consoleErrors: [] };
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    if (failure.includes('ERR_ABORTED')) return;
    guard.failures.push(`${request.resourceType()} ${request.url().slice(0, 120)} — ${failure}`);
  });
  page.on('pageerror', (error) => guard.failures.push(`pageerror ${String(error).slice(0, 160)}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text().slice(0, 200);
    const location = message.location().url || '(unknown)';
    const external = EXTERNAL_NOISE.test(text) || EXTERNAL_NOISE.test(location);
    const sameOrigin = location.startsWith(origin) || text.includes(origin);
    const entry = `${location.slice(0, 120)} — ${text}`;
    guard.consoleErrors.push(entry);
    if (sameOrigin && !external) guard.failures.push(`console ${entry}`);
  });
  return guard;
}

async function applyThrottle(client, throttle) {
  const profile = THROTTLES[throttle];
  if (profile === null) return;
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.downloadThroughput,
    uploadThroughput: profile.uploadThroughput,
  });
}

/** One cold-ish navigation: fresh context, no service worker, no HTTP cache. */
async function measureOnce(browser, url, { throttle, wait }) {
  const context = await browser.newContext({
    ...VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(LCP_INIT_SCRIPT);
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await applyThrottle(client, throttle);

  const origin = new URL(url).origin;
  const guard = makeGuard(page, origin);
  const failures = guard.failures;

  const startedAt = Date.now();
  let canvasAt = null;
  let status = null;
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    status = response?.status() ?? null;
    await page.waitForSelector(CANVAS_SELECTOR, { timeout: 60_000 });
    canvasAt = Date.now() - startedAt;
  } catch (error) {
    failures.push(`load ${url}: ${String(error).slice(0, 200)}`);
  }
  await page.waitForTimeout(wait);

  const pageMetrics = await page.evaluate(READ_METRICS).catch(() => ({
    paint: {},
    lcp: null,
    dcl: null,
    loadEvent: null,
    resources: [],
    domNodes: 0,
  }));
  const longTasks = await page.evaluate(READ_LONG_TASKS).catch(() => []);

  const swSupport = await page
    .evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, registrations: 0 };
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return { supported: true, registrations: registrations.length };
      } catch {
        return { supported: true, registrations: null };
      }
    })
    .catch(() => null);

  await context.close();

  const url0 = new URL(url);
  const sameOrigin = (name) => {
    try {
      return new URL(name).origin === url0.origin;
    } catch {
      return false;
    }
  };
  const resources = pageMetrics.resources;
  const transfer = resources.reduce((sum, entry) => sum + entry.transfer, 0);
  const decoded = resources.reduce((sum, entry) => sum + entry.decoded, 0);
  const externalHosts = [
    ...new Set(
      resources
        .filter((entry) => !sameOrigin(entry.name))
        .map((entry) => {
          try {
            return new URL(entry.name).host;
          } catch {
            return '?';
          }
        }),
    ),
  ];
  const byType = {};
  for (const entry of resources) {
    const bucket = (byType[entry.type] ??= { count: 0, transfer: 0, decoded: 0 });
    bucket.count += 1;
    bucket.transfer += entry.transfer;
    bucket.decoded += entry.decoded;
  }

  return {
    url,
    status,
    coldLoadMs: pageMetrics.loadEvent,
    firstPaintMs: pageMetrics.paint['first-paint'] ?? null,
    fcpMs: pageMetrics.paint['first-contentful-paint'] ?? null,
    lcpMs: pageMetrics.lcp,
    mapCanvasMs: canvasAt,
    requestCount: resources.length,
    transferKB: Math.round(transfer / 1024),
    decodedKB: Math.round(decoded / 1024),
    byType,
    externalHosts,
    longTaskCount: longTasks.length,
    longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
    slowest: [...resources]
      .sort((a, b) => b.duration - a.duration || b.decoded - a.decoded)
      .slice(0, 8)
      .map((entry) => ({
        resource: entry.name.replace(url0.origin, '').slice(0, 110),
        durationMs: entry.duration,
        decodedKB: Math.round(entry.decoded / 1024),
      })),
    failures,
    consoleErrors: guard.consoleErrors,
    serviceWorker: swSupport,
    note: THROTTLES[throttle] === null ? 'unthrottled' : `throttled:${throttle}`,
  };
}

/**
 * Repeat-visit audit: one persistent context with the service worker allowed.
 * The first navigation is the warm-up (registers and precaches); each of the
 * following navigations is scored. Real network bytes come from CDP
 * `Network.loadingFinished`, so SW/cache answers are not miscounted as transfer.
 */
async function measureWarmVisits(browser, url, { throttle, wait, warmRuns }) {
  const context = await browser.newContext({
    ...VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(LCP_INIT_SCRIPT);

  const result = {
    url,
    firstVisit: null,
    serviceWorker: { supported: false, registrations: 0, state: null, script: null, caches: [] },
    visits: [],
    failures: [],
    consoleErrors: [],
    note: THROTTLES[throttle] === null ? 'unthrottled' : `throttled:${throttle}`,
  };

  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await applyThrottle(client, throttle);
  const guard = makeGuard(page, new URL(url).origin);

  let networkBytes = 0;
  let networkRequests = 0;
  client.on('Network.requestWillBeSent', () => {
    networkRequests += 1;
  });
  client.on('Network.loadingFinished', (event) => {
    networkBytes += event.encodedDataLength ?? 0;
  });

  // --- Warm-up visit: feeds the HTTP cache / installs and activates the SW.
  const warmUpStartedAt = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector(CANVAS_SELECTOR, { timeout: 60_000 });
    result.firstVisit = {
      status: response?.status() ?? null,
      firstLoadMs: Date.now() - warmUpStartedAt,
    };
    await page.waitForTimeout(wait);
  } catch (error) {
    result.firstVisit = { status: null, firstLoadMs: Date.now() - warmUpStartedAt };
    result.failures.push(`warm-up load ${url}: ${String(error).slice(0, 200)}`);
  }

  // Wait for an activated service worker, if the app registers one (dev :5173
  // does not: VitePWA only injects registration into production builds).
  let sw = { supported: false, registrations: 0, state: null, script: null, caches: [] };
  try {
    sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return { supported: false, registrations: 0, state: null, script: null, caches: [] };
      }
      const deadline = Date.now() + 8_000;
      let registration = null;
      while (Date.now() < deadline) {
        registration = await navigator.serviceWorker.getRegistration();
        if (registration?.active?.state === 'activated') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const cacheNames = await caches.keys().catch(() => []);
      const cacheSizes = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        cacheSizes.push({ name, entries: keys.length });
      }
      return {
        supported: true,
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
        state: registration?.active?.state ?? null,
        script: registration?.active?.scriptURL ?? null,
        caches: cacheSizes,
        controlled: navigator.serviceWorker.controller !== null,
      };
    });
  } catch (error) {
    result.failures.push(`service worker probe: ${String(error).slice(0, 200)}`);
  }
  result.serviceWorker = sw;

  // --- Scored repeat visits.
  for (let visit = 0; visit < warmRuns; visit += 1) {
    networkBytes = 0;
    networkRequests = 0;
    const startedAt = Date.now();
    let status = null;
    let canvasAt = null;
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      status = response?.status() ?? null;
      await page.waitForSelector(CANVAS_SELECTOR, { timeout: 45_000 });
      canvasAt = Date.now() - startedAt;
    } catch (error) {
      result.failures.push(`warm visit ${visit + 1}: ${String(error).slice(0, 200)}`);
    }
    await page.waitForTimeout(wait);

    const metrics = await page.evaluate(READ_METRICS).catch(() => ({
      paint: {},
      lcp: null,
      dcl: null,
      loadEvent: null,
      resources: [],
      domNodes: 0,
    }));
    const controlled = await page
      .evaluate(() => ('serviceWorker' in navigator ? navigator.serviceWorker.controller !== null : null))
      .catch(() => null);
    result.visits.push({
      status,
      fcpMs: metrics.paint['first-contentful-paint'] ?? null,
      lcpMs: metrics.lcp,
      mapCanvasMs: canvasAt,
      dclMs: metrics.dcl,
      loadEventMs: metrics.loadEvent,
      resourceCount: metrics.resources.length,
      // Real wire bytes during THIS navigation (CDP loadingFinished), and how
      // many requests the page target saw (cached/SW answers transfer 0 bytes).
      networkKB: Math.round(networkBytes / 1024),
      observedRequests: networkRequests,
      controlled,
    });
  }

  result.failures.push(...guard.failures);
  result.consoleErrors = guard.consoleErrors;
  await context.close();
  return result;
}

function median(values) {
  const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function summarizeWarm(warm) {
  if (warm === null || warm === undefined) return null;
  const visits = warm.visits ?? [];
  const summary = {
    fcpMs: median(visits.map((visit) => visit.fcpMs)),
    lcpMs: median(visits.map((visit) => visit.lcpMs)),
    mapCanvasMs: median(visits.map((visit) => visit.mapCanvasMs)),
    dclMs: median(visits.map((visit) => visit.dclMs)),
    networkKB: median(visits.map((visit) => visit.networkKB)),
    observedRequests: median(visits.map((visit) => visit.observedRequests)),
    serviceWorkerState: warm.serviceWorker?.state ?? null,
    serviceWorkerScript: warm.serviceWorker?.script ?? null,
    controlled: visits.length > 0 ? visits[visits.length - 1].controlled : null,
    cacheEntries: Object.fromEntries(
      (warm.serviceWorker?.caches ?? []).map((cache) => [cache.name, cache.entries]),
    ),
    failures: [...new Set(warm.failures ?? [])],
    consoleErrors: [...new Set(warm.consoleErrors ?? [])],
    visits,
  };
  return summary;
}

function summarize(runs) {
  const base = runs[0];
  return {
    url: base.url,
    status: base.status,
    note: base.note,
    coldLoadMs: median(runs.map((run) => run.coldLoadMs)),
    firstPaintMs: median(runs.map((run) => run.firstPaintMs)),
    fcpMs: median(runs.map((run) => run.fcpMs)),
    lcpMs: median(runs.map((run) => run.lcpMs)),
    mapCanvasMs: median(runs.map((run) => run.mapCanvasMs)),
    requestCount: median(runs.map((run) => run.requestCount)),
    transferKB: median(runs.map((run) => run.transferKB)),
    decodedKB: median(runs.map((run) => run.decodedKB)),
    longestTaskMs: median(runs.map((run) => run.longestTaskMs)),
    byType: base.byType,
    externalHosts: [...new Set(runs.flatMap((run) => run.externalHosts))],
    slowest: base.slowest,
    failures: [...new Set(runs.flatMap((run) => run.failures))],
    consoleErrors: [...new Set(runs.flatMap((run) => run.consoleErrors ?? []))],
    serviceWorker: base.serviceWorker,
    runs: runs.map((run) => ({
      coldLoadMs: run.coldLoadMs,
      fcpMs: run.fcpMs,
      lcpMs: run.lcpMs,
      mapCanvasMs: run.mapCanvasMs,
      transferKB: run.transferKB,
      requestCount: run.requestCount,
    })),
  };
}

function formatTable(results) {
  const rows = [
    ['target', ...results.map((result) => result.url)],
    ['network', ...results.map((result) => result.note)],
    ['FCP ms', ...results.map((result) => String(result.fcpMs))],
    ['LCP ms', ...results.map((result) => String(result.lcpMs))],
    ['map canvas ms', ...results.map((result) => String(result.mapCanvasMs))],
    ['load event ms', ...results.map((result) => String(result.coldLoadMs))],
    ['requests', ...results.map((result) => String(result.requestCount))],
    ['transfer KB', ...results.map((result) => String(result.transferKB))],
    ['decoded KB', ...results.map((result) => String(result.decodedKB))],
    ['longest task ms', ...results.map((result) => String(result.longestTaskMs))],
    ['external hosts', ...results.map((result) => result.externalHosts.join(',') || '—')],
  ];
  if (results.some((result) => result.warm !== null && result.warm !== undefined)) {
    const warm = (result) => result.warm ?? {};
    rows.push(
      ['SW state', ...results.map((result) => String(warm(result).serviceWorkerState ?? '—'))],
      ['warm FCP ms', ...results.map((result) => String(warm(result).fcpMs ?? '—'))],
      ['warm map canvas ms', ...results.map((result) => String(warm(result).mapCanvasMs ?? '—'))],
      ['warm network KB', ...results.map((result) => String(warm(result).networkKB ?? '—'))],
      ['warm page reqs', ...results.map((result) => String(warm(result).observedRequests ?? '—'))],
    );
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column] ?? '').length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => String(cell ?? '').padEnd(widths[column]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function printFailures(results) {
  const failed = results.filter(
    (result) =>
      result.failures.length > 0 ||
      (result.status ?? 500) >= 400 ||
      (result.warm?.failures?.length ?? 0) > 0,
  );
  if (failed.length === 0) return 0;
  console.log('FAILURES');
  for (const result of failed) {
    for (const failure of result.failures) console.log(`  ${result.url}: ${failure}`);
    for (const failure of result.warm?.failures ?? []) console.log(`  ${result.url} (warm): ${failure}`);
    if ((result.status ?? 500) >= 400) console.log(`  ${result.url}: HTTP ${result.status}`);
  }
  return failed.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'usage: node scripts/perf-audit.mjs [--runs n] [--throttle none|tailnet|fast3g|slow3g]\n' +
        ' [--warm [--warm-runs n]] [--wait ms] [--json file] [--quiet] [--label name] URL...\n' +
        'See the file header for the full description of every option.',
    );
    return;
  }
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const all = [];
  try {
    for (const target of options.targets) {
      const runs = [];
      for (let run = 0; run < options.runs; run += 1) {
        if (!options.quiet) {
          console.error(`perf: ${labelFor(target)} run ${run + 1}/${options.runs}`);
        }
        runs.push(await measureOnce(browser, target.url, options));
      }
      const summary = summarize(runs);
      if (options.warm) {
        if (!options.quiet) console.error(`perf: ${labelFor(target)} warm visits (service worker on)`);
        summary.warm = summarizeWarm(await measureWarmVisits(browser, target.url, options));
      }
      all.push(summary);
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(formatTable(all));
  console.log('');
  const failedCount = printFailures(all);
  if (options.json !== null) {
    await writeFile(options.json, `${JSON.stringify(all, null, 2)}\n`);
    if (!options.quiet) console.log(`perf: wrote ${options.json}`);
  }
  process.exitCode = failedCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`perf-audit: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
