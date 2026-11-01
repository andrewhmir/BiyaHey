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
import { useT } from '../i18n/useT';
import { useBackTo } from '../lib/useBackTo';

/**
 * `/plan` — the route-options screen (Task 5, R58) and its lazy chunk boundary
 * (Task 10).
 *
 * This module owns the Option A container: full-bleed map with one polyline per
 * returned itinerary and a bottom sheet carrying the route-options list. It is
 * imported dynamically by `routes.tsx`, so neither MapLibre nor the Trip
 * detail/saved/provenance screens sit in the initial route payload.
 */

const PLAN_SHEET_DETENTS = [96, 'half', 'expanded'] as const;

interface PlanViewProps {
  origin: PlanPlaceInput;
  destination: PlanPlaceInput;
  originLabel?: string;
  destinationLabel?: string;
  onBack: () => void;
}

/**
 * The plan, the active filter and the selected itinerary live here so the card
 * emphasis and the highlighted line are always the same state.
 */
function PlanView({ origin, destination, originLabel, destinationLabel, onBack }: PlanViewProps) {
  const navigate = useNavigate();
  const { t } = useT();
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
  onBack,
}: {
  destination: PlanPlaceInput;
  destinationLabel?: string;
  onBack: () => void;
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
      originLabel={t('plan.originCurrent')}
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
export function PlanRoute() {
  const navigate = useNavigate();
  const { t } = useT();
  const goBack = useBackTo('/search');
  const [params] = useSearchParams();
  const destinationParam = params.get('dest');
  const originParam = params.get('from');
  const destination = useMemo(() => parsePoint(destinationParam), [destinationParam]);
  const fixedOrigin = useMemo(() => parsePoint(originParam), [originParam]);
  const destinationLabel = params.get('name') ?? undefined;
  const originName = params.get('fromName') ?? undefined;

  if (destination === null) {
    return (
      <PageNotice
        title={t('plan.missingDestTitle')}
        message={t('plan.missingDestMessage')}
        primary={{ label: t('plan.findPlace'), onClick: () => navigate('/search') }}
      />
    );
  }

  if (originParam !== null && fixedOrigin === null) {
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
