import type { ItineraryDto } from '@biyahey/shared';
import { Pencil, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Translate } from '../../copy';
import { useCopy } from '../../i18n';
import { distanceLabel, formatClockTime, formatFare, formatLongDate } from '../../lib/format';
import { tripEndpoints, tripTitle, type SavedTrip } from '../../lib/saved';
import { ModeRibbon } from '../trip/ModeRibbon';
import { isWalkFallback } from '../trip/itinerary';
import { isPuvFare, stalenessOf } from './staleness';

function savedFareLabel(itinerary: ItineraryDto, t: Translate): string {
  const fare = itinerary.fare;
  if (itinerary.fareIncomplete !== true) {
    return t('saved.fareLine', {
      amount: formatFare(fare.amount),
      date: fare.effective_from,
    });
  }
  const priced = itinerary.legs.some((leg) => leg.mode !== 'walk' && leg.fareNotPublished !== true);
  if (fare.amount === 0 && !priced) return t('saved.fareNotPublished');
  return t('saved.farePartial', { amount: formatFare(fare.amount) });
}

export interface SavedTripRowProps {
  row: SavedTrip;
  kind: 'saved' | 'recent';
  /** Current PUV matrix date, or `undefined` while unknown (offline/loading). */
  matrixEffectiveFrom?: string;
  onDelete?: (row: SavedTrip) => void;
  onRename?: (id: string, nickname: string) => boolean;
}

/** One stored trip: opened by its full row, with rename/delete kept inline. */
export function SavedTripRow({
  row,
  kind,
  matrixEffectiveFrom,
  onDelete,
  onRename,
}: SavedTripRowProps) {
  const { t } = useCopy();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.nickname ?? '');
  const [confirming, setConfirming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const { itinerary } = row;
  const title = tripTitle(row);
  const { from, to } = tripEndpoints(row);
  const endpointsLine =
    from.length > 0 && to.length > 0
      ? t('saved.titleLabel', { from, to })
      : from.length > 0
        ? from
        : to;
  const walkFallback = isWalkFallback(itinerary);
  const stale = stalenessOf(row, matrixEffectiveFrom);
  const savedDate = formatLongDate(row.savedAt) ?? row.savedAt;
  const arrival = formatClockTime(itinerary.endTime);
  const dateLine =
    kind === 'saved'
      ? t('saved.savedOn', { date: savedDate })
      : t('saved.recentOn', { date: savedDate });

  const stalenessDetail =
    stale === 'expired'
      ? t('saved.expired')
      : stale === 'unknown'
        ? isPuvFare(row)
          ? t('saved.unknownPuv')
          : t('saved.unknownNonPuv')
        : stale === 'fare-changed' && matrixEffectiveFrom !== undefined
          ? t('saved.currentMatrix', { date: matrixEffectiveFrom })
          : null;

  const submitRename = (): void => {
    if (onRename === undefined) return;
    if (onRename(row.itinerary.id, draft)) {
      setEditing(false);
      setRenameError(null);
    } else {
      setRenameError(t('saved.renameFailedDetail'));
    }
  };

  return (
    <li className="rounded-lg border border-line bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-sm font-bold leading-snug text-ink">{title}</h2>
          {endpointsLine.length > 0 && endpointsLine !== title ? (
            <p className="mt-0.5 break-words text-xs text-ink-faint">{endpointsLine}</p>
          ) : null}
        </div>
        <Link
          to={`/trip/${itinerary.id}`}
          className="inline-flex min-h-12 shrink-0 items-center rounded-md border border-line px-3 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand-tint"
        >
          {t('common.open')}
        </Link>
      </div>

      <div className="mt-2">
        <ModeRibbon legs={itinerary.legs} label={t('saved.legStripLabel')} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
        <span>{dateLine}</span>
        {walkFallback ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {t('routes.walk', { distance: distanceLabel(itinerary.walkDistanceM) })}
            </span>
          </>
        )}
        {arrival !== null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('trip.heroArrive', { arrival })}</span>
          </>
        ) : null}
      </div>

      {walkFallback ? (
        <p className="mt-2 rounded-md bg-canvas px-2.5 py-1.5 text-xs text-ink-soft">
          {t('walkFallback.badge')} ·{' '}
          {t('walkFallback.stat', {
            distance: distanceLabel(itinerary.walkDistanceM),
            minutes: itinerary.durationMin,
          })}
        </p>
      ) : (
        <p className="mt-2 inline-flex max-w-full flex-wrap items-center rounded-md border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-soft">
          {savedFareLabel(itinerary, t)}
        </p>
      )}

      <p className="mt-1 text-xs text-ink-faint">
        <span lang="en">{t('trip.savedSnapshot')}</span>
        {' · '}
        {t('trip.summaryArrive', {
          minutes: itinerary.durationMin,
          arrival: arrival ?? itinerary.endTime,
        })}
      </p>

      {stale === 'fresh' && matrixEffectiveFrom !== undefined ? (
        <p className="mt-1 text-xs text-ink-faint">
          {t('saved.sameMatrix', { date: matrixEffectiveFrom })}
        </p>
      ) : null}
      {stale !== 'fresh' ? (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs leading-relaxed text-ink-soft">
          <p lang="en" className="font-semibold text-ink">
            {t('saved.changed')}
          </p>
          {stalenessDetail !== null ? <p className="mt-0.5">{stalenessDetail}</p> : null}
        </div>
      ) : null}

      {kind === 'saved' && (onRename !== undefined || onDelete !== undefined) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onRename !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setDraft(row.nickname ?? '');
                setRenameError(null);
                setEditing((current) => !current);
                setConfirming(false);
              }}
              aria-expanded={editing}
              aria-label={t('saved.renameLabel', { name: title })}
              className="inline-flex min-h-12 items-center gap-1 rounded-md border border-line px-3 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              {t('saved.rename')}
            </button>
          ) : null}
          {onDelete !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setEditing(false);
              }}
              aria-label={t('saved.deleteLabel', { name: title })}
              disabled={confirming}
              className="inline-flex min-h-12 items-center gap-1 rounded-md border border-line px-3 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/5 disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              {t('common.delete')}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming && onDelete !== undefined ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
          <p className="mr-auto text-xs font-semibold text-ink">Delete this saved trip?</p>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onDelete(row);
            }}
            className="inline-flex min-h-12 items-center rounded-md bg-danger px-3 text-xs font-semibold text-white transition hover:bg-danger/90"
          >
            {t('common.delete')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex min-h-12 items-center rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : null}

      {editing && onRename !== undefined ? (
        <form
          className="mt-2 flex flex-col gap-2 rounded-md bg-canvas p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <label htmlFor={inputId} className="text-xs font-semibold text-ink">
            {t('saved.renameHeading')}
          </label>
          <input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={endpointsLine}
            className="min-h-12 w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-ink-faint"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex min-h-12 items-center rounded-md bg-brand px-3 text-xs font-semibold text-white transition hover:bg-brand-strong"
            >
              {t('saved.renameSave')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setRenameError(null);
              }}
              className="inline-flex min-h-12 items-center rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              {t('common.cancel')}
            </button>
          </div>
          {renameError !== null ? (
            <p role="alert" className="text-xs text-danger">
              {renameError}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
