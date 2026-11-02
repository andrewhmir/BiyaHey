import type { PlanPlaceInput } from '@biyahey/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { MapSlot } from '../components/layout/MapSlot';
import { PageNotice } from '../components/layout/PageNotice';
import { MapView } from '../components/map/MapView';
import { RoutePolylines } from '../components/map/RoutePolylines';
import { BottomSheet, type SheetMapPadding } from '../components/sheet/BottomSheet';
import {
  RouteOptionsScreen,
  rankItineraries,
  type RouteFilter,
} from '../features/routes/RouteOptionsScreen';
import { usePlan } from '../features/routes/usePlan';
import {
  buildSearchPath,
  parseTripParams,
  type TripStop,
} from '../features/search/tripParams';
import { useT } from '../i18n/useT';

/**
 * `/plan` — the route-options screen (Task 5, R58) and its lazy chunk boundary
 * (Task 10).
 *
 * This module owns the Option A container: full-bleed map with one polyline per
 * returned itinerary and a bottom sheet carrying the route-options list. It is
 * imported dynamically by `routes.tsx`, so neither MapLibre nor the Trip
 * detail/saved/provenance screens sit in the initial route payload.
 *
 * The trip (origin, optional via stops, destination) is read from the URL
 * contract in `features/search/tripParams.ts`. Back/edit reopens `/search`
 * prefilled with the same trip, so a rider can change the starting point instead
 * of falling into the old dead end.
 */

const PLAN_SHEET_DETENTS = [96, 'half', 'expanded'] as const;

interface PlanViewProps {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  /** Optional via stops in travel order (R89). */
  stops: readonly TripStop[];
  originLabel?: string;
  destinationLabel?: string;
  onBack: () => void;
  onEditTrip: () => void;
}

/**
 * The plan, the active filter and the selected itinerary live here so the card
 * emphasis and the highlighted line are always the same state.
 */
