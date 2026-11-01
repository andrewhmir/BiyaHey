import type { DataSource } from '@biyahey/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { DatasetCard } from './DatasetCard';
import { LicenceSheet } from './LicenceSheet';
import { useSources, type SourcesOutcome } from './useSources';

export interface AboutDataScreenProps {
  /** Route layer navigation back to where the rider came from. */
  onBack?: () => void;
}

function statusMessage(sources: SourcesOutcome): string {
  switch (sources.status) {
    case 'loading':
      return 'Nilo-load ang mga pinagmulan ng datos…';
    case 'error':
      return 'Hindi ma-load ang mga pinagmulan ng datos. Subukan ulit.';
    case 'success':
      return `${sources.datasets.length} dataset`;
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
  const sources = useSources();
  const [selected, setSelected] = useState<DataSource | null>(null);

  return (
    <main className="min-h-dvh bg-surface text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2">
          {onBack !== undefined ? (
            <button
              type="button"
              aria-label="Bumalik"
              onClick={onBack}
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-semibold tracking-tight">Pinagmulan ng datos</h1>
            <p className="text-sm text-on-surface-variant">
              Saan galing ang bawat datos, at ano ang lisensya nito.
            </p>
          </div>
        </div>
      </header>

      <div
        aria-busy={sources.status === 'loading'}
        className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4"
      >
        <p role="status" aria-live="polite" className="text-sm text-on-surface-variant">
          {statusMessage(sources)}
        </p>

        {sources.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-card border border-error-container bg-error-container px-4 py-3 text-on-error-container"
          >
            <p className="text-sm">
              Hindi ma-load ang mga pinagmulan ng datos. Subukan ulit.
            </p>
            <button
              type="button"
              onClick={sources.retry}
              className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
            >
              Subukan ulit
            </button>
          </div>
        ) : null}

        {sources.status === 'success' ? (
          <ul aria-label="Mga dataset" className="flex flex-col gap-3">
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
