#!/usr/bin/env node
/**
 * Fare-matrix staleness gate (spec §8.3, final-review item 9).
 *
 * Fails when the LTFRB PUV fare matrix's `effective_from` is more than 183 days
 * before the check date. Runs in `npm run ci`, so a stale matrix blocks CI
 * instead of merely warning in a doc.
 *
 * The rule is deliberately mirrored from
 * `packages/shared/src/fares.ts::isFareStale` because this is a plain Node
 * script (CI runs it before any TypeScript compilation) and the shared package
 * is consumed as source. `packages/shared/src/fares-check.test.ts` asserts the
 * two implementations agree on the boundary dates, so the mirror cannot drift
 * silently.
 *
 * Usage:
 *   npm run check:fares
 *   npm run check:fares -- --today=2027-04-01   # deterministic probe
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const faresDir = join(repoRoot, 'data', 'fares');

/** Same threshold as `FARE_STALE_AFTER_DAYS` in the shared fare engine. */
export const STALE_AFTER_DAYS = 183;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Parse a strict `YYYY-MM-DD` UTC date; throws on any other value. */
export function parseIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new Error(`not an ISO date (YYYY-MM-DD): "${value}"`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`not a real calendar date: "${value}"`);
  }
  return date;
}

/** True when `effectiveFrom` is more than 183 days before `today` (UTC dates). */
export function isMatrixStale(effectiveFrom, today = new Date()) {
  if (Number.isNaN(today.getTime())) {
    throw new Error('today must be a valid Date');
  }
  const effective = parseIsoDate(effectiveFrom);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return (todayUtc - effective.getTime()) / MS_PER_DAY > STALE_AFTER_DAYS;
}

/** ISO date of a Date, in UTC. */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Read every `fares-*.yaml` matrix and evaluate its staleness.
 *
 * Returns `{ checked_on, stale, matrices: [{file, matrix_id, effective_from, stale}] }`.
 */
export function fareMatrixStatus({ dataDir = faresDir, today = new Date() } = {}) {
  if (Number.isNaN(today.getTime())) {
    throw new Error('today must be a valid Date');
  }
  const files = readdirSync(dataDir)
    .filter((name) => /^fares-.*\.ya?ml$/i.test(name))
    .sort();
  const matrices = [];
  for (const name of files) {
    const document = parseYaml(readFileSync(join(dataDir, name), 'utf8'));
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      continue;
    }
    if (typeof document.matrix_id !== 'string' || typeof document.effective_from !== 'string') {
      throw new Error(`${name}: expected string "matrix_id" and "effective_from"`);
    }
    matrices.push({
      file: name,
      matrix_id: document.matrix_id,
      effective_from: document.effective_from,
      stale: isMatrixStale(document.effective_from, today),
    });
  }
  if (matrices.length === 0) {
    throw new Error(`no fare matrix (fares-*.yaml with matrix_id) found in ${dataDir}`);
  }
  return {
    checked_on: isoDate(today),
    stale: matrices.some((matrix) => matrix.stale),
    stale_after_days: STALE_AFTER_DAYS,
    matrices,
  };
}

function readTodayArg(argv) {
  const value = argv.find((arg) => arg.startsWith('--today='));
  if (value === undefined) {
    return new Date();
  }
  return parseIsoDate(value.slice('--today='.length));
}

function main(argv = process.argv.slice(2)) {
  try {
    const today = readTodayArg(argv);
    const status = fareMatrixStatus({ today });
    for (const matrix of status.matrices) {
      console.log(
        `check:fares: ${matrix.matrix_id} effective ${matrix.effective_from} — ` +
          `${matrix.stale ? 'STALE' : 'fresh'} on ${status.checked_on} ` +
          `(threshold ${status.stale_after_days} days)`,
      );
    }
    if (status.stale) {
      console.error(
        'check:fares: FAIL — the fare matrix is older than 183 days; update ' +
          'data/fares/ and packages/shared/src/fares.ts together (spec §8.3).',
      );
      return 1;
    }
    console.log('check:fares: ok (matrix within the 183-day window)');
    return 0;
  } catch (error) {
    console.error(`check:fares: error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
