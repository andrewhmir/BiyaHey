import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isFareStale, quoteFareForLeg, sumFares } from './fares.js';
import type { FareMode } from './types.js';

interface FareRow {
  mode: string;
  class: string;
  base_fare?: number;
  base_km?: number;
  per_km?: number;
  multiplier?: number;
  fare?: number;
  source_id?: string;
}

interface FareMatrixYaml {
  matrix_id: string;
  effective_from: string;
  source_id: string;
  source_url: string;
  currency: string;
  fares: FareRow[];
}

interface RailLineYaml {
  id: string;
  name: string;
  operator: string;
  fare_model: 'formula' | 'band';
  boarding?: number;
  per_km?: number;
  min?: number;
  max?: number;
  length_km?: number;
  discount?: number;
  effective_from: string;
  confidence: 'official' | 'estimated';
  needs_verification?: boolean;
}

interface RailTablesYaml {
  source_id: string;
  source_url: string;
  currency: string;
  lines: RailLineYaml[];
}

function readFareData<T>(name: string): T {
  const file = new URL(`../../../data/fares/${name}`, import.meta.url);
  return parse(readFileSync(file, 'utf8')) as T;
}

const matrix = readFareData<FareMatrixYaml>('fares-2026-09-28.yaml');
const railTables = readFareData<RailTablesYaml>('rail-tables.yaml');

const MODE_BY_ROW: Record<string, FareMode> = {
  'jeepney:traditional': 'jeepney',
  'jeepney:modern': 'modern-jeepney',
  'city-bus:ordinary': 'city-bus-ordinary',
  'city-bus:aircon': 'city-bus-aircon',
  'provincial-bus:ordinary': 'provincial-bus-ordinary',
  'uv-express:traditional': 'uv-express-traditional',
  'uv-express:modern': 'uv-express-modern',
  'p2p:premium': 'p2p',
  'ferry:pasig-river': 'ferry',
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

function expectedRowAmount(row: FareRow): number {
  if (row.mode === 'ferry') {
    if (row.fare === undefined) {
      throw new Error('ferry row is missing `fare`');
    }
    return roundMoney(row.fare);
  }
  if (row.mode === 'p2p') {
    if (row.multiplier === undefined) {
      throw new Error('p2p row is missing `multiplier`');
    }
    return roundMoney(100 * row.multiplier);
  }
  if (row.per_km === undefined) {
    throw new Error(`${row.mode}/${row.class} row is missing \`per_km\``);
  }
  if (row.base_fare !== undefined && row.base_km !== undefined) {
    return roundMoney(row.base_fare + Math.max(0, 12 - row.base_km) * row.per_km);
  }
  return roundMoney(12 * row.per_km);
}

describe('PUV fare matrix effective 2026-09-28', () => {
  it('charges traditional jeepney ₱14 for the first 4 km', () => {
    expect(quoteFareForLeg({ mode: 'jeepney', distanceKm: 3.4 }).amount).toBe(14);
  });

  it('charges traditional jeepney ₱14 at exactly 4 km', () => {
    expect(quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }).amount).toBe(14);
  });

  it('adds ₱2.00/km beyond 4 km for traditional jeepney', () => {
    const quote = quoteFareForLeg({ mode: 'jeepney', distanceKm: 10 });
    expect(quote.amount).toBe(26);
    expect(quote.breakdown).toEqual([
      { label: 'Traditional jeepney base fare (first 4 km)', amount: 14 },
      { label: 'Traditional jeepney distance charge (6 km × ₱2.00/km)', amount: 12 },
    ]);
  });

  it('charges ₱15 for 4.5 km on a traditional jeepney', () => {
    expect(quoteFareForLeg({ mode: 'jeepney', distanceKm: 4.5 }).amount).toBe(15);
  });

  it('charges modern jeepney ₱17 for the first 4 km and ₱2.40/km after', () => {
    expect(quoteFareForLeg({ mode: 'modern-jeepney', distanceKm: 4 }).amount).toBe(17);
    expect(quoteFareForLeg({ mode: 'modern-jeepney', distanceKm: 10 }).amount).toBe(31.4);
  });

  it('charges ordinary city bus ₱15 for the first 5 km and ₱2.49/km after', () => {
    expect(quoteFareForLeg({ mode: 'city-bus-ordinary', distanceKm: 5 }).amount).toBe(15);
    expect(quoteFareForLeg({ mode: 'city-bus-ordinary', distanceKm: 12 }).amount).toBe(32.43);
  });

  it('charges aircon city bus ₱18 for the first 5 km and ₱2.98/km after', () => {
    expect(quoteFareForLeg({ mode: 'city-bus-aircon', distanceKm: 2 }).amount).toBe(18);
    expect(quoteFareForLeg({ mode: 'city-bus-aircon', distanceKm: 12 }).amount).toBe(38.86);
  });

  it('charges provincial ordinary bus ₱12 for the first 5 km and ₱2.20/km after', () => {
    expect(quoteFareForLeg({ mode: 'provincial-bus-ordinary', distanceKm: 5 }).amount).toBe(12);
    expect(quoteFareForLeg({ mode: 'provincial-bus-ordinary', distanceKm: 20 }).amount).toBe(45);
  });

  it('tags PUV quotes as official, dated 2026-09-28 and sourced to ltfrb-fares', () => {
    const quote = quoteFareForLeg({ mode: 'jeepney', distanceKm: 10 });
    expect(quote.currency).toBe('PHP');
    expect(quote.confidence).toBe('official');
    expect(quote.effective_from).toBe('2026-09-28');
    expect(quote.source_id).toBe('ltfrb-fares');
  });

  it('itemises base + distance lines whose amounts sum to the quote total', () => {
    const modes: FareMode[] = [
      'jeepney',
      'modern-jeepney',
      'city-bus-ordinary',
      'city-bus-aircon',
      'provincial-bus-ordinary',
    ];
    for (const mode of modes) {
      const quote = quoteFareForLeg({ mode, distanceKm: 12.7 });
      const lineTotal = quote.breakdown.reduce((total, line) => total + line.amount, 0);
      expect(lineTotal, mode).toBeCloseTo(quote.amount, 10);
    }
  });
});

