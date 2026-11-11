import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { useScrollTopOnMount } from '../components/trip/useScrollTop';
import { usePanelDetent } from '../components/Panel';
import { SavedTripRow } from '../components/saved/SavedTripRow';
import { useCopy } from '../i18n';
import { ApiError, fetchFaresStatus } from '../lib/api';
import {
  deleteSaved,
  listRecents,
  listSaved,
  renameSaved,
  saveTrip,
  tripTitle,
  type SavedTrip,
} from '../lib/saved';

const UNDO_WINDOW_MS = 6_000;

type Tab = 'saved' | 'recent';

type MatrixState =
  | { status: 'loading' }
  | { status: 'ready'; effectiveFrom: string }
  | { status: 'unavailable' };

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

/** Saved and recent trips: device snapshots, readable with or without a signal. */
export function Saved() {
  usePanelDetent('full');
  const { t } = useCopy();
  const online = useOnline();
  const [lists, setLists] = useState(() => ({ saved: listSaved(), recents: listRecents() }));
  const [matrix, setMatrix] = useState<MatrixState>({ status: 'loading' });
  const [announcement, setAnnouncement] = useState('');
  const [undo, setUndo] = useState<SavedTrip | null>(null);
  const [tab, setTab] = useState<Tab>('saved');
  const undoTimer = useRef<number | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const savedTabRef = useRef<HTMLButtonElement>(null);
  const recentTabRef = useRef<HTMLButtonElement>(null);
  const savedTabId = useId();
  const recentTabId = useId();
  const savedPanelId = useId();
  const recentPanelId = useId();
  const scrollRef = useScrollTopOnMount('saved');

  const reload = (): void => setLists({ saved: listSaved(), recents: listRecents() });

  const clearUndoTimer = (): void => {
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  // The only network call: the current PUV matrix date for the staleness label.
  // A failed or silent request can never blank the stored lists.
  useEffect(() => {
    if (!online) {
      setMatrix({ status: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setMatrix({ status: 'loading' });
    fetchFaresStatus(controller.signal)
      .then((status) => {
        if (active) setMatrix({ status: 'ready', effectiveFrom: status.effective_from });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'aborted') return;
        setMatrix({ status: 'unavailable' });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [online]);

  useEffect(() => {
    if (undo !== null) undoRef.current?.focus();
  }, [undo]);

  const matrixEffectiveFrom = matrix.status === 'ready' ? matrix.effectiveFrom : undefined;

  const handleDelete = (row: SavedTrip): void => {
    if (!deleteSaved(row.itinerary.id)) {
      setAnnouncement(t('saved.deleteFailed'));
      return;
    }
    reload();
    clearUndoTimer();
    setUndo(row);
    setAnnouncement(t('saved.deleted', { name: tripTitle(row) }));
    undoTimer.current = window.setTimeout(() => {
      setUndo(null);
      undoTimer.current = null;
    }, UNDO_WINDOW_MS);
  };

  const handleUndo = (): void => {
    if (undo === null) return;
    if (
      !saveTrip(undo.itinerary, undo.sources, { from: undo.fromLabel, to: undo.toLabel })
    ) {
      setAnnouncement(t('saved.restoreFailed'));
      return;
    }
    if (undo.nickname !== undefined) renameSaved(undo.itinerary.id, undo.nickname);
    clearUndoTimer();
    setUndo(null);
    reload();
    setAnnouncement(t('saved.restored'));
  };

  const handleRename = (id: string, nickname: string): boolean => {
    const renamed = renameSaved(id, nickname);
    reload();
    setAnnouncement(renamed ? t('saved.renamed') : t('saved.renameFailed'));
    return renamed;
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const next: Tab =
      event.key === 'Home'
        ? 'saved'
        : event.key === 'End'
          ? 'recent'
          : tab === 'saved'
            ? 'recent'
            : 'saved';
    setTab(next);
    (next === 'saved' ? savedTabRef : recentTabRef).current?.focus();
  };

  const tabClass = (selected: boolean): string =>
    `flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition ${
      selected ? 'bg-brand text-white shadow-sm' : 'text-ink-soft hover:bg-white'
    }`;

  return (
    <div ref={scrollRef} className="flex flex-col">
      <div className="px-5 pb-1 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{t('home.saved')}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{t('saved.title')}</h1>
        {!online ? (
          <p
            role="status"
            lang="en"
            className="mt-2 inline-flex rounded-md border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-semibold text-ink"
          >
            {t('saved.offlineBadge')}
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {undo !== null ? (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-navy px-3 py-2 text-xs text-white">
          <span className="mr-auto min-w-0 break-words">{t('saved.deletedToast')}</span>
          <button
            ref={undoRef}
            type="button"
            onClick={handleUndo}
            className="inline-flex min-h-12 items-center rounded-md bg-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/25"
          >
            {t('common.undo')}
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label={t('saved.tabsLabel')}
        onKeyDown={handleTabKeyDown}
        className="mx-5 mt-3 flex gap-1 rounded-md border border-line bg-canvas p-1"
      >
        <button
          ref={savedTabRef}
          type="button"
          role="tab"
          id={savedTabId}
          aria-selected={tab === 'saved'}
          aria-controls={savedPanelId}
          tabIndex={tab === 'saved' ? 0 : -1}
          onClick={() => setTab('saved')}
          className={tabClass(tab === 'saved')}
        >
          {t('saved.tabSaved')}
          <span className={tab === 'saved' ? 'text-white' : 'text-ink-faint'}>
            ({lists.saved.length})
          </span>
        </button>
        <button
          ref={recentTabRef}
          type="button"
          role="tab"
          id={recentTabId}
          aria-selected={tab === 'recent'}
          aria-controls={recentPanelId}
          tabIndex={tab === 'recent' ? 0 : -1}
          onClick={() => setTab('recent')}
          className={tabClass(tab === 'recent')}
        >
          {t('saved.tabRecent')}
          <span className={tab === 'recent' ? 'text-white' : 'text-ink-faint'}>
            ({lists.recents.length})
          </span>
        </button>
      </div>

      <section
        role="tabpanel"
        id={savedPanelId}
        aria-labelledby={savedTabId}
        hidden={tab !== 'saved'}
        className="mt-4 px-5"
      >
        {lists.saved.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center">
            <p className="text-sm text-ink-faint">{t('saved.empty')}</p>
            <Link
              to="/search"
              className="mt-3 inline-flex min-h-12 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
            >
              {t('saved.searchCta')}
            </Link>
          </div>
        ) : (
          <ul aria-label={t('saved.listLabel')} className="flex flex-col gap-2">
            {lists.saved.map((row) => (
              <SavedTripRow
                key={row.itinerary.id}
                row={row}
                kind="saved"
                matrixEffectiveFrom={matrixEffectiveFrom}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        role="tabpanel"
        id={recentPanelId}
        aria-labelledby={recentTabId}
        hidden={tab !== 'recent'}
        className="mt-4 px-5"
      >
        <p className="text-xs text-ink-faint">{t('saved.recentNote')}</p>
        {lists.recents.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-sm text-ink-faint">
            {t('saved.recentEmpty')}
          </div>
        ) : (
          <ul aria-label={t('saved.recentListLabel')} className="mt-2 flex flex-col gap-2">
            {lists.recents.map((row) => (
              <SavedTripRow
                key={row.itinerary.id}
                row={row}
                kind="recent"
                matrixEffectiveFrom={matrixEffectiveFrom}
              />
            ))}
          </ul>
        )}
      </section>

      <Footer />
    </div>
  );
}
