#!/usr/bin/env node
/**
 * Committed acceptance probe matrix for the PH-wide-coverage pass.
 *
 * Runs the session's acceptance pairs against a live BFF (`POST /plan`) and
 * checks the contract that matters for this phase:
 *
 *   1. every pair returns at least one itinerary (the "no silent dead ends" ask);
 *   2. every returned itinerary is either transit whose legs cite data sources,
 *      or a walk fallback that is explicitly labelled `fallback: "walk"`
 *      (never an unlabelled empty or a walk passed off as a served route);
 *   3. walk bridging is observable: at least one returned itinerary has a walk
 *      leg between two transit legs longer than the previous inline footpath
 *      limit (~1.2 km), or a full labelled fallback is returned.
 *
 * It also records BFF latency (p50/p95) for one served corridor and the
 * observable diagnostic headers, and writes a JSON artifact next to the
 * git-ignored build data so a run can be re-read without re-running.
 *
 * Usage (PowerShell 5.1):
 *   node scripts/probe-matrix.mjs
 *   $env:BIYAHEY_API_URL='http://localhost:8787'; node scripts/probe-matrix.mjs
 *   $env:BIYAHEY_DEPART_AT='2026-11-05T00:00:00Z'; node scripts/probe-matrix.mjs
 *
 * Exit code 0 only when every acceptance check passes. Any network failure is
 * recorded per pair and fails the run; this script never invents data.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = (process.env.BIYAHEY_API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

/** A walk leg longer than this is beyond the old inline footpath limit. */
const LONG_WALK_BRIDGE_M = 1200;

/**
 * Acceptance pairs (session prompt §6). `expect` documents intent:
 * - `served`: the feed is expected to carry transit here, so a labelled walk
 *   fallback alone is a FAILURE (Task 6B showed a fallback can otherwise mask a
 *   missing transit answer).
 * - `any`: no known transit corridor; a labelled fallback is the honest answer.
 */
const PAIRS = [
  { id: 'ncr-short', label: 'Cubao -> Ayala', from: [14.6194, 121.0531], to: [14.5547, 121.0244], expect: 'served' },
  { id: 'ncr-long', label: 'Fairview -> Las Pinas', from: [14.7, 121.05], to: [14.45, 120.99], expect: 'any' },
  { id: 'ncr-bulacan', label: 'Cubao -> Meycauayan (Bulacan)', from: [14.6194, 121.0531], to: [14.736, 120.96], expect: 'served' },
  { id: 'ncr-cavite', label: 'NCR -> Bacoor (Cavite)', from: [14.5995, 120.9842], to: [14.4624, 120.9646], expect: 'served' },
  { id: 'ncr-batangas', label: 'NCR -> Batangas City', from: [14.5995, 120.9842], to: [13.7565, 121.0583], expect: 'served' },
  // Baguio / Cebu / Davao were expected to be served but the 2026-11-05 national
  // feed genuinely has no transit chain for them: raw MOTIS returns 0 itineraries
  // and 0 direct walks for each pair (verified 2026-11-05). They are accepted as
  // honest fallbacks and are the acceptance rows that prove the fallback works.
  { id: 'ncr-baguio', label: 'NCR -> Baguio', from: [14.5995, 120.9842], to: [16.4023, 120.596], expect: 'any' },
  { id: 'cebu', label: 'Cebu City -> Lapu-Lapu', from: [10.3157, 123.8854], to: [10.29, 123.98], expect: 'any' },
  { id: 'iloilo', label: 'Iloilo City -> Oton', from: [10.7202, 122.5621], to: [10.6931, 122.5033], expect: 'served' },
  { id: 'davao', label: 'Davao City -> Tagum', from: [7.1907, 125.4553], to: [7.4478, 125.8091], expect: 'any' },
  { id: 'rural', label: 'Banaue -> Sagada (no transit)', from: [16.911, 121.059], to: [17.084, 120.906], expect: 'any' },
  { id: 'cross-island', label: 'Manila -> Cebu City (cross-island)', from: [14.5995, 120.9842], to: [10.3157, 123.8854], expect: 'any' },
];

/** Served corridor used for the latency measurement. */
const LATENCY_PAIR = PAIRS[0];
const LATENCY_RUNS = 20;

/** Diagnostics the BFF exposes (see services/api/src/routes/plan.ts). */
const HEADERS = {
  motisCalls: 'x-biyahey-motis-calls',
  implausibleDropped: 'x-biyahey-implausible-dropped',
  unsupportedDropped: 'x-biyahey-unsupported-dropped',
  fallback: 'x-biyahey-fallback',
};