describe('UV Express and P2P', () => {
  it('charges traditional UV Express ₱2.60/km', () => {
    expect(quoteFareForLeg({ mode: 'uv-express-traditional', distanceKm: 5 }).amount).toBe(13);
    expect(quoteFareForLeg({ mode: 'uv-express-traditional', distanceKm: 7.5 }).amount).toBe(19.5);
  });

  it('charges modern UV Express ₱3.00/km', () => {
    expect(quoteFareForLeg({ mode: 'uv-express-modern', distanceKm: 5 }).amount).toBe(15);
    expect(quoteFareForLeg({ mode: 'uv-express-modern', distanceKm: 7.25 }).amount).toBe(21.75);
  });

  it('applies the P2P +15% premium to the route fare', () => {
    const quote = quoteFareForLeg({ mode: 'p2p', distanceKm: 12, routeFare: 100 });
    expect(quote.amount).toBe(115);
    expect(quote.breakdown).toEqual([
      { label: 'P2P route fare', amount: 100 },
      { label: 'P2P premium (+15%)', amount: 15 },
    ]);
  });

  it('rounds the P2P premium to 2 dp', () => {
    expect(quoteFareForLeg({ mode: 'p2p', distanceKm: 12, routeFare: 62.5 }).amount).toBe(71.88);
  });

  it('rejects a P2P leg without a route fare', () => {
    expect(() => quoteFareForLeg({ mode: 'p2p', distanceKm: 12 })).toThrow(RangeError);
    expect(() => quoteFareForLeg({ mode: 'p2p', distanceKm: 12, routeFare: -1 })).toThrow(
      RangeError,
    );
  });
});

