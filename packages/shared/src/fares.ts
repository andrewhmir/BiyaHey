import type { SourceId } from './provenance.js';
import type { FareMode, FareQuote, LegFareInput } from './types.js';

const STALE_AFTER_DAYS = 183;
const MS_PER_DAY = 86_400_000;

/**
 * Days after `effective_from` at which a fare row is considered stale
 * (spec §8.3: CI warns past six months). Exported so the `check:fares` CI
 * script and its agreement test use the same boundary as the engine.
 */
export const FARE_STALE_AFTER_DAYS = STALE_AFTER_DAYS;

const PUV_EFFECTIVE_FROM = '2026-09-28'; // LTFRB PUV matrix (spec §8.3)
const RAIL_DISCOUNT_EFFECTIVE_FROM = '2026-03-23'; // LRT-2/MRT-3 50% discount
const LRT1_EFFECTIVE_FROM = '2025-04-02'; // LRT-1 formula (LRMC)

/**
 * Effectivity date of the PUV fare matrix that `/fares/status` reports.
 *
 * The rail and ferry rows carry their own dates (see `FARE_RULES`); this is
 * the LTFRB matrix date the spec's "CI warns when `effective_from` is > 6
 * months old" rule polices.
 */
export const FARE_MATRIX_EFFECTIVE_FROM = PUV_EFFECTIVE_FROM;

const PUV_SOURCE_ID: SourceId = 'ltfrb-fares';
const RAIL_SOURCE_ID: SourceId = 'rail-fares';
const FERRY_SOURCE_ID: SourceId = 'mmda-ferry';

// The ferry is an MMDA service with no LTFRB effectivity date: 2026-11-01 is
// when the free-ride terms were last verified (row-level override, R25).
const FERRY_EFFECTIVE_FROM = '2026-11-01';

type Confidence = FareQuote['confidence'];
type BreakdownLine = FareQuote['breakdown'][number];

interface BaseFareRule {
  effectiveFrom: string;
  sourceId: SourceId;
  confidence: Confidence;
}

interface DistanceFareRule extends BaseFareRule {
  kind: 'distance';
  label: string;
  baseFare: number;
  baseKm: number;
  perKm: number;
}

interface RailBandRule extends BaseFareRule {
  kind: 'rail-band';
  label: string;
  minFare: number;
  maxFare: number;
  lengthKm: number;
  discount: number;
  /**
   * LRT-2-only flag: the band is provisional because no authoritative LRTA
   * per-station table could be transcribed (ruling R47). It is surfaced as
   * `confidence: 'estimated'` plus a "provisional band" fare line and is never
   * described as official.
   */
  provisional: boolean;
}

interface RailFormulaRule extends BaseFareRule {
  kind: 'rail-formula';
  label: string;
  boarding: number;
  perKm: number;
}

interface P2pRule extends BaseFareRule {
  kind: 'p2p';
  multiplier: number;
}

interface FerryRule extends BaseFareRule {
  kind: 'ferry';
  label: string;
  fare: number;
}

type FareRule = DistanceFareRule | RailBandRule | RailFormulaRule | P2pRule | FerryRule;

/**
 * Hand-curated 2026 fare model (spec §8.3).
 *
 * Deliberately Node-free so the PWA can import this module through the
 * browser-safe `@biyahey/shared` barrel. `data/fares/*.yaml` is the
 * pipeline-facing form of the same numbers; `fares.test.ts` compares the two
 * so a transcription change cannot update one without the other.
 */
