import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useT } from './i18n/useT';
import { useBackTo } from './lib/useBackTo';
import { HomePage } from './pages/home';

/**
 * Route table and code-splitting boundary (Task 10).
 *
 * Only Home is part of the initial route payload: it is the first screen and
 * the sheet/search pill must be interactive before the map chunk arrives. Every
 * non-home screen is a dynamic import, so the initial JS/CSS stays inside the
 * 250 KB gzip budget measured by `src/perf/bundle.test.ts`. The `/plan` chunk
 * itself owns MapLibre (via `MapView`) and the route-option cards; the trip,
 * saved and provenance screens are separate chunks.
 */
const SearchScreen = lazy(async () => {
  const module = await import('./features/search/SearchScreen');
  return { default: module.SearchScreen };
});

const PlanRoute = lazy(async () => {
  const module = await import('./pages/plan');
  return { default: module.PlanRoute };
});

const TripRoute = lazy(async () => {
  const module = await import('./pages/trip');
  return { default: module.TripRoute };
});

const TripLiveRoute = lazy(async () => {
  const module = await import('./pages/trip');
  return { default: module.TripLiveRoute };
});

const SavedScreen = lazy(async () => {
  const module = await import('./features/saved/SavedScreen');
  return { default: module.SavedScreen };
});

const AboutDataScreen = lazy(async () => {
  const module = await import('./features/provenance/AboutDataScreen');
  return { default: module.AboutDataScreen };
});

/**
 * The search pill is the Home screen's primary action. Keeping navigation in
 * the route layer lets `HomePage` stay renderable in isolation (its map test
 * mounts it without a router) while the real app wires `/` → `/search`.
 */
function HomeRoute() {
  const navigate = useNavigate();
  return (
    <HomePage
      onSearchClick={() => navigate('/search')}
      onSavedClick={() => navigate('/saved')}
      // UX v2: a recent-trip row re-opens that trip's detail (plan cache or the
      // saved snapshot); the row is rendered only when recents exist.
      onOpenRecent={(id) => navigate(`/trip/${id}`)}
    />
  );
}

const TYPING_TARGET_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || TYPING_TARGET_TAGS.has(target.tagName);
}

/**
 * Global `/` shortcut (Task 7, plan step 3).
 *
 * Pressing `/` outside a text field focuses search — the app's primary action —
 * from any screen. On `/search` itself it focuses the already-mounted field; on
 * every other route it navigates there (the field autofocuses on mount). It
 * never fires while the rider is typing or with a modifier held, so the key
 * stays a literal slash inside inputs.
 */
function GlobalSearchShortcut() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (location.pathname === '/search') {
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        return;
      }
      navigate('/search');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname, navigate]);

  return null;
}

/**
 * A lazy route is a network fetch on a slow phone, so show an announced loading
 * state instead of a blank page. The copy is generic (the route being loaded is
 * not known here) and comes from the string module.
 */
function RouteFallback() {
  const { t } = useT();
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-dvh items-center justify-center bg-surface text-on-surface"
    >
      <p className="text-sm text-on-surface-variant">{t('common.loading')}</p>
    </main>
  );
}

/** `/saved` — saved and recent trips (Task 8). */
function SavedRoute() {
  const navigate = useNavigate();
  const goBack = useBackTo('/');
  return (
    <SavedScreen
      onBack={goBack}
      onOpenTrip={(id) => navigate(`/trip/${id}`)}
      onSearch={() => navigate('/search')}
    />
  );
}

/** `/sources` — About data (Task 7); back to Home on a cold deep link. */
function AboutDataRoute() {
  const goBack = useBackTo('/');
  return <AboutDataScreen onBack={goBack} />;
}

/**
 * Reset the window scroll on navigation. Without this a push navigation keeps
 * the previous page's scroll offset, so opening `/trip/:id/live` from a scrolled
 * trip detail starts with the sticky header covering the map (and the map
 * camera is fitted while the first paint is half off-screen).
 */
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function AppRoutes() {
  return (
    <>
      <GlobalSearchShortcut />
      <ScrollToTopOnNavigate />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/plan" element={<PlanRoute />} />
          <Route path="/trip/:id/live" element={<TripLiveRoute />} />
          <Route path="/trip/:id" element={<TripRoute />} />
          <Route path="/saved" element={<SavedRoute />} />
          <Route path="/sources" element={<AboutDataRoute />} />
        </Routes>
      </Suspense>
    </>
  );
}
