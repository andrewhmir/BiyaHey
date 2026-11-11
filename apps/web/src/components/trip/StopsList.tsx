import type { LegStopDto } from '@biyahey/shared';
import { formatClockTime } from '../../lib/format';
import { useCopy } from '../../i18n';

/** Board / intermediate / alight rows for one ride leg, in travel order. */
export function StopsList({ stops }: { stops: readonly LegStopDto[] }) {
  const { t } = useCopy();
  return (
    <ol
      aria-label={t('trip.stopsLabel')}
      className="mt-2 flex flex-col gap-0.5 rounded-md border border-line bg-canvas px-3 py-2"
    >
      {stops.map((stop, index) => {
        const board = index === 0;
        const alight = index === stops.length - 1;
        const time = formatClockTime(
          alight ? (stop.arrivalTime ?? stop.departureTime) : (stop.departureTime ?? stop.arrivalTime),
        );
        return (
          <li key={`${stop.stopId ?? stop.name}-${index}`} className="flex items-start gap-2.5 py-1">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                board || alight ? 'bg-brand' : 'bg-line-strong'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm leading-5 text-ink">{stop.name}</span>
              <span className="block text-xs text-ink-faint">
                {board ? t('trip.board') : alight ? t('trip.baba') : t('trip.passThrough')}
                {time === null ? '' : ` · ${time}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
