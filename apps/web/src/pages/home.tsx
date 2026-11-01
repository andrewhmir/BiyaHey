import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { MapSlot } from '../components/layout/MapSlot';
import { BottomSheet, type SheetMapPadding } from '../components/sheet/BottomSheet';

const HOME_DETENTS = [96, 'half', 'expanded'] as const;

// The map is still a placeholder (Task 3); the sheet already owns the layout
// contract: peek by default, full-bleed map behind it, and a search pill that
// stays the app's primary call to action.
export function HomePage() {
  const [mapPadding, setMapPadding] = useState(0);
  const handleMapPaddingChange = useCallback((padding: SheetMapPadding) => {
    setMapPadding(padding.bottom);
  }, []);

  return (
    <AppShell
      map={<MapSlot mapPadding={mapPadding} />}
      sheet={
        <BottomSheet
          detents={HOME_DETENTS}
          initial="peek"
          label="Home"
          onMapPaddingChange={handleMapPaddingChange}
        >
          <HomeSheetContent />
        </BottomSheet>
      }
    />
  );
}

function HomeSheetContent() {
  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* R54: only the first 48 px of content fits in the 96 px peek (96 px
          minus the 48 px drag handle), so the search pill must be first; the
          eyebrow and title follow it. */}
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 rounded-pill border border-outline bg-surface-container-lowest px-6 text-left text-base font-medium text-on-surface shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:shadow-none"
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-on-surface-variant" />
        <span>Saan ka pupunta?</span>
      </button>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-on-surface-variant">Plano ng biyahe</p>
        <h1 className="text-2xl font-bold tracking-tight text-on-surface">BiyaHey!</h1>
      </div>
      <p className="text-sm text-on-surface-variant">
        Hilahin pataas ang sheet para makapag-plano ng ruta.
      </p>
    </div>
  );
}
