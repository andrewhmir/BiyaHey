import { Bookmark, Database, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { usePanelDetent } from '../components/Panel';
import { useCopy } from '../i18n';
import { mapActions } from '../map/store';
import { fareLabel, formatClockTime } from '../lib/format';
import { listRecents, tripTitle } from '../lib/saved';

/** Home: the search-first entry, on top of the live map. */
export function Home() {
  usePanelDetent('peek');
  const navigate = useNavigate();
  const { t } = useCopy();
  const [recents] = useState(() => listRecents().slice(0, 3));

  useEffect(() => {
    mapActions.reset();
  }, []);

  return (
    <div className="flex flex-col">
      <div className="px-5 pb-2 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t('home.eyebrow')}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">BiyaHey!</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('home.tagline')}</p>

        <button
          type="button"
          onClick={() => navigate('/search')}
          className="mt-4 flex h-12 w-full items-center gap-3 rounded-lg border border-line-strong bg-white px-4 text-left text-sm text-ink-faint shadow-sm transition hover:border-brand hover:text-ink"
        >
          <Search aria-hidden="true" className="size-5 shrink-0 text-ink-faint" />
          <span className="truncate">{t('home.searchPill')}</span>
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate('/saved')}
            className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:border-brand hover:bg-brand-tint"
          >
            <Bookmark aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <span className="truncate">{t('nav.saved')}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/sources')}
            className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:border-brand hover:bg-brand-tint"
          >
            <Database aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <span className="truncate">{t('nav.data')}</span>
          </button>
        </div>
      </div>

      <section className="px-5 pt-3" aria-label={t('home.recentsHeading')}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t('home.recentsHeading')}
        </h2>
        {recents.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-faint">
            {t('home.recentsEmpty')}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {recents.map((row) => (
              <li key={row.itinerary.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/trip/${row.itinerary.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left transition hover:border-brand hover:bg-brand-tint"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {tripTitle(row)}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {formatClockTime(row.itinerary.startTime)} ·{' '}
                      {t('routes.arrive')} {formatClockTime(row.itinerary.endTime)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold text-brand">
                      {fareLabel(row.itinerary.fare.amount)}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {row.itinerary.durationMin} min
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mx-5 mt-4 rounded-lg bg-brand-tint px-3 py-2.5 text-xs text-brand-deep">
        {t('home.offlineHint')}
      </p>
      <Footer />
    </div>
  );
}
