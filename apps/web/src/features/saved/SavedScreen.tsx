import type { ItineraryDto } from '@biyahey/shared';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { formatLongDate, formatClockTime } from '../../lib/time';
import type { SavedTrip } from '../../lib/savedTripsStore';
import { formatFare } from '../routes/RouteCard';
import { stalenessOf } from './staleness';
import { useSavedTrips } from './useSavedTrips';

/**
 * Saved / recent (spec §11 screen 5, plan Task 8).
 *
 * Fully offline-readable: both tabs render the stored itinerary snapshot, the
 * full provenance rows and the fare + effectivity date the API returned, with
 * no network dependency. The only network call is the fare-matrix status used
 * for the staleness label; its failure or silence never clears the lists.
 *
 * Honesty rules this screen enforces:
 * - A saved ETA is never rendered without a label: "Saved route (no live data)"
 *   offline, "Saved snapshot (no live ETA)" online.
 * - Every fare shows its own `effective_from` date (global constraint).
 * - When the matrix date is unknown, the fare note says it *may* have changed
 *   instead of certifying freshness.
 * - Swipe-to-delete always has a visible, keyboard-reachable delete button, and
 *   every delete offers undo.
 */

const UNDO_WINDOW_MS = 6_000;

/** Human route name derived from the stored legs; never invented. */
export function routeLabel(itinerary: ItineraryDto): string {
  const first = itinerary.legs[0]?.from.name;
  const last = itinerary.legs[itinerary.legs.length - 1]?.to.name;
  if (first !== undefined && last !== undefined && first.length > 0 && last.length > 0) {
    return first === last ? first : `${first} → ${last}`;
  }
  return itinerary.id;
}

function tripName(trip: SavedTrip): string {
  return trip.nickname ?? routeLabel(trip.itinerary);
}

interface SavedTripCardProps {
  trip: SavedTrip;
  now: Date;
  online: boolean;
  matrixEffectiveFrom: string | undefined;
  testId: 'saved-row' | 'recent-row';
  onOpen: (id: string) => void;
  onDelete?: (trip: SavedTrip) => void;
  onRename?: (id: string, nickname: string) => boolean;
}

