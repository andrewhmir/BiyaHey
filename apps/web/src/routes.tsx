import type { PlanPlaceInput } from '@biyahey/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { MapSlot } from './components/layout/MapSlot';
import { MapCanvas } from './components/map/MapCanvas';
import { RoutePolylines } from './components/map/RoutePolylines';
import { BottomSheet, type SheetMapPadding } from './components/sheet/BottomSheet';
import { SavedScreen } from './features/saved/SavedScreen';
import { AboutDataScreen } from './features/provenance/AboutDataScreen';
import {
  RouteOptionsScreen,
  rankItineraries,
  type RouteFilter,
} from './features/routes/RouteOptionsScreen';
import { cachedTrip } from './features/routes/planCache';
import { usePlan } from './features/routes/usePlan';
import { findSavedTrip, recordRecentTrip } from './lib/savedTripsStore';
import { SearchScreen } from './features/search/SearchScreen';
import { TripDetailScreen } from './features/trip/TripDetailScreen';
import { TripLiveScreen } from './features/trip/TripLiveScreen';
import { HomePage } from './pages/home';

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
    />
  );
}

const PLAN_SHEET_DETENTS = [96, 'half', 'expanded'] as const;

/**
 * Back follows the app's own history when there is one. A PWA deep link into
 * `/plan` is the first history entry, so `navigate(-1)` would leave the app;
 * that case falls back to `fallback` instead.
 */
function useBackTo(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const state: unknown = window.history.state;
    const idx =
      typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : undefined;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [fallback, navigate]);
}

/** `/plan`'s back goes to search (Minor 10). */
function useBackToSearch(): () => void {
  return useBackTo('/search');
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

interface PlanViewProps {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  originLabel?: string;
  destinationLabel?: string;
  onBack: () => void;
}

/**
 * `/plan`'s Option A container (R58): full-bleed map with one polyline per
 * returned itinerary, and a bottom sheet carrying the route-options list. The
 * plan, the active filter and the selected itinerary live here so the card
 * emphasis and the highlighted line are always the same state.
 */
function PlanView({ origin, destination, originLabel, destinationLabel, onBack }: PlanViewProps) {
  const navigate = useNavigate();
  const plan = usePlan(origin, destination);
  const [filter, setFilter] = useState<RouteFilter>('recommended');
  const [explicitSelection, setExplicitSelection] = useState<string | null>(null);
  const [mapPadding, setMapPadding] = useState(0);

  const ranked = useMemo(
    () => rankItineraries(plan.itineraries, filter),
    [plan.itineraries, filter],
  );
  const selectedId =
    explicitSelection !== null && ranked.some((itinerary) => itinerary.id === explicitSelection)
      ? explicitSelection
      : (ranked[0]?.id ?? null);

  const handleMapPaddingChange = useCallback((padding: SheetMapPadding) => {
    setMapPadding(padding.bottom);
  }, []);

  return (
    <AppShell
      map={
        <MapSlot mapPadding={mapPadding}>
          <MapCanvas sources={plan.sources}>
            <RoutePolylines
              itineraries={plan.itineraries}
              selectedId={selectedId}
              onSelect={setExplicitSelection}
            />
          </MapCanvas>
        </MapSlot>
      }
      sheet={
        <BottomSheet
          detents={PLAN_SHEET_DETENTS}
          initial="half"
          label="Mga ruta"
          onMapPaddingChange={handleMapPaddingChange}
        >
          <RouteOptionsScreen
            plan={plan}
            filter={filter}
            onFilterChange={setFilter}
            selectedId={selectedId}
            onSelect={setExplicitSelection}
            onOpenDetail={(id) => navigate(`/trip/${id}`)}
            originLabel={originLabel}
            destinationLabel={destinationLabel}
            onBack={onBack}
          />
        </BottomSheet>
      }
    />
  );
}

/** Parse a `lat,lon` pair from a query string; `null` when malformed. */
function parsePoint(value: string | null): PlanPlaceInput | null {
  if (value === null) {
    return null;
  }
  const parts = value.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [latText, lonText] = parts;
  if (latText.trim() === '' || lonText.trim() === '') {
    return null;
  }
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat, lon };
}

type OriginFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

type OriginState =
  | { status: 'locating' }
  | { status: 'ready'; point: PlanPlaceInput }
  | { status: 'missing'; reason: OriginFailure };

/** A device fix has to settle inside this window, or the screen says so. */
const ORIGIN_TIMEOUT_MS = 8_000;

