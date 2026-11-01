import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { MapSlot } from '../components/layout/MapSlot';
import { MapCanvas } from '../components/map/MapCanvas';
import { RoutePolylines } from '../components/map/RoutePolylines';
import { AboutDataLink } from '../components/navigation/AboutDataLink';
import { BottomSheet, type SheetMapPadding } from '../components/sheet/BottomSheet';
import { useT } from '../i18n/useT';

const HOME_DETENTS = [96, 'half', 'expanded'] as const;

export interface HomePageProps {
  /** Opens the search screen; the route layer supplies it (Task 4). */
  onSearchClick?: () => void;
  /** Opens the saved/recent screen; the route layer supplies it (Task 8). */
  onSavedClick?: () => void;
}

// The live map sits under the sheet; the sheet owns the layout contract: peek
// by default, full-bleed map behind it, and a search pill that stays the app's
// primary call to action.
export function HomePage({ onSearchClick, onSavedClick }: HomePageProps = {}) {
  const [mapPadding, setMapPadding] = useState(0);
  const { t } = useT();
  const handleMapPaddingChange = useCallback((padding: SheetMapPadding) => {
    setMapPadding(padding.bottom);
  }, []);

  return (
    <AppShell
      map={
        <MapSlot mapPadding={mapPadding}>
          {/* The route overlay is wired into the real page tree from day one;
              its itinerary list stays empty until a plan response exists. */}
          <MapCanvas>
            <RoutePolylines itineraries={[]} />
          </MapCanvas>
        </MapSlot>
      }
      sheet={
        <BottomSheet
          detents={HOME_DETENTS}
          initial="peek"
          label={t('home.sheetLabel')}
          onMapPaddingChange={handleMapPaddingChange}
        >
          <HomeSheetContent onSearchClick={onSearchClick} onSavedClick={onSavedClick} />
        </BottomSheet>
      }
    />
  );
}

function HomeSheetContent({ onSearchClick, onSavedClick }: HomePageProps) {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* R54: only the first 48 px of content fits in the 96 px peek (96 px
          minus the 48 px drag handle), so the search pill must be first; the
          eyebrow and title follow it. */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex min-h-12 w-full items-center gap-3 rounded-pill border border-outline bg-surface-container-lowest px-6 text-left text-base font-medium text-on-surface shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:shadow-none"
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-on-surface-variant" />
        <span>{t('search.placeholder')}</span>
      </button>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-on-surface-variant">{t('home.eyebrow')}</p>
        <h1 className="text-2xl font-bold tracking-tight text-on-surface">{t('home.brand')}</h1>
      </div>
      <p className="text-sm text-on-surface-variant">{t('home.hint')}</p>
      {/* Task 7's smallest honest "Settings" entry: there is no Settings screen
          in v1, so Home's sheet owns the About-data door. Recorded as a
          proposed ruling in the Task 7 report. */}
      <div className="flex flex-col gap-2 border-t border-outline-variant pt-3">
        {onSavedClick !== undefined ? (
          <button
            type="button"
            onClick={onSavedClick}
            className="inline-flex min-h-12 items-center gap-1 self-start rounded-pill text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {t('home.saved')}
          </button>
        ) : null}
        {/* M1 (Task 7): a real 48 dp target, matching the map/fare entry links. */}
        <AboutDataLink className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          {t('common.aboutData')}
          <span aria-hidden="true">ⓘ</span>
        </AboutDataLink>
      </div>
    </div>
  );
}