function SavedTripCard({
  trip,
  now,
  online,
  matrixEffectiveFrom,
  testId,
  onOpen,
  onDelete,
  onRename,
}: SavedTripCardProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trip.nickname ?? '');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const dragStart = useRef<number | null>(null);
  const currentOffset = useRef(0);
  const name = tripName(trip);
  const stale = stalenessOf(trip, matrixEffectiveFrom, now);
  const updated = formatLongDate(trip.savedAt) ?? trip.savedAt;
  const arrival = formatClockTime(trip.itinerary.endTime) ?? trip.itinerary.endTime;
  const etaLabel = online ? 'Saved snapshot (no live ETA)' : 'Saved route (no live data)';

  function moveTo(next: number): void {
    currentOffset.current = next;
    setOffset(next);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    dragStart.current = event.clientX;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (dragStart.current === null) {
      return;
    }
    const delta = event.clientX - dragStart.current;
    // Only a leftward drag reveals the delete affordance; vertical scrolling is
    // left to the browser (`touch-pan-y` on the row).
    moveTo(Math.max(-96, Math.min(0, delta)));
  }

  function endDrag(): void {
    if (dragStart.current === null) {
      return;
    }
    dragStart.current = null;
    const shouldDelete = currentOffset.current <= -72;
    moveTo(0);
    if (shouldDelete) {
      onDelete?.(trip);
    }
  }

  function submitRename(): void {
    if (onRename === undefined) {
      return;
    }
    if (onRename(trip.itinerary.id, draft)) {
      setEditing(false);
      setRenameError(null);
    } else {
      setRenameError('Hindi na-save ang pangalan. Subukan ulit.');
    }
  }

  return (
    <li className="relative overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-error-container text-sm font-semibold text-on-error-container"
      >
        I-delete
      </div>

      <div
        data-testid={testId}
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        className="relative touch-pan-y bg-surface-container-lowest px-4 py-3"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          dragStart.current = null;
          moveTo(0);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold leading-6 text-on-surface">
              {name}
            </h2>
            {trip.nickname !== undefined ? (
              <p className="break-words text-sm text-on-surface-variant">
                {routeLabel(trip.itinerary)}
              </p>
            ) : null}
          </div>
        </div>

        <p data-testid="saved-eta" className="mt-1 break-words text-sm text-on-surface-variant">
          <span className="font-medium text-on-surface">{etaLabel}</span>
          <span>
            {' '}
            · {trip.itinerary.durationMin} min · arrive {arrival}
          </span>
        </p>

        <p data-testid="saved-fare" className="mt-1 break-words text-sm text-on-surface">
          ₱{formatFare(trip.fareSnapshot.amount)} · fare effective{' '}
          {trip.fareSnapshot.effective_from}
        </p>

        <p
          data-testid="saved-updated"
          className="mt-1 break-words text-xs leading-4 text-on-surface-variant"
        >
          Last updated {updated}
        </p>

        {stale !== 'fresh' ? (
          <p
            data-testid="fare-staleness"
            className="mt-2 break-words rounded-field bg-tertiary-container px-3 py-2 text-sm text-on-tertiary-container"
          >
            Fare may have changed since you saved this.
          </p>
        ) : null}

        <p className="mt-1 break-words text-xs leading-4 text-on-surface-variant">
          {stale === 'expired'
            ? 'Mahigit 30 araw na ang snapshot na ito.'
            : stale === 'unknown'
              ? 'Hindi ma-check ang fare matrix ngayon.'
              : stale === 'fare-changed' && matrixEffectiveFrom !== undefined
                ? `Kasalukuyang fare matrix: ${matrixEffectiveFrom}.`
                : matrixEffectiveFrom !== undefined
                  ? `Pareho ang fare matrix (${matrixEffectiveFrom}) sa snapshot.`
                  : null}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(trip.itinerary.id)}
            className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-4 text-sm font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
          >
            Buksan
          </button>
          {onRename !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setDraft(trip.nickname ?? '');
                setRenameError(null);
                setEditing((current) => !current);
              }}
              aria-label={`Palitan ang pangalan ng ${name}`}
              aria-expanded={editing}
              className="flex min-h-12 items-center justify-center gap-1 rounded-pill border border-outline-variant px-4 text-sm font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Palitan
            </button>
          ) : null}
          {onDelete !== undefined ? (
            <button
              type="button"
              onClick={() => onDelete(trip)}
              aria-label={`I-delete ang ${name}`}
              data-testid="delete-saved"
              className="flex min-h-12 items-center justify-center gap-1 rounded-pill border border-outline-variant px-4 text-sm font-medium text-error transition hover:bg-error-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              I-delete
            </button>
          ) : null}
        </div>

        {editing && onRename !== undefined ? (
          <form
            className="mt-3 flex flex-col gap-2 rounded-field bg-surface-container-low p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <label htmlFor={inputId} className="text-sm font-medium text-on-surface">
              Pangalan ng biyahe
            </label>
            <input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder={routeLabel(trip.itinerary)}
              className="min-h-12 w-full rounded-field border border-outline bg-surface-container-lowest px-3 text-base text-on-surface placeholder:text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-4 text-sm font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                I-save ang pangalan
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setRenameError(null);
                }}
                className="flex min-h-12 items-center justify-center rounded-pill border border-outline-variant px-4 text-sm font-medium text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Kanselahin
              </button>
            </div>
            {renameError !== null ? (
              <p role="alert" className="text-sm text-error">
                {renameError}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </li>
  );
}

export interface SavedScreenProps {
  /** Fixed clock for deterministic expiry/staleness tests; defaults to now. */
  now?: Date;
  onBack?: () => void;
  /** Route layer supplies navigation; the screen itself stays router-free. */
  onOpenTrip?: (id: string) => void;
  onSearch?: () => void;
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-card border border-dashed border-outline-variant px-4 py-6 text-center text-sm text-on-surface-variant">
      {children}
    </li>
  );
}

