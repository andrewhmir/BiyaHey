import type { FareQuote, ItineraryDto } from '@biyahey/shared';
import { defaultT, type Translate } from '../i18n/strings';
import { formatFare } from './format';

/**
 * Fare copy shared by the Home recents and the saved/recent list.
 *
 * A stored itinerary can be `fareIncomplete`: at least one leg (today, every
 * tricycle leg) has no published fare, so `fare.amount` is only the sum of the
 * priced legs. Presenting that sum with the quote's `effective_from` date, the
 * way a complete fare is presented, would claim a complete matrix fare the BFF
 * never made. These helpers keep both surfaces honest:
 *
 * - complete fare → the unchanged `₱{amount} · fare effective {date}` line;
 * - partial sum → `Bahagyang pamasahe: ₱{amount}`, with no matrix date;
 * - every transit leg unpriced and a zero sum → `Walang publikadong pamasahe`,
 *   with no peso amount at all.
 *
 * The helper never recomputes a fare (R45) and never invents a date: it only
 * chooses which honest sentence describes the snapshot it was handed.
 */

/** True when at least one transit leg carries a published fare quote. */
export function hasPricedTransitLeg(itinerary: ItineraryDto): boolean {
  return itinerary.legs.some((leg) => leg.mode !== 'walk' && leg.fareNotPublished !== true);
}

/** The honest fare line for a saved/recent snapshot. */
export function fareRowLabel(
  itinerary: ItineraryDto,
  fare: FareQuote,
  t: Translate = defaultT,
): string {
  if (itinerary.fareIncomplete !== true) {
    return t('saved.fareLine', {
      amount: formatFare(fare.amount),
      date: fare.effective_from,
    });
  }
  if (fare.amount === 0 && !hasPricedTransitLeg(itinerary)) {
    return t('saved.fareNotPublished');
  }
  return t('saved.farePartial', { amount: formatFare(fare.amount) });
}