const FARE_RULES: Record<FareMode, FareRule> = {
  jeepney: {
    kind: 'distance',
    label: 'Traditional jeepney',
    baseFare: 14,
    baseKm: 4,
    perKm: 2,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'modern-jeepney': {
    kind: 'distance',
    label: 'Modern jeepney',
    baseFare: 17,
    baseKm: 4,
    perKm: 2.4,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'city-bus-ordinary': {
    kind: 'distance',
    label: 'City bus (ordinary)',
    baseFare: 15,
    baseKm: 5,
    perKm: 2.49,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'city-bus-aircon': {
    kind: 'distance',
    label: 'City bus (aircon)',
    baseFare: 18,
    baseKm: 5,
    perKm: 2.98,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'provincial-bus-ordinary': {
    kind: 'distance',
    label: 'Provincial bus (ordinary)',
    baseFare: 12,
    baseKm: 5,
    perKm: 2.2,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'uv-express-traditional': {
    kind: 'distance',
    label: 'UV Express (traditional)',
    baseFare: 0,
    baseKm: 0,
    perKm: 2.6,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  'uv-express-modern': {
    kind: 'distance',
    label: 'UV Express (modern)',
    baseFare: 0,
    baseKm: 0,
    perKm: 3,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  p2p: {
    kind: 'p2p',
    multiplier: 1.15,
    effectiveFrom: PUV_EFFECTIVE_FROM,
    sourceId: PUV_SOURCE_ID,
    confidence: 'official',
  },
  mrt3: {
    kind: 'rail-band',
    label: 'MRT-3',
    minFare: 13,
    maxFare: 28,
    lengthKm: 16.9,
    discount: 0.5,
    provisional: false,
    effectiveFrom: RAIL_DISCOUNT_EFFECTIVE_FROM,
    sourceId: RAIL_SOURCE_ID,
    confidence: 'estimated',
  },
  lrt2: {
    kind: 'rail-band',
    label: 'LRT-2',
    minFare: 13,
    maxFare: 28,
    lengthKm: 13.6,
    discount: 0.5,
    // Provisional band (ruling R47, spec §8.3): no authoritative LRTA
    // per-station table could be transcribed from a primary source, so
    // `data/fares/rail-tables.yaml` keeps `needs_verification: true` and this
    // rule stays `confidence: 'estimated'` with a "provisional band" line.
    // Never describe it as official.
    provisional: true,
    effectiveFrom: RAIL_DISCOUNT_EFFECTIVE_FROM,
    sourceId: RAIL_SOURCE_ID,
    confidence: 'estimated',
  },
  lrt1: {
    kind: 'rail-formula',
    label: 'LRT-1',
    boarding: 16.25,
    perKm: 1.47,
    effectiveFrom: LRT1_EFFECTIVE_FROM,
    sourceId: RAIL_SOURCE_ID,
    confidence: 'official',
  },
  ferry: {
    kind: 'ferry',
    label: 'Pasig River Ferry (free)',
    fare: 0,
    effectiveFrom: FERRY_EFFECTIVE_FROM,
    sourceId: FERRY_SOURCE_ID,
    confidence: 'official',
  },
};

/**
 * Every mode the engine can price, in `FARE_RULES` declaration order.
 *
 * The API uses this to reject an unknown mode with a 400 before calling the
 * engine; the engine keeps its own `Object.hasOwn` guard for module consumers.
 */
export const FARE_MODES: readonly FareMode[] = Object.freeze(
  Object.keys(FARE_RULES) as FareMode[],
);

/** Round to whole centavos, the unit every displayed fare is rendered from. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Trim trailing zeros so labels read `6 km`, not `6.000 km`. */
function formatKm(km: number): string {
  return String(Number(km.toFixed(3)));
}

function assertDistance(distanceKm: number): void {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError(
      `distanceKm must be a finite, non-negative number; received ${String(distanceKm)}`,
    );
  }
}

function finishQuote(rule: BaseFareRule, breakdown: BreakdownLine[]): FareQuote {
  return {
    amount: roundMoney(breakdown.reduce((total, line) => total + line.amount, 0)),
    currency: 'PHP',
    confidence: rule.confidence,
    effective_from: rule.effectiveFrom,
    source_id: rule.sourceId,
    breakdown,
  };
}

function distanceQuote(rule: DistanceFareRule, distanceKm: number): FareQuote {
  const chargeableKm = Math.max(0, distanceKm - rule.baseKm);
  const breakdown: BreakdownLine[] = [];
  if (rule.baseFare > 0) {
    breakdown.push({
      label: `${rule.label} base fare (first ${formatKm(rule.baseKm)} km)`,
      amount: roundMoney(rule.baseFare),
    });
  }
  if (chargeableKm > 0) {
    breakdown.push({
      label: `${rule.label} distance charge (${formatKm(chargeableKm)} km × ₱${rule.perKm.toFixed(2)}/km)`,
      amount: roundMoney(chargeableKm * rule.perKm),
    });
  }
  if (breakdown.length === 0) {
    breakdown.push({ label: `${rule.label} (${formatKm(distanceKm)} km)`, amount: 0 });
  }
  return finishQuote(rule, breakdown);
}

function railBandQuote(rule: RailBandRule, distanceKm: number): FareQuote {
  // Ruling R4: prorate the published band to whole pesos, then apply the
  // line discount. 8.2 km on MRT-3 → ₱20 published → ₱10 charged.
  // Ruling R25: the band ends at the last station, so a leg longer than the
  // line is clamped to `lengthKm` instead of being prorated past the maximum.
  const clamped = distanceKm > rule.lengthKm;
  const pricedKm = Math.min(distanceKm, rule.lengthKm);
  const published = Math.round(
    rule.minFare + ((rule.maxFare - rule.minFare) * pricedKm) / rule.lengthKm,
  );
  const provisional = rule.provisional ? ', provisional band' : '';
  const distanceLabel = clamped
    ? `${formatKm(rule.lengthKm)} km line maximum, clamped from ${formatKm(distanceKm)} km`
    : `${formatKm(distanceKm)} km`;
  const breakdown: BreakdownLine[] = [
    {
      label: `${rule.label} published fare (${distanceLabel}${provisional})`,
      amount: published,
    },
  ];
  if (rule.discount < 1) {
    breakdown.push({
      label: `${Math.round((1 - rule.discount) * 100)}% rail discount`,
      amount: roundMoney(published * (rule.discount - 1)),
    });
  }
  return finishQuote(rule, breakdown);
}

function railFormulaQuote(rule: RailFormulaRule, distanceKm: number): FareQuote {
  const breakdown: BreakdownLine[] = [
    { label: `${rule.label} boarding fare`, amount: roundMoney(rule.boarding) },
  ];
  if (distanceKm > 0) {
    breakdown.push({
      label: `${rule.label} distance charge (${formatKm(distanceKm)} km × ₱${rule.perKm.toFixed(2)}/km)`,
      amount: roundMoney(distanceKm * rule.perKm),
    });
  }
  return finishQuote(rule, breakdown);
}

function p2pQuote(rule: P2pRule, routeFare: number | undefined): FareQuote {
  if (routeFare === undefined || !Number.isFinite(routeFare) || routeFare < 0) {
    throw new RangeError('p2p legs require a finite, non-negative routeFare');
  }
  // Derive the premium from the rounded total so the breakdown always sums to
  // the pinned `routeFare * multiplier` value (0.15 is not exact in binary).
  const base = roundMoney(routeFare);
  const total = roundMoney(routeFare * rule.multiplier);
  const premiumRate = Math.round((rule.multiplier - 1) * 100);
  return finishQuote(rule, [
    { label: 'P2P route fare', amount: base },
    { label: `P2P premium (+${premiumRate}%)`, amount: roundMoney(total - base) },
  ]);
}

function ferryQuote(rule: FerryRule): FareQuote {
  return finishQuote(rule, [{ label: rule.label, amount: roundMoney(rule.fare) }]);
}

function freeRideQuote(rule: BaseFareRule): FareQuote {
  return {
    amount: 0,
    currency: 'PHP',
    confidence: 'estimated',
    effective_from: rule.effectiveFrom,
    source_id: rule.sourceId,
    breakdown: [
      { label: 'Free-ride service contract (unverified status)', amount: 0 },
    ],
  };
}

/**
 * Price one leg against the 2026-09-28 matrix, the 2026-03-23 LRT-2/MRT-3
 * discount and the 2025-04-02 LRT-1 formula (spec §8.3).
 *
 * @throws RangeError when the distance is not finite/non-negative, when a
 *   `p2p` leg has no valid route fare, or when the mode is unknown at runtime.
 */
export function quoteFareForLeg(input: LegFareInput): FareQuote {
  assertDistance(input.distanceKm);
  // Own-property check (R25): `FARE_RULES[mode] === undefined` would let
  // `toString`, `constructor` and `__proto__` through to a TypeError instead
  // of the documented RangeError.
  const rule = Object.hasOwn(FARE_RULES, input.mode) ? FARE_RULES[input.mode] : undefined;
  if (rule === undefined) {
    throw new RangeError(`Unknown fare mode: ${String(input.mode)}`);
  }
  if (input.freeRideOverride === true) {
    return freeRideQuote(rule);
  }
  switch (rule.kind) {
    case 'distance':
      return distanceQuote(rule, input.distanceKm);
    case 'rail-band':
      return railBandQuote(rule, input.distanceKm);
    case 'rail-formula':
      return railFormulaQuote(rule, input.distanceKm);
    case 'p2p':
      return p2pQuote(rule, input.routeFare);
    case 'ferry':
      return ferryQuote(rule);
  }
}

/**
 * Sum per-leg quotes into one journey fare.
 *
 * Keeps the earliest `effective_from` (the total is only as fresh as its
 * oldest leg), reports `source_id: null` and prefixes every breakdown label
 * with its source when the legs mix provenance, and downgrades confidence to
 * `estimated` if any leg is estimated.
 *
 * @throws RangeError for an empty quote list; a journey with no fares has no
 *   honest effective date to report.
 */
export function sumFares(quotes: FareQuote[]): FareQuote {
  if (quotes.length === 0) {
    throw new RangeError('sumFares requires at least one fare quote');
  }
  const sourceIds = new Set(quotes.map((quote) => quote.source_id));
  const mixedSources = sourceIds.size > 1;
  const breakdown = quotes.flatMap((quote) =>
    quote.breakdown.map((line) => ({
      label: mixedSources ? `[${quote.source_id ?? 'unsourced'}] ${line.label}` : line.label,
      amount: line.amount,
    })),
  );
  const effectiveFrom = quotes
    .map((quote) => quote.effective_from)
    .reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
  return {
    amount: roundMoney(quotes.reduce((total, quote) => total + quote.amount, 0)),
    currency: 'PHP',
    confidence: quotes.some((quote) => quote.confidence === 'estimated')
      ? 'estimated'
      : 'official',
    effective_from: effectiveFrom,
    source_id: sourceIds.size === 1 ? quotes[0].source_id : null,
    breakdown,
  };
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `effectiveFrom` is more than 183 days old (spec §8.3: CI warns
 * past six months).
 *
 * The comparison uses UTC calendar dates, so `new Date('2026-11-01')` means
 * 1 November 2026 on every host regardless of its local timezone.
 *
 * @throws RangeError when `effectiveFrom` is not a real `YYYY-MM-DD` date or
 *   `today` is an invalid Date.
 */
export function isFareStale(effectiveFrom: string, today: Date = new Date()): boolean {
  const match = ISO_DATE_PATTERN.exec(effectiveFrom);
  if (match === null) {
    throw new RangeError(
      `effectiveFrom must be an ISO date (YYYY-MM-DD); received "${effectiveFrom}"`,
    );
  }
  if (Number.isNaN(today.getTime())) {
    throw new RangeError('today must be a valid Date');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const effectiveUtc = Date.UTC(year, month - 1, day);
  const parsed = new Date(effectiveUtc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`effectiveFrom is not a real calendar date: "${effectiveFrom}"`);
  }
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return (todayUtc - effectiveUtc) / MS_PER_DAY > STALE_AFTER_DAYS;
}
