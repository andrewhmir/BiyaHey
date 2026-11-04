import { Bookmark, Info, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { MapSlot } from '../components/layout/MapSlot';
import { MapView } from '../components/map/MapView';
import { AboutDataLink } from '../components/navigation/AboutDataLink';
import { BottomSheet, type SheetMapPadding } from '../components/sheet/BottomSheet';
import { LegStrip } from '../components/transit/LegStrip';
import {
  isWalkFallback,
  WalkEstimateBadge,
  WalkFallbackNotice,
  walkFallbackStat,
} from '../components/transit/WalkFallback';
import { useT } from '../i18n/useT';
import { formatFare } from '../lib/format';
import { itineraryEndpoints } from '../lib/itinerary';
import { readRecentTrips, type SavedTrip } from '../lib/savedTripsStore';
import { formatClockTime, formatLongDate } from '../lib/time';

const HOME_DETENTS = [96, 'half', 'expanded'] as const;

/** Spec §4.4: at most three recents are shown, however many the store keeps. */
export const HOME_RECENTS_LIMIT = 3;

export interface HomePageProps {
  /** Opens the search screen; the route layer supplies it (Task 4). */
  onSearchClick?: () => void;
  /** Opens the saved/recent screen; the route layer supplies it (Task 8). */
  onSavedClick?: () => void;
  /**
   * Opens a recent trip. The Lead wires this to `/trip/:id` in `routes.tsx`;
   * Home stays router-free so it can be rendered in isolation.
   */
  onOpenRecent?: (id: string) => void;
}

/**
 * The three newest recent trips.
 *
 * The read is defensive only: `readRecentTrips()` already never throws (the
 * device store swallows storage and quota errors), but a Home screen must never
 * crash because of a device-data read — the search pill above stays the entry
 * point even when the list is unavailable.
 */
function readHomeRecents(): SavedTrip[] {
  try {
    return readRecentTrips().slice(0, HOME_RECENTS_LIMIT);
  } catch {
    return [];
  }
}

// The live map sits under the sheet; the sheet owns the layout contract: peek
// by default, full-bleed map behind it, and a search pill that stays the app's
// primary call to action.
export function HomePage({ onSearchClick, onSavedClick, onOpenRecent }: HomePageProps = {}) {
  const [mapPadding, setMapPadding] = useState(0);
  const { t } = useT();
  const handleMapPaddingChange = useCallback((padding: SheetMapPadding) => {
    setMapPadding(padding.bottom);
  }, []);

  return (
    <AppShell
      map={
        <MapSlot mapPadding={mapPadding}>
          {/* Home never draws a plan: the map is the canvas behind the sheet
              until the rider has planned a trip. No route overlay is mounted. */}
          <MapView />
        </MapSlot>
      }
      sheet={
        <BottomSheet
          detents={HOME_DETENTS}
          initial="peek"
          label={t('home.sheetLabel')}
          onMapPaddingChange={handleMapPaddingChange}
        >
          <HomeSheetContent
            onSearchClick={onSearchClick}
            onSavedClick={onSavedClick}
            onOpenRecent={onOpenRecent}
          />
        </BottomSheet>
      }
    />
  );
}

/** One recent trip: endpoint title, duration/arrival, fare and its leg ribbon. */
function RecentTripRow({ trip, onOpen }: { trip: SavedTrip; onOpen?: (id: string) => void }) {
  const { t } = useT();
  const itinerary = trip.itinerary;
  const { from, to } = itineraryEndpoints(itinerary);
  const title =
    from.length === 0 && to.length === 0 ? itinerary.id : t('saved.titleLabel', { from, to });
  const arrival = formatClockTime(itinerary.endTime);
  const fare = formatFare(trip.fareSnapshot.amount);
  const savedOn = formatLongDate(trip.savedAt);
  const walkFallback = isWalkFallback(itinerary);
  // R45/R63: a stored snapshot's fare must carry its own matrix effectivity date
  // and a recent trip must say when it was opened — the same honesty rule the
  // saved list enforces, now on the Home surface too. A walk fallback has no
  // fare to date: its compact notice below carries the estimate, the honest
  // sentence and the >25 km warning, so this line only dates the recent view.
  const savedLine = savedOn === null ? null : t('saved.recentOn', { date: savedOn });
  const provenance = walkFallback
    ? savedLine
    : [
        t('saved.fareLine', { amount: fare, date: trip.fareSnapshot.effective_from }),
        savedLine,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
  // The row's accessible name is the honest summary; the leg ribbon/notice and
  // the provenance line are separate content. A fallback never announces a
  // fare: it names the badge and the walking estimate instead.
  const accessibleName = walkFallback
    ? `${t('walkFallback.badge')}, ${title}, ${walkFallbackStat(itinerary, t)}`
    : `${title}, ${itinerary.durationMin} min, ₱${fare}`;

  return (
    <li
      data-testid="recent-trip"
      className="relative flex w-full flex-col overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-elevation-1 transition hover:shadow-elevation-2"
    >
      <button
        type="button"
        aria-label={accessibleName}
        onClick={() => onOpen?.(itinerary.id)}
        // The ring must be drawn inside the clipped card (see RouteCard).
        className="absolute inset-0 rounded-card text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring"
      />
      <div className="pointer-events-none relative z-10 flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="break-words text-[15px] font-semibold leading-5 text-on-surface">
              {title}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant">
              <span className="font-semibold tabular-nums text-on-surface">
                {itinerary.durationMin} min
              </span>
              {arrival !== null ? <span>{t('trip.heroArrive', { arrival })}</span> : null}
            </span>
          </div>
          {walkFallback ? (
            <WalkEstimateBadge />
          ) : (
            <span className="shrink-0 rounded-pill border border-fare-border bg-fare-bg px-2.5 py-1 text-sm font-semibold tabular-nums text-on-fare-bg">
              {`₱${fare}`}
            </span>
          )}
        </div>
        {walkFallback ? (
          <WalkFallbackNotice itinerary={itinerary} badge={false} variant="compact" />
        ) : (
          <LegStrip legs={itinerary.legs} size="sm" />
        )}
        {provenance !== null ? (
          <p className="text-[10px] leading-4 text-on-surface-variant">{provenance}</p>
        ) : null}
      </div>
    </li>
  );
}

function HomeSheetContent({ onSearchClick, onSavedClick, onOpenRecent }: HomePageProps) {
  const { t } = useT();
  const recents = useMemo(readHomeRecents, []);

  return (
    <div className="flex flex-col gap-5 pb-2">
      {/* R54: only the first 48 px of content fits in the 96 px peek (96 px
          minus the 48 px drag handle), so the search pill must be the first
          element; the brand block, recents and doors follow it. */}
      <button
        type="button"
        onClick={onSearchClick}
        aria-label={t('search.placeholder')}
        className="flex min-h-12 w-full items-center gap-3 rounded-pill border border-outline bg-surface-container-lowest px-5 text-left text-base font-medium text-on-surface shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:shadow-none"
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-on-surface-variant">{t('search.placeholder')}</span>
      </button>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
          {t('home.eyebrow')}
        </p>
        <h1 className="text-2xl font-extrabold leading-8 tracking-tight text-on-surface">
          {t('home.brand')}
        </h1>
        <p className="text-sm leading-5 text-on-surface-variant">{t('home.tagline')}</p>
      </div>

      {/* Spec §4.4: up to three recents from the 30-day store, titled by their
          endpoints. No "nearby" data is inferred, and an empty list invites a
          plan instead of inventing trips. */}
      <section
        data-testid="home-recents"
        aria-labelledby="home-recents-heading"
        className="flex flex-col gap-2"
      >
        <h2
          id="home-recents-heading"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant"
        >
          {t('home.recentsHeading')}
        </h2>
        {recents.length === 0 ? (
          <p
            data-testid="home-recents-empty"
            className="rounded-card border border-dashed border-outline-variant bg-surface-container-low px-4 py-4 text-sm leading-5 text-on-surface-variant"
          >
            {t('home.recentsEmpty')}
          </p>
        ) : (
          <ul
            data-testid="home-recents-list"
            aria-label={t('home.recentsLabel')}
            className="flex flex-col gap-2"
          >
            {recents.map((trip) => (
              <RecentTripRow key={trip.itinerary.id} trip={trip} onOpen={onOpenRecent} />
            ))}
          </ul>
        )}
      </section>

      {/* Task 7's smallest honest "Settings" entry: there is no Settings screen
          in v1, so Home's sheet owns the About-data door. These two doors are
          the only non-recent destinations, so they stay real 48 dp targets. */}
      <div className="flex flex-col gap-2 border-t border-outline-variant pt-4">
        <div className="grid grid-cols-2 gap-2">
          {onSavedClick !== undefined ? (
            <button
              type="button"
              onClick={onSavedClick}
              className="flex min-h-12 items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-sm font-semibold text-on-surface shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container"
              >
                <Bookmark className="size-4" />
              </span>
              <span className="min-w-0 break-words">{t('home.saved')}</span>
            </button>
          ) : null}
          <AboutDataLink className="min-h-12 items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-on-surface shadow-elevation-1 transition hover:shadow-elevation-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
            >
              <Info className="size-4" />
            </span>
            <span className="min-w-0 break-words">
              {t('common.aboutData')}
              <span aria-hidden="true"> ⓘ</span>
            </span>
          </AboutDataLink>
        </div>
      </div>
    </div>
  );
}