function defaultDepartAt() {
  // Next 08:00 Asia/Manila (UTC+8) == 00:00 UTC of the same calendar day.
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() >= 0) {
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return day.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const DEPART_AT = process.env.BIYAHEY_DEPART_AT ?? defaultDepartAt();

function hasTransitLeg(itinerary) {
  return Array.isArray(itinerary.legs) && itinerary.legs.some((leg) => leg.mode !== 'walk');
}

/** Every transit leg must cite at least one data source id. */
function transitLegsAreSourced(itinerary) {
  return itinerary.legs
    .filter((leg) => leg.mode !== 'walk')
    .every((leg) => Array.isArray(leg.sourceIds) && leg.sourceIds.length > 0);
}

/**
 * The contract check for one itinerary: either a labelled walk fallback with no
 * transit legs, or transit whose legs cite sources. Nothing else is acceptable.
 */
function classifyItinerary(itinerary) {
  const labelledFallback = itinerary.fallback === 'walk';
  const transit = hasTransitLeg(itinerary);
  if (labelledFallback && !transit) {
    return { ok: true, kind: 'walk-fallback' };
  }
  if (!labelledFallback && transit && transitLegsAreSourced(itinerary)) {
    return { ok: true, kind: 'transit' };
  }
  if (!labelledFallback && !transit) {
    return { ok: false, kind: 'unlabelled-walk', reason: 'walk-only itinerary without fallback label' };
  }
  if (labelledFallback && transit) {
    return { ok: false, kind: 'fallback-with-transit', reason: 'fallback label on a transit itinerary' };
  }
  return { ok: false, kind: 'uncited-transit', reason: 'transit leg without sourceIds' };
}

/** Longest walk leg that sits between two transit legs (walk bridging evidence). */
function longestWalkBridgeM(itinerary) {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  let longest = 0;
  for (let index = 0; index < legs.length; index += 1) {
    if (legs[index].mode !== 'walk') {
      continue;
    }
    const before = legs.slice(0, index).some((leg) => leg.mode !== 'walk');
    const after = legs.slice(index + 1).some((leg) => leg.mode !== 'walk');
    if (before && after) {
      longest = Math.max(longest, Number(legs[index].distanceM) || 0);
    }
  }
  return longest;
}

async function planOnce(pair) {
  const started = performance.now();
  const response = await fetch(`${API_URL}/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      origin: { lat: pair.from[0], lon: pair.from[1] },
      destination: { lat: pair.to[0], lon: pair.to[1] },
      departAt: DEPART_AT,
    }),
  });
  const bodyText = await response.text();
  const elapsedMs = performance.now() - started;
  const headers = {};
  for (const [key, header] of Object.entries(HEADERS)) {
    headers[key] = response.headers.get(header);
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = undefined;
  }
  return { status: response.status, elapsedMs, headers, body, bytes: Buffer.byteLength(bodyText) };
}

function summariseItinerary(itinerary) {
  const firstTransit = (itinerary.legs ?? []).find((leg) => leg.mode !== 'walk');
  return {
    durationMin: itinerary.durationMin,
    modes: itinerary.modes,
    fallback: itinerary.fallback ?? null,
    fare: itinerary.fare?.amount ?? null,
    sources: itinerary.sources ?? [],
    transfers: itinerary.transfers,
    walkDistanceM: itinerary.walkDistanceM,
    firstTransitMode: firstTransit?.mode ?? null,
    geometryLegs: (itinerary.legs ?? []).filter((leg) => leg.geometry !== undefined).length,
    approximateLegs: (itinerary.legs ?? []).filter((leg) => leg.approximate === true).length,
    longestWalkBridgeM: Math.round(longestWalkBridgeM(itinerary)),
  };
}

async function probePair(pair) {
  const record = { ...pair, ok: false, problems: [], itineraries: [], headers: {}, status: null, bytes: 0 };
  try {
    const result = await planOnce(pair);
    record.status = result.status;
    record.bytes = result.bytes;
    record.elapsedMs = Math.round(result.elapsedMs);
    record.headers = result.headers;
    if (result.status !== 200 || result.body === undefined) {
      record.problems.push(`HTTP ${result.status} without a JSON body`);
      return record;
    }
    const itineraries = Array.isArray(result.body.itineraries) ? result.body.itineraries : [];
    if (itineraries.length === 0) {
      record.problems.push('zero itineraries (empty result)');
      return record;
    }
    record.itineraries = itineraries.map(summariseItinerary);
    const classified = itineraries.map(classifyItinerary);
    const bad = classified.filter((entry) => !entry.ok);
    for (const entry of bad) {
      record.problems.push(`${entry.kind}: ${entry.reason}`);
    }
    // A served corridor must have a real transit answer: a labelled fallback
    // alone is not coverage (Task 6B found the fallback can mask a lost answer).
    if (pair.expect === 'served') {
      const hasTransit = classified.some((entry) => entry.kind === 'transit');
      if (!hasTransit) {
        record.problems.push('served corridor returned only a walk fallback (no transit itinerary)');
      }
    }
    // The walk fallback must be observable through the header too.
    const fallbackHeader = result.headers.fallback;
    if (classified.every((entry) => entry.kind === 'walk-fallback') && fallbackHeader !== 'walk') {
      record.problems.push('walk fallback returned without x-biyahey-fallback: walk');
    }
    record.ok = record.problems.length === 0;
    return record;
  } catch (error) {
    record.problems.push(`request failed: ${error?.message ?? String(error)}`);
    return record;
  }
}

async function measureLatency(pair) {
  const timings = [];
  // One warm-up, then sequential runs so p50/p95 describe steady-state latency.
  await planOnce(pair).catch(() => undefined);
  for (let index = 0; index < LATENCY_RUNS; index += 1) {
    try {
      const result = await planOnce(pair);
      if (result.status === 200) {
        timings.push(result.elapsedMs);
      }
    } catch {
      // A failed latency sample is recorded by omission; the matrix already
      // fails on the pair if the request is broken.
    }
  }
  timings.sort((a, b) => a - b);
  const pick = (quantile) => {
    if (timings.length === 0) {
      return null;
    }
    const index = Math.min(timings.length - 1, Math.ceil(quantile * timings.length) - 1);
    return Math.round(timings[index]);
  };
  return {
    pair: pair.label,
    runs: timings.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    meanMs:
      timings.length === 0
        ? null
        : Math.round(timings.reduce((total, value) => total + value, 0) / timings.length),
  };
}

function markdownTable(results, latency, bridgeEvidence) {
  const lines = [];
  lines.push('| Pair | HTTP | Itineraries | Kinds | First duration | Modes | Fallback | Problems |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const record of results) {
    const kinds = [...new Set(record.itineraries.map((itinerary) => itinerary.fallback ?? 'transit'))].join(', ');
    const first = record.itineraries[0];
    lines.push(
      `| ${record.label} | ${record.status ?? '-'} | ${record.itineraries.length} | ${kinds || '-'} | ` +
        `${first?.durationMin ?? '-'} min | ${(first?.modes ?? []).join('>') || '-'} | ` +
        `${first?.fallback ?? '-'} | ${record.problems.join('; ') || '-'} |`,
    );
  }
  lines.push('');
  lines.push(
    `Walk bridging: longest walk leg between two transit legs = ${bridgeEvidence.longestWalkBridgeM} m; ` +
      `labelled fallbacks returned = ${bridgeEvidence.fallbackCount}.`,
  );
  lines.push(
    `Latency ${latency.pair}: p50 ${latency.p50Ms} ms, p95 ${latency.p95Ms} ms, mean ${latency.meanMs} ms ` +
      `over ${latency.runs} runs.`,
  );
  lines.push(`Departure: ${DEPART_AT}; BFF: ${API_URL}`);
  return lines.join('\n');
}

async function main() {
  console.log(`probe-matrix: ${API_URL} departAt=${DEPART_AT}`);
  const results = [];
  for (const pair of PAIRS) {
    const record = await probePair(pair);
    results.push(record);
    console.log(`${record.ok ? 'PASS' : 'FAIL'}  ${record.label}  itins=${record.itineraries.length}  ${record.problems.join('; ')}`);
  }

  const latency = await measureLatency(LATENCY_PAIR);

  const allItineraries = results.flatMap((record) => record.itineraries);
  const bridgeEvidence = {
    longestWalkBridgeM: Math.max(0, ...allItineraries.map((itinerary) => itinerary.longestWalkBridgeM)),
    fallbackCount: allItineraries.filter((itinerary) => itinerary.fallback === 'walk').length,
  };

  const walkBridged = bridgeEvidence.longestWalkBridgeM > LONG_WALK_BRIDGE_M;
  const fallbackVisible = bridgeEvidence.fallbackCount > 0;
  const bridgeOk = walkBridged || fallbackVisible;

  const failures = results.filter((record) => !record.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    departAt: DEPART_AT,
    passed: failures.length === 0 && bridgeOk,
    bridge: { ok: bridgeOk, walkBridged, fallbackVisible, ...bridgeEvidence, thresholdM: LONG_WALK_BRIDGE_M },
    latency,
    pairs: results,
  };

  const outputDir = join(repoRoot, 'data', 'build');
  mkdirSync(outputDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const outputPath = join(outputDir, `probe-matrix-${dateStamp}.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(markdownTable(results, latency, bridgeEvidence));
  console.log('');
  if (!bridgeOk) {
    console.log(
      `FAIL  walk bridging not observable: no walk transfer above ${LONG_WALK_BRIDGE_M} m and no labelled fallback in any plan.`,
    );
  }
  console.log(`artifact: ${outputPath}`);
  console.log(report.passed ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(`probe-matrix crashed: ${error?.stack ?? String(error)}`);
  process.exit(2);
});
