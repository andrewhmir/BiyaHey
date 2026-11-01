#!/usr/bin/env node
/**
 * Repeated heavy-plan stress probe (ruling R37).
 *
 * The bug this guards against: Node 24's bundled undici asserted in
 * `Parser.finish` and killed the whole API process when MOTIS closed a
 * keep-alive connection mid-response. A `/plan` on the Cubao -> Divisoria
 * corridor fans out to three MOTIS calls (base, shifted, direct-only), which is
 * the shape that reproduced it. This probe sends that request N times in a row
 * through the running API and then asks the API whether it is still alive - if
 * the process died, the health check fails and the probe exits non-zero.
 *
 * Usage (API already running, MOTIS healthy):
 *   $env:API_URL = 'http://localhost:8787'
 *   node scripts/motis-stress.mjs            # 20 requests
 *   node scripts/motis-stress.mjs 50         # custom count
 *
 * The committed proof for Task 11 is `20/20 requests survived, p95 X ms`, repeated
 * after the R37 transport replacement; see docs/runbooks/phase1-acceptance.md.
 */
const apiUrl = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const count = Number(process.argv[2] ?? 20);
const body = {
  origin: { lat: 14.619, lon: 121.053 },
  destination: { lat: 14.607, lon: 120.968 },
  departAt: '2026-11-02T08:00:00+08:00',
};

if (!Number.isInteger(count) || count < 1) {
  console.error(`stress: count must be a positive integer, got ${process.argv[2]}`);
  process.exit(2);
}

const samples = [];
let failures = 0;
let itineraries = 0;

for (let index = 0; index < count; index += 1) {
  const started = performance.now();
  try {
    const response = await fetch(`${apiUrl}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    const ms = Math.round(performance.now() - started);
    samples.push(ms);
    if (!response.ok) {
      failures += 1;
      console.error(`  #${index + 1}: HTTP ${response.status}`);
      continue;
    }
    itineraries += payload.itineraries?.length ?? 0;
    console.log(
      `  #${index + 1}: ${payload.itineraries?.length ?? 0} itineraries in ${ms} ms`,
    );
  } catch (error) {
    failures += 1;
    samples.push(Math.round(performance.now() - started));
    console.error(`  #${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const sorted = [...samples].sort((a, b) => a - b);
const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
const max = sorted[sorted.length - 1] ?? 0;

let alive = false;
let health = '';
try {
  const response = await fetch(`${apiUrl}/health`);
  health = await response.text();
  alive = response.ok;
} catch (error) {
  health = error instanceof Error ? error.message : String(error);
}

console.log(
  `\nstress: ${count - failures}/${count} requests succeeded, ${itineraries} itineraries, ` +
    `p95 ${p95} ms, max ${max} ms`,
);
console.log(`stress: API after the loop: ${alive ? 'alive' : 'DEAD'} (${health.trim()})`);
if (!alive || failures > 0) {
  process.exitCode = 1;
}
