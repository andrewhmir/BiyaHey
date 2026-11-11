import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { usePanelDetent, type Detent } from './components/Panel';
import { LocaleProvider, useCopy } from './i18n';
import { Home } from './screens/Home';

/**
 * Route-level code splitting.
 *
 * `Home` is the entry screen, so its code ships in the entry chunk; every other
 * screen is a separate chunk that the browser fetches only when its route is
 * first visited. Opening the app no longer downloads the search, results,
 * trip, live, saved and sources screens just to paint the map.
 */
const Search = lazy(() => import('./screens/Search').then((module) => ({ default: module.Search })));
const Results = lazy(() => import('./screens/Results').then((module) => ({ default: module.Results })));
const Trip = lazy(() => import('./screens/Trip').then((module) => ({ default: module.Trip })));
const Live = lazy(() => import('./screens/Live').then((module) => ({ default: module.Live })));
const Saved = lazy(() => import('./screens/Saved').then((module) => ({ default: module.Saved })));
const AboutData = lazy(() =>
  import('./screens/AboutData').then((module) => ({ default: module.AboutData })),
);

/**
 * Suspense fallback for a lazy screen. It renders *inside* the Panel (the
 * screen's `<Outlet />` slot), so the header, map and bottom-sheet/sidebar
 * chrome never unmount while a chunk streams in. The fallback claims the same
 * detent the arriving screen will, so the sheet is already at its final height
 * when the real content swaps in — no layout jump. The skeleton is a plain
 * `line` token on a `canvas`-coloured panel: quiet, but clearly "loading".
 */
function PanelScreenFallback({ detent }: { detent: Detent }) {
  usePanelDetent(detent);
  const { t } = useCopy();

  return (
    <div role="status" aria-busy="true" className="flex flex-col pb-6">
      <span className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true" className="px-5 pb-3 pt-4">
        <div className="h-7 w-2/5 animate-pulse rounded-md bg-line" />
        <div className="mt-3 h-3 w-4/5 animate-pulse rounded bg-line" />
        <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-line" />
      </div>
      <div aria-hidden="true" className="mt-4 space-y-2 px-5">
        <div className="h-14 animate-pulse rounded-lg bg-line" />
        <div className="h-14 animate-pulse rounded-lg bg-line" />
      </div>
    </div>
  );
}

/** One lazy route: the screen plus a panel-shaped loading state for its chunk. */
function screen(Component: LazyExoticComponent<ComponentType>, detent: Detent) {
  return (
    <Suspense fallback={<PanelScreenFallback detent={detent} />}>
      <Component />
    </Suspense>
  );
}

export function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="search" element={screen(Search, 'full')} />
            <Route path="plan" element={screen(Results, 'half')} />
            <Route path="trip/:id" element={screen(Trip, 'half')} />
            <Route path="trip/:id/live" element={screen(Live, 'half')} />
            <Route path="saved" element={screen(Saved, 'full')} />
            <Route path="sources" element={screen(AboutData, 'full')} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
