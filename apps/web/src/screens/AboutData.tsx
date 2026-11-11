import type { DataSource, FareStatusDto } from '@biyahey/shared';
import { Database } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Footer } from '../components/Footer';
import { usePanelDetent } from '../components/Panel';
import { DatasetCard } from '../components/provenance/DatasetCard';
import { useScrollTopOnMount } from '../components/trip/useScrollTop';
import { useCopy } from '../i18n';
import {
  ApiError,
  cachedFaresStatus,
  cachedSources,
  revalidateFaresStatus,
  revalidateSources,
} from '../lib/api';

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; network: boolean };

function failed(error: unknown): Loadable<never> {
  return {
    status: 'error',
    network: error instanceof ApiError && error.code === 'network',
  };
}

function SkeletonCard() {
  return (
    <div aria-hidden="true" className="animate-pulse rounded-lg border border-line bg-white px-4 py-4">
      <div className="h-3.5 w-2/3 rounded bg-line" />
      <div className="mt-2 h-2.5 w-1/2 rounded bg-line" />
      <div className="mt-3 h-2.5 w-full rounded bg-line" />
      <div className="mt-1.5 h-2.5 w-4/5 rounded bg-line" />
    </div>
  );
}

/** About data: where every dataset comes from and how fresh the fare matrix is. */
export function AboutData() {
  usePanelDetent('full');
  const { t } = useCopy();
  // A previous screen or the idle prefetch may already have the payload: paint
  // it on the first render instead of flashing a skeleton, then revalidate.
  const [sources, setSources] = useState<Loadable<DataSource[]>>(() => {
    const cached = cachedSources();
    return cached === undefined ? { status: 'loading' } : { status: 'ready', data: cached };
  });
  const [fares, setFares] = useState<Loadable<FareStatusDto>>(() => {
    const cached = cachedFaresStatus();
    return cached === undefined ? { status: 'loading' } : { status: 'ready', data: cached };
  });
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useScrollTopOnMount('about');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // A retry with nothing cached shows the skeleton again; a cached snapshot
    // stays on screen while this revalidation runs in the background.
    setSources((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    setFares((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    revalidateSources(controller.signal)
      .then((data) => {
        if (active) setSources({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'aborted') return;
        // Keep the cached snapshot when the background revalidation fails; the
        // error UI is for a cold visit that has no data to show at all.
        setSources((current) => (current.status === 'ready' ? current : failed(error)));
      });
    revalidateFaresStatus(controller.signal)
      .then((data) => {
        if (active) setFares({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'aborted') return;
        setFares((current) => (current.status === 'ready' ? current : failed(error)));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const errorMessage = (outcome: Loadable<unknown>): string =>
    outcome.status === 'error' && outcome.network ? t('about.errorNetwork') : t('about.error');

  const loading = sources.status === 'loading' || fares.status === 'loading';

  return (
    <div ref={scrollRef} className="flex flex-col" aria-busy={loading}>
      <div className="px-5 pb-1 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t('common.aboutData')}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{t('about.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('about.subtitle')}</p>
      </div>

      <section aria-labelledby="fare-status-heading" className="mt-4 px-5">
        <div className="rounded-lg border border-line bg-white px-4 py-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h2
              id="fare-status-heading"
              className="text-xs font-semibold uppercase tracking-wide text-brand"
            >
              {t('routes.fareMatrixLtfrb')}
            </h2>
            <Database aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
          </div>
          {fares.status === 'loading' ? (
            <p className="mt-2 text-sm text-ink-faint">{t('common.loading')}</p>
          ) : fares.status === 'error' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 text-sm text-ink-soft">
                {errorMessage(fares)}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((current) => current + 1)}
                className="inline-flex min-h-12 items-center rounded-md border border-line px-3 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand-tint"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold text-ink">
                {t('fare.effective', { date: fares.data.effective_from })}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {fares.data.stale
                  ? `Stale: checked on ${fares.data.checked_on}, more than ${fares.data.stale_after_days} days after the matrix took effect.`
                  : `Current: checked on ${fares.data.checked_on}, within the ${fares.data.stale_after_days}-day window.`}
              </p>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="datasets-heading" className="mt-5 px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="datasets-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t('about.datasetsLabel')}
          </h2>
          <p role="status" aria-live="polite" className="text-xs text-ink-faint">
            {sources.status === 'loading'
              ? t('about.loading')
              : sources.status === 'ready'
                ? t('about.count', { count: sources.data.length })
                : ''}
          </p>
        </div>

        {sources.status === 'error' ? (
          <div
            role="alert"
            className="mt-2 flex flex-col items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3"
          >
            <p className="text-sm text-ink-soft">{errorMessage(sources)}</p>
            <button
              type="button"
              onClick={() => setAttempt((current) => current + 1)}
              className="inline-flex min-h-12 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {sources.status === 'loading' ? (
          <div className="mt-2 flex flex-col gap-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : null}

        {sources.status === 'ready' ? (
          <ul aria-label={t('about.datasetsLabel')} className="mt-2 flex flex-col gap-2">
            {sources.data.map((dataset) => (
              <li key={dataset.id}>
                <DatasetCard dataset={dataset} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="method-heading" className="mt-5 px-5">
        <div className="rounded-lg border border-line bg-canvas px-4 py-3">
          <h2 id="method-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t('about.methodHeading')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Fares are transcribed from published government matrices (LTFRB, LRTA / LRMC, MRT-3)
            and are never estimated by BiyaHey!. Routes, stops and walking paths come from
            OpenStreetMap and GTFS feeds. Each dataset above lists its licence, coverage and the
            date it was last checked.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
