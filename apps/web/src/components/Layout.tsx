import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useCopy } from '../i18n';
import { useMapState } from '../map/store';
import { Header } from './Header';
import { MapCredit } from './MapCredit';
import { Panel } from './Panel';

/** MapLibre is the one heavy dependency; it loads behind the shell. */
const MapCanvas = lazy(async () => {
  const module = await import('../map/MapCanvas');
  return { default: module.default };
});

function MapSkeleton() {
  return (
    <div className="size-full bg-[#eceff1]" role="region" aria-busy="true">
      <div className="flex size-full items-center justify-center text-sm text-ink-faint lg:hidden">
        <span className="sr-only">Map</span>
      </div>
    </div>
  );
}

/** App chrome + one persistent map + the screen panel. */
export function Layout() {
  const { t } = useCopy();
  const inset = useMapState().inset;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <a
        href="#main"
        className="sr-only rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
      >
        {t('app.skipToContent')}
      </a>
      <Header />
      <main id="main" className="relative flex-1 overflow-hidden lg:flex">
        <Panel>
          <Outlet />
        </Panel>
        <div className="absolute inset-0 z-0 lg:static lg:min-w-0 lg:flex-1">
          <Suspense fallback={<MapSkeleton />}>
            <MapCanvas />
          </Suspense>
          <div
            className="pointer-events-none absolute left-3 z-10"
            style={{ bottom: Math.max(12, inset.bottom + 12) }}
          >
            <MapCredit />
          </div>
        </div>
      </main>
    </div>
  );
}