/**
 * One bounded geolocation read for the origin (R56 proposal).
 *
 * The Task 3 map keeps its geolocation inline in `MapCanvas`, so `/plan` cannot
 * reuse a fix from it. This hook performs a single `getCurrentPosition` when a
 * `/plan?dest=...` link carries no `from` pair, and reports every failure
 * honestly instead of substituting an invented default origin.
 *
 * React 19 StrictMode double-invokes effects in development, so a dev session
 * can issue two reads; a production build performs exactly one.
 */
function useDeviceOrigin(attempt: number): OriginState {
  const [state, setState] = useState<OriginState>({ status: 'locating' });

  useEffect(() => {
    setState({ status: 'locating' });
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setState({ status: 'missing', reason: 'unsupported' });
      return;
    }

    let settled = false;
    const timer = window.setTimeout(
      () => settle({ status: 'missing', reason: 'timeout' }),
      ORIGIN_TIMEOUT_MS,
    );

    function settle(next: OriginState): void {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      setState(next);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        settle({
          status: 'ready',
          point: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          },
        });
      },
      (error) => {
        const reason: OriginFailure =
          error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        settle({ status: 'missing', reason });
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: ORIGIN_TIMEOUT_MS,
      },
    );

    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  return state;
}

const ORIGIN_FAILURE_COPY: Record<OriginFailure, { title: string; message: string }> = {
  denied: {
    title: 'Hindi pinayagan ang lokasyon',
    message:
      'Kailangan ng starting point para makapag-plano ng ruta. Payagan ang location sa browser, o pumili ng destinasyon mula sa search.',
  },
  timeout: {
    title: 'Matagal bago natagpuan ang lokasyon',
    message:
      'Kailangan ng starting point para makapag-plano ng ruta. Subukan ulit, o pumili ng destinasyon mula sa search.',
  },
  unavailable: {
    title: 'Hindi available ang lokasyon',
    message:
      'Hindi available ang lokasyon sa device na ito. Kailangan ng starting point para makapag-plano — pumili ng destinasyon mula sa search.',
  },
  unsupported: {
    title: 'Walang location sa device na ito',
    message:
      'Hindi sinusuportahan ng browser ang location. Kailangan ng starting point para makapag-plano — pumili ng destinasyon mula sa search.',
  },
};

interface PlanAction {
  label: string;
  onClick: () => void;
}

/** Honest full-page state: a title, a reason, and real ways forward. */
function PlanNotice({
  title,
  message,
  primary,
  secondary,
}: {
  title: string;
  message: string;
  primary: PlanAction;
  secondary?: PlanAction;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-on-surface">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-on-surface-variant">{message}</p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={primary.onClick}
          className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
        >
          {primary.label}
        </button>
        {secondary !== undefined ? (
          <button
            type="button"
            onClick={secondary.onClick}
            className="flex min-h-12 items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-6 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {secondary.label}
          </button>
        ) : null}
      </div>
    </main>
  );
}

function LocatedPlanRoute({
  destination,
  destinationLabel,
  onBack,
}: {
  destination: PlanPlaceInput;
  destinationLabel?: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const origin = useDeviceOrigin(attempt);

  if (origin.status === 'locating') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-on-surface">
        <h1 className="text-xl font-semibold tracking-tight">Naghahanap ng starting point</h1>
        <p role="status" aria-live="polite" className="text-sm text-on-surface-variant">
          Hinahanap ang lokasyon mo…
        </p>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="mt-2 flex min-h-12 items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-6 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Bumalik sa search
        </button>
      </main>
    );
  }

  if (origin.status === 'missing') {
    const copy = ORIGIN_FAILURE_COPY[origin.reason];
    // A browser with no geolocation cannot succeed on a retry, so offer the
    // honest way forward instead of a button that re-runs the same dead end.
    if (origin.reason === 'unsupported') {
      return (
        <PlanNotice
          title={copy.title}
          message={copy.message}
          primary={{ label: 'Bumalik sa search', onClick: () => navigate('/search') }}
        />
      );
    }
    return (
      <PlanNotice
        title={copy.title}
        message={copy.message}
        primary={{ label: 'Subukan ulit', onClick: () => setAttempt((current) => current + 1) }}
        secondary={{ label: 'Bumalik sa search', onClick: () => navigate('/search') }}
      />
    );
  }

  return (
    <PlanView
      origin={origin.point}
      destination={destination}
      originLabel="Kasalukuyang lokasyon"
      destinationLabel={destinationLabel}
      onBack={onBack}
    />
  );
}

/**
 * `/plan?dest=<lat>,<lon>&name=<label>[&from=<lat>,<lon>&fromName=<label>]`
 *
 * `SearchScreen` sends only the destination, so the origin normally comes from
 * one bounded device-geolocation read. `from`/`fromName` is the explicit
 * hand-off a future origin picker (or a shared deep link) can use. If neither
 * exists, the screen explains why no plan can be made — it never invents a
 * default origin.
 */
