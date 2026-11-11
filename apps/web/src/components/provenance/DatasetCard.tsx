import type { DataSource } from '@biyahey/shared';
import { ExternalLink } from 'lucide-react';
import { useCopy } from '../../i18n';
import { licenceName } from './licences';
import { urlsFrom } from './urls';

/** One provenance row: every fact is the API's own field, never re-typed here. */
export function DatasetCard({ dataset }: { dataset: DataSource }) {
  const { t } = useCopy();
  const derived = dataset.kind === 'derived';
  const licenceUrl = derived ? '' : dataset.licence_url;
  const sourceUrls = derived ? [] : urlsFrom(dataset.url);

  return (
    <article className="rounded-lg border border-line bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-bold leading-snug text-ink">{dataset.name}</h3>
          <p className="mt-0.5 break-words text-xs text-ink-faint">{dataset.publisher}</p>
        </div>
        {sourceUrls[0] !== undefined ? (
          <a
            href={sourceUrls[0]}
            target="_blank"
            rel="noreferrer"
            aria-label={`${dataset.name} — ${t('about.sourceHeading')}`}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-md border border-line text-brand transition hover:border-brand hover:bg-brand-tint"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-relaxed">
        <dt className="text-ink-faint">{t('about.licence')}</dt>
        <dd className="break-words text-ink">
          {derived ? (
            <span>{t('about.derivedLicence')}</span>
          ) : (
            <>
              {licenceUrl.length > 0 ? (
                <a
                  href={licenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline underline-offset-2"
                >
                  {licenceName(dataset.licence_spdx)}
                </a>
              ) : (
                <span className="font-medium">{licenceName(dataset.licence_spdx)}</span>
              )}
              <span className="block text-ink-faint">
                {t('about.spdx', { id: dataset.licence_spdx })}
              </span>
            </>
          )}
        </dd>
        <dt className="text-ink-faint">{t('about.lastChecked')}</dt>
        <dd className="text-ink">{dataset.last_checked}</dd>
        <dt className="text-ink-faint">{t('about.coverage')}</dt>
        <dd className="break-words text-ink">{dataset.coverage}</dd>
      </dl>

      <p className="mt-2 break-words text-xs leading-relaxed text-ink-soft">
        {dataset.attribution}
      </p>

      {derived && dataset.method !== undefined ? (
        <p className="mt-2 break-words text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">{t('about.methodHeading')}:</span>{' '}
          {dataset.method}
        </p>
      ) : null}
    </article>
  );
}
