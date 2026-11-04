import type { FareQuote, ItineraryDto } from '@biyahey/shared';
import { describe, expect, it } from 'vitest';
import { applyPreferences } from '../src/domain/itinerary.js';

/**
 * R33: an itinerary whose `fareIncomplete` flag is set carries only the sum of
 * its priced legs (today: every tricycle-only plan has amount 0). The BFF's
 * `cheapest` sort must never put that partial sum above a complete fare.
 */

function quote(amount: number): FareQuote {
  return {
    amount,
    currency: 'PHP',
    confidence: 'official',
    effective_from: '2026-09-28',
    source_id: amount > 0 ? 'ltfrb-fares' : null,
    breakdown: amount > 0 ? [{ label: 'Fare', amount }] : [],
  };
}

function itinerary(
  id: string,
  amount: number,
  overrides: Partial<ItineraryDto> = {},
): ItineraryDto {
  return {
    id,
    durationMin: 20,
    startTime: '2026-11-02T08:00:00Z',
    endTime: '2026-11-02T08:20:00Z',
    transfers: 0,
    walkDistanceM: 0,
    modes: [],
    fare: quote(amount),
    sources: [],
    legs: [],
    ...overrides,
  };
}

describe('applyPreferences fare completeness (R33)', () => {
  it('sorts a complete fare before a cheaper incomplete one', () => {
    const partial = itinerary('partial', 0, { fareIncomplete: true, durationMin: 10 });
    const complete = itinerary('complete', 40, { durationMin: 30 });

    const ranked = applyPreferences([partial, complete], { cheapest: true });

    expect(ranked.map((entry) => entry.id)).toEqual(['complete', 'partial']);
  });

  it('keeps complete-before-incomplete when cheapest and fewest transfers combine', () => {
    const partial = itinerary('partial', 0, {
      fareIncomplete: true,
      durationMin: 5,
      transfers: 0,
    });
    const complete = itinerary('complete', 25, { durationMin: 45, transfers: 2 });

    const ranked = applyPreferences([partial, complete], {
      cheapest: true,
      fewestTransfers: true,
    });

    expect(ranked.map((entry) => entry.id)).toEqual(['complete', 'partial']);
  });

  it('orders fares inside each completeness group and stays stable on full ties', () => {
    const partialCheap = itinerary('partial-cheap', 0, { fareIncomplete: true });
    const partialPriced = itinerary('partial-priced', 5, { fareIncomplete: true });
    const completeForty = itinerary('complete-forty', 40);
    const completeTwentyA = itinerary('complete-twenty-a', 20);
    const completeTwentyB = itinerary('complete-twenty-b', 20);

    const ranked = applyPreferences(
      [partialCheap, completeForty, completeTwentyA, partialPriced, completeTwentyB],
      { cheapest: true },
    );

    // Complete group first (₱20 tie keeps the API order), then the partial group
    // (₱0 before ₱5). Completeness is the only new key; the old stability holds.
    expect(ranked.map((entry) => entry.id)).toEqual([
      'complete-twenty-a',
      'complete-twenty-b',
      'complete-forty',
      'partial-cheap',
      'partial-priced',
    ]);
  });

  it('leaves the fewest-transfers sort unchanged (it does not rank fares)', () => {
    const partial = itinerary('partial', 0, { fareIncomplete: true, transfers: 0 });
    const complete = itinerary('complete', 40, { transfers: 2 });

    const ranked = applyPreferences([complete, partial], { fewestTransfers: true });

    expect(ranked.map((entry) => entry.id)).toEqual(['partial', 'complete']);
  });
});
