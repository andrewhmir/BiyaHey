import type { DataSource, FareQuote } from '@biyahey/shared';
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
 * from the plan response's `DataSource` rows:
 *
 * - a quote with `source_id` links that row;
 * - a mixed quote (`source_id: null`) links the fare-related rows the response
 *   actually contains (their `used_for` mentions fares);
 * - when no such row exists, no link is invented.
 */
export function fareSourceRows(fare: FareQuote, sources: readonly DataSource[]): DataSource[] {
  if (fare.source_id !== null) {
    return sources.filter((source) => source.id === fare.source_id);
  }
  return sources.filter((source) => source.used_for.some((use) => /fare/i.test(use)));
}

/**
 * The first URL a provenance row publishes.
 *
 * Registry rows can list more than one URL in `url` (the rail row lists LRTA
 * and LRMC). The first entry is the primary source link; nothing is fabricated
 * when the row carries no URL.
 */
export function primarySourceUrl(source: DataSource): string | undefined {
  const first = source.url
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .find((part) => /^https?:\/\//.test(part));
  return first;
}

export interface FareBreakdownProps {
  fare: FareQuote;
  /** Provenance rows from the same plan response (never hardcoded, R45). */
  sources: readonly DataSource[];
}

export function FareBreakdown({ fare, sources }: FareBreakdownProps) {
  const links = fareSourceRows(fare, sources);

  return (
    <footer
      data-testid="fare-breakdown"
      aria-labelledby="fare-breakdown-heading"
      className="rounded-card border border-fare-border bg-fare-bg px-4 py-4 text-on-fare-bg"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="fare-breakdown-heading" className="text-lg font-semibold tracking-tight">
          Pamasahe
        </h2>
        {fare.confidence === 'estimated' ? (
          <span
            data-testid="fare-estimate"
            className="rounded-pill border border-fare-border px-2 py-0.5 text-xs font-medium leading-4"
          >
            Estimate
          </span>
        ) : null}
      </div>

      {fare.breakdown.length === 0 ? (
        <p className="mt-2 text-sm">Walang bayad sa rutang ito.</p>
      ) : (
        <ul aria-label="Fare breakdown" className="mt-2 flex flex-col gap-1">
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
        Total ₱{formatFare(fare.amount)}
      </p>

      <p className="mt-1 text-xs leading-4">
        Effective {fare.effective_from}
        {fare.source_id === null && fare.breakdown.length > 0 ? ' · mixed fare sources' : ''}
      </p>

      {links.length > 0 ? (
        <p
          data-testid="fare-sources"
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        >
          <span>Source:</span>
          {links.map((source) => {
            const href = primarySourceUrl(source);
            return href === undefined ? (
              <span key={source.id}>{source.name}</span>
            ) : (
              <a
                key={source.id}
                data-testid="fare-source-link"
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {source.name}
              </a>
            );
          })}
        </p>
      ) : null}
    </footer>
  );
}
