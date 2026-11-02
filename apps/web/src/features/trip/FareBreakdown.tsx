import type { DataSource, FareQuote } from '@biyahey/shared';
import { AboutDataLink } from '../../components/navigation/AboutDataLink';
import { useT } from '../../i18n/useT';
import { sourceHost, sourceUrls } from '../../lib/sourceUrls';
import { formatFare } from '../routes/RouteCard';

/**
 * Fare footer (spec §11 screen 4, spec §8.3, R45/R57).
 *
 * Every line is rendered exactly as the API's `FareQuote.breakdown` returned it;
 * the web app never recomputes a fare. The effectivity date is the quote's own
 * `effective_from`, and an `estimated` quote is labelled so a rail band or a
 * free-ride override is never presented as an official matrix fare.
 *
 * Breakdown lines carry no per-line source id, so the source link is derived
 * from the plan response's `DataSource` rows. The screen passes only the rows
 * the itinerary itself referenced, so a mixed quote cannot link a fare row that
 * belonged to a different returned option:
 *
 * - a quote with `source_id` links that row;
 * - a mixed quote (`source_id: null`) links the fare-related rows among those
 *   rows (their `used_for` mentions fares);
 * - when no such row exists, no link is invented.
 *
 * Task 9 (M7): a registry row can publish more than one URL (the rail row lists
 * LRTA and LRMC). The shared `sourceUrls()` helper splits the field and every
 * URL is rendered, so the second publisher is never silently dropped. Task 9
 * (M1) also gives each link a 48 dp target.
 */
export function fareSourceRows(fare: FareQuote, sources: readonly DataSource[]): DataSource[] {
  if (fare.source_id !== null) {
    return sources.filter((source) => source.id === fare.source_id);
  }
  return sources.filter((source) => source.used_for.some((use) => /fare/i.test(use)));
}

export interface FareBreakdownProps {
  fare: FareQuote;
  /** Provenance rows the itinerary used (already intersected; never hardcoded, R45). */
  sources: readonly DataSource[];
}

export function FareBreakdown({ fare, sources }: FareBreakdownProps) {
  const { t } = useT();
  const links = fareSourceRows(fare, sources);

  return (
    <footer
      data-testid="fare-breakdown"
      aria-labelledby="fare-breakdown-heading"
      className="rounded-card border border-fare-border bg-fare-bg px-4 py-4 text-on-fare-bg"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="fare-breakdown-heading" className="text-lg font-semibold tracking-tight">
          {t('common.fare')}
        </h2>
        {fare.confidence === 'estimated' ? (
          <span
            data-testid="fare-estimate"
            className="rounded-pill border border-fare-border px-2 py-0.5 text-xs font-medium leading-4"
          >
            {t('common.estimate')}
          </span>
        ) : null}
      </div>

      {fare.breakdown.length === 0 ? (
        <p className="mt-2 text-sm">{t('fare.empty')}</p>
      ) : (
        <ul aria-label={t('fare.breakdownLabel')} className="mt-2 flex flex-col gap-1">
          {fare.breakdown.map((line, index) => (
            <li
              key={`${line.label}-${index}`}
              data-testid="fare-line"
              className="flex items-start justify-between gap-3 text-sm leading-5"
            >
              <span className="min-w-0 break-words">{line.label}</span>
              <span className="shrink-0 tabular-nums">
                {line.amount < 0 ? '−' : ''}₱{formatFare(Math.abs(line.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p data-testid="fare-breakdown-total" className="mt-2 text-base font-semibold">
        {t('fare.total', { amount: formatFare(fare.amount) })}
      </p>

      <p className="mt-1 text-xs leading-4">
        {t('fare.effective', { date: fare.effective_from })}
        {fare.source_id === null && fare.breakdown.length > 0
          ? ` · ${t('routes.fareMixed')}`
          : ''}
      </p>

      {links.length > 0 ? (
        <p
          data-testid="fare-sources"
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        >
          <span>{t('fare.source')}</span>
          {links.flatMap((source) => {
            const urls = sourceUrls(source.url);
            if (urls.length === 0) {
              return [
                <span key={source.id} className="inline-flex min-h-12 items-center">
                  {source.name}
                </span>,
              ];
            }
            return urls.map((href, index) => (
              <a
                key={`${source.id}-${index}`}
                data-testid="fare-source-link"
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {index === 0 ? source.name : `${source.name} (${sourceHost(href)})`}
              </a>
            ));
          })}
        </p>
      ) : null}

      {/* Task 7: the fare footer is one of the ⓘ entry points into /sources. */}
      <p className="mt-2 text-xs">
        <AboutDataLink className="font-medium text-primary">
          {t('common.aboutData')} ⓘ
        </AboutDataLink>
      </p>
    </footer>
  );
}