function PlanView({
  origin,
  destination,
  stops,
  originLabel,
  destinationLabel,
  onBack,
  onEditTrip,
}: PlanViewProps) {
  const navigate = useNavigate();
  const { t } = useT();
  const plan = usePlan(origin, destination, stops);
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

  const stopLabels = useMemo(
    () => stops.map((stop) => stop.name).filter((name) => name.length > 0),
    [stops],
  );

  const handleMapPaddingChange = useCallback((padding: SheetMapPadding) => {
    setMapPadding(padding.bottom);
  }, []);

  return (
    <AppShell
      map={
        <MapSlot mapPadding={mapPadding}>
          <MapView sources={plan.sources}>
            <RoutePolylines
              itineraries={plan.itineraries}
              selectedId={selectedId}
              onSelect={setExplicitSelection}
            />
          </MapView>
        </MapSlot>
      }
      sheet={
        <BottomSheet
          detents={PLAN_SHEET_DETENTS}
          initial="half"
          label={t('plan.sheetLabel')}
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
            stopLabels={stopLabels}
            destinationLabel={destinationLabel}
            onBack={onBack}
            onEditTrip={onEditTrip}
          />
        </BottomSheet>
      }
    />
  );
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
 * honestly instead of substituting an invented default origin. The directions
 * form normally sends an explicit `from`, so this is the legacy/deep-link path.
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

const ORIGIN_FAILURE_KEYS: Record<OriginFailure, { title: string; message: string }> = {
  denied: {
    title: 'plan.originDeniedTitle',
    message: 'plan.originDeniedMessage',
  },
  timeout: {
    title: 'plan.originTimeoutTitle',
    message: 'plan.originTimeoutMessage',
  },
  unavailable: {
    title: 'plan.originUnavailableTitle',
    message: 'plan.originUnavailableMessage',
  },
  unsupported: {
    title: 'plan.originUnsupportedTitle',
    message: 'plan.originUnsupportedMessage',
  },
};

function LocatedPlanRoute({
  destination,
  destinationLabel,
  stops,
  onBack,
  onEditTrip,
}: {
  destination: PlanPlaceInput;
  destinationLabel?: string;
  stops: readonly TripStop[];
  onBack: () => void;
  onEditTrip: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useT();
  const [attempt, setAttempt] = useState(0);
  const origin = useDeviceOrigin(attempt);

  if (origin.status === 'locating') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-on-surface">
        <h1 className="text-xl font-semibold tracking-tight">{t('plan.locatingTitle')}</h1>
        <p role="status" aria-live="polite" className="text-sm text-on-surface-variant">
          {t('plan.locatingStatus')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="mt-2 flex min-h-12 items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-6 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {t('plan.backToSearch')}
        </button>
      </main>
    );
  }

  if (origin.status === 'missing') {
    const keys = ORIGIN_FAILURE_KEYS[origin.reason];
    const copy = { title: t(keys.title), message: t(keys.message) };
    // A browser with no geolocation cannot succeed on a retry, so offer the
    // honest way forward instead of a button that re-runs the same dead end.
    if (origin.reason === 'unsupported') {
      return (
        <PageNotice
          title={copy.title}
          message={copy.message}
          primary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
        />
      );
    }
    return (
      <PageNotice
        title={copy.title}
        message={copy.message}
        primary={{ label: t('common.retry'), onClick: () => setAttempt((current) => current + 1) }}
        secondary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
      />
    );
  }

  return (
    <PlanView
      origin={origin.point}
      destination={destination}
      stops={stops}
      originLabel={t('plan.originCurrent')}
      destinationLabel={destinationLabel}
      onBack={onBack}
      onEditTrip={onEditTrip}
    />
  );
}

/**
 * `/plan?from=<lat>,<lon>&fromName=<label>&dest=<lat>,<lon>&name=<label>[&via=…]`
 *
 * The directions form on `/search` always sends `from` and `dest` (plus any via
 * stops); the same contract is what a shared/deep link can carry. The legacy
 * device-origin path is kept only when the link has no `from` at all — a link
 * that *has* an unreadable `from` says so instead of guessing. If there is no
 * destination, the screen explains why no plan can be made; it never invents a
 * default origin or destination.
 */
export function PlanRoute() {
  const navigate = useNavigate();
  const { t } = useT();
  const [params] = useSearchParams();
  const parsed = useMemo(() => parseTripParams(params), [params]);
  const destination = parsed.dest;
  const fixedOrigin = parsed.from;
  const destinationLabel = parsed.destName ?? undefined;
  const originName = parsed.fromName ?? undefined;

  // Back/edit goes to the prefilled directions form, not to a dead end. It
  // replaces this history entry so the browser Back from the form cannot bounce
  // straight back into the stale plan.
  const searchPath = useMemo(() => buildSearchPath(parsed), [parsed]);
  const editTrip = useCallback(
    () => navigate(searchPath, { replace: true }),
    [navigate, searchPath],
  );

  if (destination === null) {
    return (
      <PageNotice
        title={t('plan.missingDestTitle')}
        message={t('plan.missingDestMessage')}
        primary={{ label: t('plan.findPlace'), onClick: () => navigate('/search') }}
      />
    );
  }

  if (parsed.hasFrom && fixedOrigin === null) {
    return (
      <PageNotice
        title={t('plan.badOriginTitle')}
        message={t('plan.badOriginMessage')}
        primary={{ label: t('plan.backToSearch'), onClick: () => navigate('/search') }}
      />
    );
  }

  if (fixedOrigin !== null) {
    return (
      <PlanView
        origin={fixedOrigin}
        destination={destination}
        stops={parsed.stops}
        originLabel={originName}
        destinationLabel={destinationLabel}
        onBack={editTrip}
        onEditTrip={editTrip}
      />
    );
  }

  return (
    <LocatedPlanRoute
      destination={destination}
      destinationLabel={destinationLabel}
      stops={parsed.stops}
      onBack={editTrip}
      onEditTrip={editTrip}
    />
  );
}