export function SavedScreen({ now, onBack, onOpenTrip, onSearch }: SavedScreenProps = {}) {
  const controller = useSavedTrips(now);
  const evaluatedAt = now ?? new Date();
  const [tab, setTab] = useState<'saved' | 'recent'>('saved');
  const [undo, setUndo] = useState<SavedTrip | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const undoTimer = useRef<number | null>(null);
  const savedTabRef = useRef<HTMLButtonElement>(null);
  const recentTabRef = useRef<HTMLButtonElement>(null);
  const savedTabId = useId();
  const recentTabId = useId();
  const savedPanelId = useId();
  const recentPanelId = useId();

  useEffect(
    () => () => {
      if (undoTimer.current !== null) {
        window.clearTimeout(undoTimer.current);
      }
    },
    [],
  );

  function clearUndoTimer(): void {
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }

  function handleDelete(trip: SavedTrip): void {
    const label = tripName(trip);
    if (!controller.remove(trip.itinerary.id)) {
      setAnnouncement('Hindi na-delete ang biyahe. Subukan ulit.');
      return;
    }
    clearUndoTimer();
    setUndo(trip);
    setAnnouncement(`Nai-delete ang ${label}.`);
    undoTimer.current = window.setTimeout(() => {
      setUndo(null);
      undoTimer.current = null;
    }, UNDO_WINDOW_MS);
  }

  function handleUndo(): void {
    if (undo === null) {
      return;
    }
    if (!controller.restore(undo)) {
      setAnnouncement('Hindi naibalik ang biyahe. Subukan ulit.');
      return;
    }
    clearUndoTimer();
    setUndo(null);
    setAnnouncement('Naibalik ang biyahe.');
  }

  function handleRename(id: string, nickname: string): boolean {
    const renamed = controller.rename(id, nickname);
    setAnnouncement(renamed ? 'Napalitan ang pangalan ng biyahe.' : 'Hindi na-save ang pangalan.');
    return renamed;
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const next = tab === 'saved' ? 'recent' : 'saved';
    setTab(next);
    (next === 'saved' ? savedTabRef : recentTabRef).current?.focus();
  }

  const tabClass = (selected: boolean): string =>
    [
      'flex min-h-12 flex-1 items-center justify-center rounded-pill px-4 text-sm font-medium transition',
      selected
        ? 'bg-primary text-on-primary'
        : 'text-on-surface-variant hover:bg-surface-container',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ].join(' ');

  return (
    <main className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+6rem)] text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2 px-4 py-3">
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
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-lg font-semibold tracking-tight text-on-surface">
              Mga naka-save at kamakailan
            </h1>
            {!controller.online ? (
              <p
                data-testid="offline-badge"
                role="status"
                className="mt-1 inline-flex items-center rounded-pill bg-tertiary-container px-3 py-1 text-xs font-semibold text-on-tertiary-container"
              >
                Offline — saved routes only
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        <p role="status" aria-live="polite" data-testid="saved-status" className="sr-only">
          {announcement}
        </p>

        <div
          role="tablist"
          aria-label="Saved at recent na biyahe"
          onKeyDown={handleTabKeyDown}
          className="flex gap-1 rounded-pill border border-outline-variant bg-surface-container-low p-1"
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
            Saved
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
            Recent
          </button>
        </div>

        <section
          role="tabpanel"
          id={savedPanelId}
          aria-labelledby={savedTabId}
          hidden={tab !== 'saved'}
          className="flex flex-col gap-2"
        >
          <ul data-testid="saved-list" aria-label="Mga naka-save na biyahe" className="flex flex-col gap-3">
            {controller.saved.length === 0 ? (
              <EmptyRow>
                Wala ka pang naka-save na biyahe.
                {onSearch !== undefined ? (
                  <button
                    type="button"
                    onClick={onSearch}
                    className="mt-2 flex min-h-12 w-full items-center justify-center rounded-pill bg-primary px-4 text-sm font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    Maghanap ng ruta
                  </button>
                ) : null}
              </EmptyRow>
            ) : (
              controller.saved.map((trip) => (
                <SavedTripCard
                  key={trip.itinerary.id}
                  trip={trip}
                  now={evaluatedAt}
                  online={controller.online}
                  matrixEffectiveFrom={controller.currentMatrixEffectiveFrom}
                  testId="saved-row"
                  onOpen={(id) => onOpenTrip?.(id)}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))
            )}
          </ul>
        </section>

        <section
          role="tabpanel"
          id={recentPanelId}
          aria-labelledby={recentTabId}
          hidden={tab !== 'recent'}
          className="flex flex-col gap-2"
        >
          <p className="text-sm text-on-surface-variant">
            Awtomatikong nawawala ang mga kamakailang biyahe pagkatapos ng 30 araw.
          </p>
          <ul
            data-testid="recent-list"
            aria-label="Mga kamakailang biyahe"
            className="flex flex-col gap-3"
          >
            {controller.recents.length === 0 ? (
              <EmptyRow>Wala pang kamakailang biyahe.</EmptyRow>
            ) : (
              controller.recents.map((trip) => (
                <SavedTripCard
                  key={trip.itinerary.id}
                  trip={trip}
                  now={evaluatedAt}
                  online={controller.online}
                  matrixEffectiveFrom={controller.currentMatrixEffectiveFrom}
                  testId="recent-row"
                  onOpen={(id) => onOpenTrip?.(id)}
                />
              ))
            )}
          </ul>
        </section>
      </div>

      {undo !== null ? (
        <div
          data-testid="undo-toast"
          role="status"
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card bg-inverse-surface px-4 py-3 text-sm text-inverse-on-surface shadow-elevation-3"
        >
          <span className="min-w-0 break-words">Nai-delete ang biyahe.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="flex min-h-12 shrink-0 items-center justify-center rounded-pill px-4 text-sm font-semibold text-primary-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Undo
          </button>
        </div>
      ) : null}
    </main>
  );
}
