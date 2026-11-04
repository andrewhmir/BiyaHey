import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/useT';
import type { Translate } from '../../i18n/strings';
import type { ProvenanceRow } from '../../lib/api';
import { DatasetCard } from './DatasetCard';
import { LicenceSheet } from './LicenceSheet';
import { useSources, type SourcesOutcome } from './useSources';

export interface AboutDataScreenProps {
  /** Route layer navigation back to where the rider came from. */
  onBack?: () => void;
}

/**
 * The polite live region's text. `error` deliberately returns nothing: the
 * `role="alert"` below already announces the failure assertively, and saying
 * the same sentence twice is what Task 9's M6 fixed. The count uses Taglish
 * `N na dataset` rather than the ungrammatical `N dataset`.
 */
function statusMessage(sources: SourcesOutcome, t: Translate): string {
  switch (sources.status) {
    case 'loading':
      return t('about.loading');
    case 'error':
      return '';
    case 'success':
      return t('about.count', { count: sources.datasets.length });
  }
}

/**
 * About-data screen (spec §11 screen 6, Task 7).
 *
 * L2: one `DatasetCard` per row `GET /sources` returned, in registry order.
 * L3: tapping a card opens `LicenceSheet` for that row. The screen renders only
 * API fields (plus the documented SPDX → name presentation mapping) — it never
 * carries its own attribution or licence table (R45).
 */
export function AboutDataScreen({ onBack }: AboutDataScreenProps) {
  const { t } = useT();
  const sources = useSources();
  const [selected, setSelected] = useState<ProvenanceRow | null>(null);
  // M5: the hook's typed error is used, not dead: a transport failure reads
  // differently from an HTTP/shape failure.
  const errorMessage =
    sources.error?.code === 'network' ? t('about.errorNetwork') : t('about.error');

  return (
    <main className="min-h-dvh bg-surface text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2">
          {onBack !== undefined ? (
            <button
              type="button"
              aria-label={t('common.back')}
              onClick={onBack}
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-col">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
              {t('home.brand')}
            </p>
            <h1 className="text-xl font-bold tracking-tight">{t('about.title')}</h1>
            <p className="text-sm text-on-surface-variant">{t('about.subtitle')}</p>
          </div>
        </div>
      </header>

      <div
        aria-busy={sources.status === 'loading'}
        className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4"
      >
        <p role="status" aria-live="polite" className="text-sm text-on-surface-variant">
          {statusMessage(sources, t)}
        </p>

        {sources.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-card border border-error-container bg-error-container px-4 py-3 text-on-error-container"
          >
            <p className="text-sm">{errorMessage}</p>
            <button
              type="button"
              onClick={sources.retry}
              className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {sources.status === 'success' ? (
          <ul aria-label={t('about.datasetsLabel')} className="flex flex-col gap-3">
            {sources.datasets.map((dataset) => (
              <li key={dataset.id}>
                <DatasetCard dataset={dataset} onOpen={setSelected} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {selected !== null ? (
        <LicenceSheet dataset={selected} onClose={() => setSelected(null)} />
      ) : null}
    </main>
  );
}
