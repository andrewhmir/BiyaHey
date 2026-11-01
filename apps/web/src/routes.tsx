import type { PlanPlaceInput } from '@biyahey/shared';
import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { RouteOptionsScreen } from './features/routes/RouteOptionsScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { HomePage } from './pages/home';

// Placeholder screens: later tasks replace each one with its feature screen.
function PlaceholderScreen({ title }: { title: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-slate-500">Coming soon.</p>
    </main>
  );
}

/**
 * The search pill is the Home screen's primary action. Keeping navigation in
 * the route layer lets `HomePage` stay renderable in isolation (its map test
 * mounts it without a router) while the real app wires `/` → `/search`.
 */
function HomeRoute() {
  const navigate = useNavigate();
  return <HomePage onSearchClick={() => navigate('/search')} />;
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
}: {
  destination: PlanPlaceInput;
  destinationLabel?: string;
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
    <RouteOptionsScreen
      origin={origin.point}
      destination={destination}
      originLabel="Kasalukuyang lokasyon"
      destinationLabel={destinationLabel}
      onBack={() => navigate(-1)}
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
      <RouteOptionsScreen
        origin={fixedOrigin}
        destination={destination}
        originLabel={originName}
        destinationLabel={destinationLabel}
        onBack={() => navigate(-1)}
      />
    );
  }

  return (
    <LocatedPlanRoute destination={destination} destinationLabel={destinationLabel} />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/search" element={<SearchScreen />} />
      <Route path="/plan" element={<PlanRoute />} />
      <Route path="/trip/:id" element={<PlaceholderScreen title="Trip" />} />
      <Route path="/saved" element={<PlaceholderScreen title="Saved" />} />
      <Route path="/sources" element={<PlaceholderScreen title="Sources" />} />
    </Routes>
  );
}
