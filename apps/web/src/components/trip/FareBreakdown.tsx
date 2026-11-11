import type { DataSource, FareQuote } from '@biyahey/shared';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCopy } from '../../i18n';
import { formatFare } from '../../lib/format';
import { hostOf, urlsFrom } from '../provenance/urls';

/** The provenance rows that price this quote (never hardcoded, never invented). */
export function fareSourceRows(
  fare: FareQuote,
  sources: readonly DataSource[],
): DataSource[] {
  if (fare.source_id !== null) {
    return sources.filter((source) => source.id === fare.source_id);
  }
  return sources.filter((source) => source.used_for.some((use) => /fare/i.test(use)));
}

export interface FareBreakdownProps {
  fare: FareQuote;
  /** Registry rows the itinerary used, already intersected by the caller. */
  sources: readonly DataSource[];
  /** True when at least one transit leg has no published fare. */
  incomplete: boolean;
}

/** Itemised API fare lines plus the quote's own effectivity date and source. */
export function FareBreakdown({ fare, sources, incomplete }: FareBreakdownProps) {
  const { t } = useCopy();
  const links = fareSourceRows(fare, sources);
  const unpublished = incomplete && fare.breakdown.length === 0;

  return (
    <section
      aria-labelledby="fare-heading"
      className="rounded-lg border border-line bg-white px-5 py-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h2
            id="fare-heading"
            className="text-xs font-semibold uppercase tracking-wide text-brand"
          >
            {t('trip.fareHeading')}
          </h2>
          {fare.confidence === 'estimated' ? (
            <span className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              {t('common.estimate')}
            </span>
          ) : null}
          {incomplete ? (
            <span className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              {t('fare.partial')}
            </span>
          ) : null}
        </div>
        <p className="shrink-0 text-xl font-bold tabular-nums tracking-tight text-ink">
          {incomplete
            ? t('fare.partialTotal', { amount: formatFare(fare.amount) })
            : t('fare.total', { amount: formatFare(fare.amount) })}
        </p>
      </div>

      {unpublished ? (
        <p className="mt-2 text-sm font-medium text-ink-soft">{t('fare.notPublished')}</p>
      ) : fare.breakdown.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t('fare.empty')}</p>
      ) : (
        <ul
          aria-label={t('fare.breakdownLabel')}
          className="mt-3 flex flex-col divide-y divide-line"
        >
          {fare.breakdown.map((line, index) => (
            <li
              key={`${line.label}-${index}`}
              className="flex items-start justify-between gap-3 py-1.5 text-sm leading-5"
            >
              <span className="min-w-0 break-words text-ink-soft">{line.label}</span>
              <span className="shrink-0 tabular-nums text-ink">
                {line.amount < 0 ? '−' : ''}₱{formatFare(Math.abs(line.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unpublished ? null : (
        <p className="mt-2 text-xs text-ink-faint">
          {t('fare.effective', { date: fare.effective_from })}
          {fare.source_id === null && fare.breakdown.length > 0
            ? ` · ${t('routes.fareMixed')}`
            : ''}
        </p>
      )}

      {links.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          <span>{t('fare.source')}</span>
          {links.flatMap((source) => {
            const urls = urlsFrom(source.url);
            if (urls.length === 0) {
              return [
                <span key={source.id} className="font-medium text-ink-soft">
                  {source.name}
                </span>,
              ];
            }
            return urls.map((href, index) => (
              <a
                key={`${source.id}-${index}`}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-brand underline underline-offset-2"
              >
                {index === 0 ? source.name : hostOf(href)}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ));
          })}
        </p>
      ) : null}

      <Link
        to="/sources"
        className="mt-2 inline-flex text-xs font-medium text-brand underline underline-offset-2"
      >
        {t('common.aboutData')}
      </Link>
    </section>
  );
}