describe('rail fares', () => {
  it('applies the 50% MRT-3 discount to the published band', () => {
    const quote = quoteFareForLeg({ mode: 'mrt3', distanceKm: 8.2 });
    // 13 + 15 × 8.2/16.9 = 20.28 → ₱20 published → ₱10 charged.
    expect(quote.amount).toBe(10);
    expect(quote.breakdown).toEqual([
      { label: 'MRT-3 published fare (8.2 km)', amount: 20 },
      { label: '50% rail discount', amount: -10 },
    ]);
    expect(quote.confidence).toBe('estimated');
    expect(quote.effective_from).toBe('2026-03-23');
    expect(quote.source_id).toBe('rail-fares');
  });

  it('rounds the published MRT-3 band to whole pesos before discounting', () => {
    // 13 + 15 × 4.4/16.9 = 16.905… → ₱17 published → ₱8.50 charged.
    expect(quoteFareForLeg({ mode: 'mrt3', distanceKm: 4.4 }).amount).toBe(8.5);
  });

  it('charges the MRT-3 minimum and maximum bands at the ends of the line', () => {
    expect(quoteFareForLeg({ mode: 'mrt3', distanceKm: 0 }).amount).toBe(6.5);
    expect(quoteFareForLeg({ mode: 'mrt3', distanceKm: 16.9 }).amount).toBe(14);
  });

  it('charges LRT-2 with its provisional band and marks it as such', () => {
    const quote = quoteFareForLeg({ mode: 'lrt2', distanceKm: 13.6 });
    expect(quote.amount).toBe(14);
    expect(quote.effective_from).toBe('2026-03-23');
    expect(quote.confidence).toBe('estimated');
    expect(quote.breakdown.map((line) => line.label)).toContain(
      'LRT-2 published fare (13.6 km, provisional band)',
    );
  });

  it('never discounts LRT-1', () => {
    const quote = quoteFareForLeg({ mode: 'lrt1', distanceKm: 5 });
    expect(quote.amount).toBe(23.6); // 16.25 + 1.47 × 5
    expect(quote.breakdown.map((line) => line.label)).not.toContain('50% rail discount');
    expect(quote.breakdown).toEqual([
      { label: 'LRT-1 boarding fare', amount: 16.25 },
      { label: 'LRT-1 distance charge (5 km × ₱1.47/km)', amount: 7.35 },
    ]);
    expect(quote.confidence).toBe('official');
    expect(quote.effective_from).toBe('2025-04-02');
    expect(quote.source_id).toBe('rail-fares');
  });

  it('charges the LRT-1 boarding fare alone at 0 km', () => {
    expect(quoteFareForLeg({ mode: 'lrt1', distanceKm: 0 }).amount).toBe(16.25);
  });

  it('charges LRT-1 ₱16.25 + ₱1.47/km at 10 km', () => {
    expect(quoteFareForLeg({ mode: 'lrt1', distanceKm: 10 }).amount).toBe(30.95);
  });

  it('rounds LRT-1 fares to 2 dp', () => {
    // 16.25 + 1.47 × 3.333 = 21.14951 → 21.15
    expect(quoteFareForLeg({ mode: 'lrt1', distanceKm: 3.333 }).amount).toBe(21.15);
  });
});

describe('ferry and free-ride overrides', () => {
  it('quotes the Pasig River Ferry at ₱0 with the MMDA source', () => {
    const quote = quoteFareForLeg({ mode: 'ferry', distanceKm: 3 });
    expect(quote.amount).toBe(0);
    expect(quote.currency).toBe('PHP');
    expect(quote.confidence).toBe('official');
    expect(quote.effective_from).toBe('2026-09-28');
    expect(quote.source_id).toBe('mmda-ferry');
    expect(quote.breakdown).toEqual([{ label: 'Pasig River Ferry (free)', amount: 0 }]);
  });

  it('overrides any mode to ₱0 for unverified free-ride service contracts', () => {
    const quote = quoteFareForLeg({ mode: 'jeepney', distanceKm: 5, freeRideOverride: true });
    expect(quote.amount).toBe(0);
    expect(quote.confidence).toBe('estimated');
    expect(quote.effective_from).toBe('2026-09-28');
    expect(quote.source_id).toBe('ltfrb-fares');
    expect(quote.breakdown).toEqual([
      { label: 'Free-ride service contract (unverified status)', amount: 0 },
    ]);
  });

  it('does not require a route fare when a P2P leg is a free ride', () => {
    const quote = quoteFareForLeg({
      mode: 'p2p',
      distanceKm: 12,
      freeRideOverride: true,
    });
    expect(quote.amount).toBe(0);
    expect(quote.confidence).toBe('estimated');
  });
});

describe('sumFares', () => {
  it('sums legs and keeps the oldest effective date', () => {
    const total = sumFares([
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
      quoteFareForLeg({ mode: 'mrt3', distanceKm: 8.2 }),
    ]);
    expect(total.amount).toBe(24);
    expect(total.currency).toBe('PHP');
    expect(total.effective_from).toBe('2026-03-23');
    expect(total.source_id).toBeNull();
    expect(total.confidence).toBe('estimated');
    expect(total.breakdown).toHaveLength(3);
  });

  it('keeps a single source and official confidence when every leg shares them', () => {
    const total = sumFares([
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 10 }),
    ]);
    expect(total.amount).toBe(40);
    expect(total.effective_from).toBe('2026-09-28');
    expect(total.source_id).toBe('ltfrb-fares');
    expect(total.confidence).toBe('official');
    expect(total.breakdown.every((line) => !line.label.startsWith('['))).toBe(true);
  });

  it('returns the earliest date across official and discounted legs', () => {
    const total = sumFares([
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
      quoteFareForLeg({ mode: 'mrt3', distanceKm: 8.2 }),
      quoteFareForLeg({ mode: 'lrt1', distanceKm: 5 }),
    ]);
    expect(total.amount).toBe(47.6);
    expect(total.effective_from).toBe('2025-04-02');
    expect(total.source_id).toBeNull();
    expect(total.confidence).toBe('estimated');
    // jeepney base (1) + MRT-3 published + discount (2) + LRT-1 boarding + distance (2)
    expect(total.breakdown).toHaveLength(5);
  });

  it('marks the total estimated only when a leg is estimated', () => {
    const officialOnly = sumFares([
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
      quoteFareForLeg({ mode: 'lrt1', distanceKm: 5 }),
    ]);
    expect(officialOnly.confidence).toBe('official');
    expect(officialOnly.effective_from).toBe('2025-04-02');
  });

  it('prefixes breakdown labels with the source when sources are mixed', () => {
    const total = sumFares([
      quoteFareForLeg({ mode: 'ferry', distanceKm: 3 }),
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
    ]);
    expect(total.amount).toBe(14);
    expect(total.source_id).toBeNull();
    expect(total.breakdown.map((line) => line.label)).toContain(
      '[mmda-ferry] Pasig River Ferry (free)',
    );
    expect(total.breakdown.map((line) => line.label)).toContain(
      '[ltfrb-fares] Traditional jeepney base fare (first 4 km)',
    );
  });

  it('rejects an empty itinerary instead of inventing a zero fare', () => {
    expect(() => sumFares([])).toThrow(RangeError);
  });
});