function PlanRoute() {
  const navigate = useNavigate();
  const goBack = useBackToSearch();
  const [params] = useSearchParams();
  const destinationParam = params.get('dest');
  const originParam = params.get('from');
  const destination = useMemo(() => parsePoint(destinationParam), [destinationParam]);
  const fixedOrigin = useMemo(() => parsePoint(originParam), [originParam]);
  const destinationLabel = params.get('name') ?? undefined;
  const originName = params.get('fromName') ?? undefined;

  if (destination === null) {
    return (
      <PlanNotice
        title="Walang destinasyon"
        message="Walang valid na destinasyon sa link. Pumili muna ng lugar sa search."
        primary={{ label: 'Maghanap ng lugar', onClick: () => navigate('/search') }}
      />
    );
  }

  if (originParam !== null && fixedOrigin === null) {
    return (
      <PlanNotice
        title="Hindi valid ang starting point"
        message="Hindi mabasa ang starting point sa link. Bumalik sa search at pumili ulit."
        primary={{ label: 'Bumalik sa search', onClick: () => navigate('/search') }}
      />
    );
  }

  if (fixedOrigin !== null) {
    return (
      <PlanView
        origin={fixedOrigin}
        destination={destination}
        originLabel={originName}
        destinationLabel={destinationLabel}
        onBack={goBack}
      />
    );
  }

  return (
    <LocatedPlanRoute
      destination={destination}
      destinationLabel={destinationLabel}
      onBack={goBack}
    />
  );
}

/**
 * `/trip/:id` — trip detail from the in-memory plan cache (R62), falling back
 * to the saved-trips store (Task 8).
 *
 * The plan response is the only source of a fresh itinerary; there is no
 * plan-by-id endpoint. A reload or offline deep link therefore has no cache, so
 * the saved snapshot is the honest fallback: it opens the full timeline and
 * labels the header "Saved route (no live data)" with its snapshot date. When
 * neither the cache nor the store has the id, the honest "wala nang ruta"
 * notice stays.
 */
function TripRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useBackToSearch();
  const cached = id === undefined ? undefined : cachedTrip(id);
  const stored = id === undefined ? undefined : findSavedTrip(id);

  // Opening a fresh plan makes it a recent trip; opening a saved snapshot does
  // not, so an old fare can never be re-stamped as newly updated.
  useEffect(() => {
    if (cached !== undefined) {
      recordRecentTrip(cached.itinerary, cached.sources);
    }
  }, [cached]);

  if (id === undefined) {
    return (
      <PlanNotice
        title="Wala nang ruta"
        message="Walang itinerary id sa link. Bumalik sa search at mag-plano ulit."
        primary={{ label: 'Bumalik sa search', onClick: () => navigate('/search') }}
      />
    );
  }

  if (cached === undefined && stored === undefined) {
    return (
      <PlanNotice
        title="Wala nang ruta"
        message="Hindi na available ang plan na ito sa device. Bumalik sa search at mag-plano ulit."
        primary={{ label: 'Bumalik sa search', onClick: () => navigate('/search') }}
      />
    );
  }

  if (cached !== undefined) {
    return (
      <TripDetailScreen
        itinerary={cached.itinerary}
        sources={cached.sources}
        onBack={goBack}
        onStartTrip={() => navigate(`/trip/${cached.itinerary.id}/live`)}
      />
    );
  }

  // Unreachable per the guard above, but keeps the store branch fully typed.
  if (stored === undefined) {
    return null;
  }

  return (
    <TripDetailScreen
      itinerary={stored.itinerary}
      sources={stored.sources}
      savedSnapshotAt={stored.savedAt}
      onBack={goBack}
      onStartTrip={() => navigate(`/trip/${stored.itinerary.id}/live`)}
    />
  );
}

/** `/trip/:id/live` — static tracking placeholder; never claims live data. */
function TripLiveRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <TripLiveScreen
      itineraryId={id}
      onBack={() => navigate(id === undefined ? '/search' : `/trip/${id}`)}
    />
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

export function AppRoutes() {
  return (
    <>
      <GlobalSearchShortcut />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/search" element={<SearchScreen />} />
        <Route path="/plan" element={<PlanRoute />} />
        <Route path="/trip/:id/live" element={<TripLiveRoute />} />
        <Route path="/trip/:id" element={<TripRoute />} />
        <Route path="/saved" element={<SavedRoute />} />
        <Route path="/sources" element={<AboutDataRoute />} />
      </Routes>
    </>
  );
}
