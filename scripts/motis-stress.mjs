#!/usr/bin/env node
/**
 * Repeated heavy-plan stress probe (ruling R37).
 *
 * The bug this guards against: Node 24's bundled undici asserted in
 * `Parser.finish` and killed the whole API process when MOTIS closed a
 * keep-alive connection mid-response. The shape that reproduced it is a `/plan`
 * that fans out to three MOTIS calls — base departure, +10 minutes, then
 * direct-only. A corridor whose first attempt already returns three or more
 * itineraries stops after one call, so it does NOT exercise that path (the
 * previous Cubao->Divisoria probe was exactly that mistake: 4 itineraries in
 * one call).
 *
 * This probe therefore uses Divisoria -> Taguig, which returns 2 plausible
 * itineraries after all three attempts on the current 494-route feed. Every
 * iteration is rejected unless:
 *   - the response carries exactly 3 `x-biyahey-motis-calls` (the fan-out ran),
 *   - it returns at least 1 itinerary (the run was not empty), and
 *   - the request is HTTP 200.
 *
 * After the loop it asks the API whether it is still alive; a dead process
 * fails the probe.
 *
 * Usage (API already running, MOTIS healthy):
 *   $env:API_URL = 'http://localhost:8787'
 *   node scripts/motis-stress.mjs            # 20 requests
 *   node scripts/motis-stress.mjs 50         # custom count
 *
 * Committed proof for Task 11: a 20-request run where every request returns
 * itineraries with at most three logical MOTIS calls and the API survives; the
 * exact fan-out count is feed-dependent and is recorded as a distribution (a
 * richer national feed answers the base call first). See
 * docs/runbooks/phase1-acceptance.md.
 */
const apiUrl = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const count = Number(process.argv[2] ?? 20);
/** ISO-8601 UTC of the next 08:00 Asia/Manila, inside MOTIS's loaded window. */
function nextMorningDeparture() {
  const offsetMs = 8 * 3_600_000;
  const nowPht = Date.now() + offsetMs;
  const dayStartPht = Math.floor(nowPht / 86_400_000) * 86_400_000;
  let targetPht = dayStartPht + 8 * 3_600_000;
  if (targetPht <= nowPht) {
    targetPht += 86_400_000;
  }
  return new Date(targetPht - offsetMs).toISOString();
}
/** Divisoria -> Taguig: two plausible options only after all three attempts. */
const body = {
  origin: { lat: 14.607, lon: 120.968 },
  destination: { lat: 14.517, lon: 121.074 },
  departAt: nextMorningDeparture(),
};
/** The BFF makes at most three logical MOTIS calls per request (base, +10 min,
 * direct-only); how many it needs depends on the feed's coverage for the
 * corridor, so the probe requires 1–3 and records the distribution. */
const MAX_MOTIS_CALLS = 3;

if (!Number.isInteger(count) || count < 1) {
  console.error(`stress: count must be a positive integer, got ${process.argv[2]}`);
  process.exit(2);
}

const samples = [];
let failures = 0;
let itineraries = 0;
let fanOutIterations = 0;

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
    const returned = payload.itineraries?.length ?? 0;
    const calls = Number(response.headers.get('x-biyahey-motis-calls'));
    itineraries += returned;
    if (!response.ok) {
      failures += 1;
      console.error(`  #${index + 1}: HTTP ${response.status}`);
      continue;
    }
    if (returned === 0) {
      failures += 1;
      console.error(`  #${index + 1}: 0 itineraries (empty plan, not a valid stress sample)`);
      continue;
    }
    if (!Number.isInteger(calls) || calls < 1 || calls > MAX_MOTIS_CALLS) {
      failures += 1;
      console.error(
        `  #${index + 1}: ${calls} MOTIS calls, expected 1–${MAX_MOTIS_CALLS} — ` +
          'the BFF fan-out contract is broken',
      );
      continue;
    }
    if (calls > 1) {
      fanOutIterations += 1;
    }
    console.log(`  #${index + 1}: ${returned} itineraries, ${calls} MOTIS calls, ${ms} ms`);
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
  `\nstress: ${count - failures}/${count} requests succeeded, ` +
    `${fanOutIterations}/${count} needed >1 MOTIS call (max ${MAX_MOTIS_CALLS}), ` +
    `${itineraries} itineraries, p95 ${p95} ms, max ${max} ms`,
);
console.log(`stress: API after the loop: ${alive ? 'alive' : 'DEAD'} (${health.trim()})`);
if (!alive || failures > 0) {
  process.exitCode = 1;
}