describe('isFareStale', () => {
  it('flags a matrix older than 183 days', () => {
    expect(isFareStale('2026-01-01', new Date('2026-11-01'))).toBe(true);
  });

  it('keeps a matrix younger than 183 days fresh', () => {
    expect(isFareStale('2026-09-28', new Date('2026-11-01'))).toBe(false);
  });

  it('treats exactly 183 days as fresh and 184 days as stale', () => {
    expect(isFareStale('2026-05-02', new Date('2026-11-01'))).toBe(false);
    expect(isFareStale('2026-05-01', new Date('2026-11-01'))).toBe(true);
  });

  it('defaults to today when no date is supplied', () => {
    expect(isFareStale('1900-01-01')).toBe(true);
  });

  it('does not flag a future effective date', () => {
    expect(isFareStale('2027-01-01', new Date('2026-11-01'))).toBe(false);
  });

  it('rejects malformed or impossible effective dates', () => {
    expect(() => isFareStale('28/09/2026')).toThrow(RangeError);
    expect(() => isFareStale('2026-02-31')).toThrow(RangeError);
  });
});

describe('data/fares files stay in sync with the engine', () => {
  it('quotes every row of fares-2026-09-28.yaml from its YAML values', () => {
    expect(matrix.matrix_id).toBe('ltfrb-puv-2026-09-28');
    expect(matrix.effective_from).toBe('2026-09-28');
    expect(matrix.source_id).toBe('ltfrb-fares');
    expect(matrix.currency).toBe('PHP');
    for (const row of matrix.fares) {
      const key = `${row.mode}:${row.class}`;
      const mode = MODE_BY_ROW[key];
      if (mode === undefined) {
        throw new Error(`No FareMode mapping for fare row ${key}`);
      }
      const quote = quoteFareForLeg({ mode, distanceKm: 12, routeFare: 100 });
      expect(quote.amount, `amount for ${key}`).toBe(expectedRowAmount(row));
      expect(quote.effective_from, `effective_from for ${key}`).toBe(matrix.effective_from);
    }
  });

  it('quotes every line of rail-tables.yaml from its YAML values', () => {
    for (const line of railTables.lines) {
      const mode = line.id as FareMode;
      const quote = quoteFareForLeg({ mode, distanceKm: 12 });
      expect(quote.effective_from, `effective_from for ${line.id}`).toBe(line.effective_from);
      expect(quote.confidence, `confidence for ${line.id}`).toBe(line.confidence);
      if (line.fare_model === 'formula') {
        if (line.boarding === undefined || line.per_km === undefined) {
          throw new Error(`${line.id} formula is missing boarding/per_km`);
        }
        expect(quote.amount, `amount for ${line.id}`).toBe(
          roundMoney(line.boarding + line.per_km * 12),
        );
      } else {
        if (
          line.min === undefined ||
          line.max === undefined ||
          line.length_km === undefined ||
          line.discount === undefined
        ) {
          throw new Error(`${line.id} band is missing min/max/length_km/discount`);
        }
        const published = Math.round(line.min + ((line.max - line.min) * 12) / line.length_km);
        expect(quote.amount, `amount for ${line.id}`).toBe(roundMoney(published * line.discount));
        expect(quote.breakdown.map((entry) => entry.label)).toContain('50% rail discount');
      }
    }
  });

  it('keeps the LRT-2 provisional band flagged for Task 11 verification', () => {
    const lrt2 = railTables.lines.find((line) => line.id === 'lrt2');
    expect(lrt2?.needs_verification).toBe(true);
    const quote = quoteFareForLeg({ mode: 'lrt2', distanceKm: 13.6 });
    expect(quote.breakdown[0]?.label).toContain('provisional band');
  });
});
