import { History } from 'lucide-react';
import { useState } from 'react';
import { useCopy } from '../../i18n';
import { fareLabel, formatClockTime } from '../../lib/format';
import { listRecents, tripTitle } from '../../lib/saved';

/** Recent trips double as quick destinations on the idle search screen. */
export function RecentTrips({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useCopy();
  const [rows] = useState(() => listRecents().slice(0, 3));

  return (
    <section aria-label={t('home.recentsLabel')}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {t('home.recentsHeading')}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-faint">
          {t('home.recentsEmpty')}
        </p>
      ) : (
        <ul className="mt-2 flex list-none flex-col gap-2">
          {rows.map((row) => {
            const start = formatClockTime(row.itinerary.startTime);
            const end = formatClockTime(row.itinerary.endTime);
            return (
              <li key={row.itinerary.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.itinerary.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-brand hover:bg-brand-tint"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <History aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {tripTitle(row)}
                      </span>
                      {start !== null && end !== null ? (
                        <span className="block text-xs text-ink-faint">
                          {start} · {t('routes.arrive', { time: end })}
                        </span>
                      ) : null}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
