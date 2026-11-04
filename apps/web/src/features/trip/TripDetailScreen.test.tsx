import type { DataSource, FareQuote } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  WALK_FALLBACK_NOT_REALISTIC_KM,
  WALK_FALLBACK_NOT_REALISTIC_M,
} from '../../components/transit/WalkFallback';
import { defaultT } from '../../i18n/strings';
import { SAVED_TRIPS_KEY, readSavedTrips } from '../../lib/savedTripsStore';
import { AppRoutes } from '../../routes';
import {
  makeItinerary,
  makeLeg,
  makeRailTrip,
  makeWalkFallbackItinerary,
  makeWalkOnlyItinerary,
  WALK_ESTIMATE_SOURCE,
} from '../../test/fixtures/itinerary';
import {
  planCubaoAyalaResponse,
  planLong15LegsResponse,
  planMrt3CubaoAyalaResponse,
  planSuccessHandler,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { cachedTrip, clearPlanCache, rememberPlan } from '../routes/planCache';
import { FareBreakdown } from './FareBreakdown';
import { StopsList } from './StopsList';
import {
  TripDetailScreen,
  type TripMapRenderer,
  type TripMapRenderState,
} from './TripDetailScreen';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const MRT_PLAN = planMrt3CubaoAyalaResponse;
const MRT_ITINERARY = MRT_PLAN.itineraries[0]!;
const LONG_PLAN = planLong15LegsResponse;
const LONG_ITINERARY = LONG_PLAN.itineraries[0]!;
const LONG_NAME = 'Boni MRT-3 Station Northbound Stairs beside Boni Avenue Hall';

interface MapStub {
  calls: TripMapRenderState[];
  renderMap: TripMapRenderer;
}

/** `renderMap` double that records every state the screen hands to the map. */
function makeMapStub(): MapStub {
  const calls: TripMapRenderState[] = [];
  return {
    calls,
    renderMap: (state) => {
      calls.push(state);
      return (
        <div
          data-testid="map-stub"
          data-active-leg={state.activeLegIndex === null ? 'none' : String(state.activeLegIndex)}
        />
      );
    },
  };
}

function latestCall(stub: MapStub): TripMapRenderState {
  const call = stub.calls[stub.calls.length - 1];
  if (call === undefined) {
    throw new Error('renderMap was never called');
  }
  return call;
}

interface RenderDetailOptions {
  renderMap?: TripMapRenderer;
  savedSnapshotAt?: string;
  sources?: readonly DataSource[];
}

function renderDetail(
  itinerary = MRT_ITINERARY,
  { renderMap, savedSnapshotAt, sources = MRT_PLAN.sources }: RenderDetailOptions = {},
) {
  return render(
    <TripDetailScreen
      itinerary={itinerary}
      sources={sources}
      renderMap={renderMap}
      savedSnapshotAt={savedSnapshotAt}
    />,
  );
}

function renderApp(entry: string, plan?: typeof MRT_PLAN) {
  if (plan !== undefined) {
    rememberPlan(plan);
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** jsdom has no `scrollIntoView`; install a spy and undo it after each test. */
function stubScrollIntoView() {
  const spy = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: spy,
    writable: true,
    configurable: true,
  });
  return spy;
}

let user: UserEvent;

beforeEach(() => {
  user = userEvent.setup();
  localStorage.clear();
  clearPlanCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearPlanCache();
  delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
});

describe('TripDetailScreen', () => {
  /** A valid stored row; overrides let a test corrupt exactly one field. */
  function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      itinerary: MRT_ITINERARY,
      sources: MRT_PLAN.sources,
      fareSnapshot: MRT_ITINERARY.fare,
      datasetVersion: '2026-11-01',
      savedAt: '2026-11-01T08:00:00.000Z',
      ...overrides,
    };
  }

  function itineraryWithLegPatch(patch: Record<string, unknown>) {
    return {
      ...MRT_ITINERARY,
      legs: MRT_ITINERARY.legs.map((leg) => (leg.mode === 'mrt3' ? { ...leg, ...patch } : leg)),
    };
  }

  it('renders the sticky map header and hands renderMap the whole route by default', () => {
    const stub = makeMapStub();
    renderDetail(MRT_ITINERARY, { renderMap: stub.renderMap });

    expect(screen.getByTestId('trip-header')).toHaveClass('sticky');
    expect(screen.getByTestId('trip-header')).toHaveClass('top-0');
    expect(screen.getByTestId('trip-map')).toHaveAttribute('role', 'region');
    expect(screen.getByTestId('map-stub')).toBeInTheDocument();
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-active-leg', 'none');
    expect(latestCall(stub).itinerary).toBe(MRT_ITINERARY);
    expect(latestCall(stub).activeLegIndex).toBeNull();
    expect(screen.queryByTestId('trip-map-placeholder')).toBeNull();
  });

  it('renders an aria-hidden placeholder map when no renderer is supplied', () => {
    renderDetail();

    expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    const placeholder = screen.getByTestId('trip-map-placeholder');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder).toHaveClass('bg-surface-container-low');
    expect(screen.queryByTestId('map-stub')).toBeNull();
  });

  it('focuses a leg from its row header and syncs the map with the row state', async () => {
    const stub = makeMapStub();
    renderDetail(MRT_ITINERARY, { renderMap: stub.renderMap });

    const focusButtons = screen.getAllByTestId('leg-focus');
    expect(focusButtons).toHaveLength(3);
    // The accessible name carries the leg number so E2E/screen readers can
    // target one specific leg (Lead integration requirement).
    expect(focusButtons[1]).toHaveAccessibleName(/hakbang 2: sakay mrt-3 papuntang ayala/i);

    await user.click(focusButtons[1]!);

    const rows = screen.getAllByTestId('leg-row');
    expect(rows[1]).toHaveAttribute('aria-current', 'step');
    expect(rows[1]).toHaveAttribute('data-active', 'true');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(latestCall(stub).activeLegIndex).toBe(1);
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-active-leg', '1');

    // Re-pressing the focused row returns to the whole-route emphasis.
    await user.click(focusButtons[1]!);
    expect(screen.getAllByTestId('leg-row')[1]).not.toHaveAttribute('aria-current');
    expect(latestCall(stub).activeLegIndex).toBeNull();
  });

  it('focuses a leg from the interactive strip segment', async () => {
    const stub = makeMapStub();
    renderDetail(MRT_ITINERARY, { renderMap: stub.renderMap });

    const segments = screen.getAllByTestId('leg-strip-segment');
    expect(segments).toHaveLength(3);

    await user.click(segments[2]!);
    expect(latestCall(stub).activeLegIndex).toBe(2);
    expect(screen.getAllByTestId('leg-row')[2]).toHaveAttribute('aria-current', 'step');
    expect(segments[2]).toHaveAttribute('aria-pressed', 'true');

    await user.click(segments[2]!);
    expect(latestCall(stub).activeLegIndex).toBeNull();
    expect(screen.getAllByTestId('leg-row')[2]).not.toHaveAttribute('aria-current');
  });

  it('applies a leg tapped on the map to the timeline row', () => {
    const stub = makeMapStub();
    renderDetail(MRT_ITINERARY, { renderMap: stub.renderMap });

    const fromMap = latestCall(stub);
    act(() => fromMap.onSelectLeg(0));
    expect(screen.getAllByTestId('leg-row')[0]).toHaveAttribute('aria-current', 'step');

    act(() => latestCall(stub).onSelectLeg(null));
    expect(screen.getAllByTestId('leg-row')[0]).not.toHaveAttribute('aria-current');
  });

  it('scrolls the focused row into view, instantly under reduced motion', async () => {
    const scrollSpy = stubScrollIntoView();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    renderDetail();
    await user.click(screen.getAllByTestId('leg-strip-segment')[2]!);

    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
  });

  it('renders the landmark line only for legs whose landmarkHint is non-null', () => {
    const rail = makeRailTrip();
    expect(rail.legs.every((leg) => leg.landmarkHint === null)).toBe(true);
    const { unmount } = renderDetail(rail);
    expect(screen.queryAllByTestId('landmark-line')).toHaveLength(0);
    unmount();

    const hinted = makeItinerary([
      makeLeg({ mode: 'walk', landmarkHint: 'Farmers Plaza' }),
      makeLeg({ mode: 'mrt3', landmarkHint: null }),
    ]);
    renderDetail(hinted);

    const lines = screen.getAllByTestId('landmark-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Landmark: Farmers Plaza');
  });

  it('shows the API signage on a plate and the alight stop for ride legs', () => {
    renderDetail();

    expect(screen.getByTestId('signage-plate')).toHaveTextContent(/MRT-3 \/ Ayala/);
    expect(screen.getByTestId('signage-plate')).toHaveTextContent('Hanapin');
    expect(screen.getAllByTestId('alight-copy')[0]).toHaveTextContent('Baba sa Ayala');
    expect(screen.queryAllByTestId('alight-copy')).toHaveLength(1);
  });

  it('expands a ride leg to its stop list with the alight stop pinned last', async () => {
    renderDetail();

    await user.click(screen.getByRole('button', { name: /ipakita ang 3 hintuan/i }));

    const stops = screen.getAllByTestId('stop-row');
    expect(stops).toHaveLength(4);
    expect(stops[0]).toHaveTextContent('Cubao');
    expect(stops.at(-1)).toHaveAttribute('data-alight', 'true');
    expect(stops.at(-1)).toHaveTextContent('Ayala');
    expect(screen.getByTestId('stop-counter')).toHaveTextContent('3 hintuan · baba sa Ayala');
    expect(screen.getByRole('button', { name: /itago ang 3 hintuan/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('labels an informal transfer with the 5-minute buffer', () => {
    renderDetail(planCubaoAyalaResponse.itineraries[1]!, {
      sources: planCubaoAyalaResponse.sources,
    });

    expect(screen.getByText('Allow 5 min transfer')).toBeInTheDocument();
    expect(screen.getByTestId('informal-transfer')).toHaveTextContent('informal_transfer');
  });

  it('renders the fare breakdown with its source and effectivity date', () => {
    renderDetail();

    expect(screen.getByRole('heading', { name: 'Bayad sa biyahe' })).toBeInTheDocument();
    expect(screen.getByText(/mrt-3 published fare \(9\.26 km\)/i)).toBeInTheDocument();
    expect(screen.getByText(/effective 2026-03-23/i)).toBeInTheDocument();
    expect(screen.getByTestId('fare-estimate')).toHaveTextContent(/estimate/i);
    expect(screen.getByTestId('fare-breakdown-total')).toHaveTextContent('₱10.50');

    // M7: the rail row publishes two URLs; every one is rendered.
    const links = screen.getAllByRole('link', { name: /lrta/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://www.lrta.gov.ph/tickets-and-fares/');
    expect(links[1]).toHaveAttribute('href', 'https://lrmc.ph');
  });

  it('labels a saved snapshot honestly and refuses to re-date it', async () => {
    renderDetail(MRT_ITINERARY, { savedSnapshotAt: '2026-11-01T08:00:00.000Z' });

    const note = screen.getByTestId('saved-snapshot-note');
    expect(note).toHaveAttribute('lang', 'en');
    expect(note).toHaveTextContent(/saved route \(no live data\)/i);
    expect(note).toHaveTextContent(/last updated/i);

    const save = screen.getByTestId('save-trip');
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(readSavedTrips()).toEqual([]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('renders a walk-only itinerary without ride extras', () => {
    renderDetail(makeWalkOnlyItinerary());

    expect(screen.getAllByTestId('leg-row')).toHaveLength(1);
    expect(screen.queryAllByTestId('stop-counter')).toHaveLength(0);
    expect(screen.queryByTestId('signage-plate')).toBeNull();
    expect(screen.getByTestId('start-trip')).toBeVisible();
    expect(screen.getByTestId('fare-breakdown')).toBeInTheDocument();
  });

  it('renders the walk fallback honestly, with no fare or transit affordances', () => {
    const fallback = makeWalkFallbackItinerary();
    // Fixture precondition: the walk leg carries would-be transit fields so the
    // assertions below prove suppression rather than an absent fixture.
    expect(fallback.legs[0]!.routeShortName).toBe('MRT-3');
    expect(fallback.legs[0]!.signage).toBe('Look for: MRT-3');

    renderDetail(fallback);

    expect(screen.getByTestId('walk-fallback-badge')).toHaveTextContent(
      defaultT('walkFallback.badge'),
    );
    expect(screen.getByTestId('walk-fallback')).toHaveTextContent(
      defaultT('walkFallback.body'),
    );
    expect(screen.getByTestId('walk-fallback-stat')).toHaveTextContent('1.4 km');
    expect(screen.getByTestId('walk-fallback-stat')).toHaveTextContent('18 min');
    expect(screen.getAllByTestId('leg-row')).toHaveLength(1);
    expect(screen.queryByTestId('leg-strip')).toBeNull();
    expect(screen.queryByTestId('fare-total')).toBeNull();
    expect(screen.queryByTestId('fare-breakdown')).toBeNull();
    expect(screen.queryByTestId('fare-estimate')).toBeNull();
    expect(screen.queryByTestId('signage-plate')).toBeNull();
    expect(screen.queryByText(/look for:/i)).toBeNull();
    expect(screen.queryByText('MRT-3')).toBeNull();
  });

  it('keeps a provenance/About-data entry point on the fallback notice', () => {
    const fallback = makeWalkFallbackItinerary({ realPayload: true });
    renderDetail(fallback, { sources: [WALK_ESTIMATE_SOURCE as DataSource] });

    // The fallback suppresses the fare footer, so the notice itself must carry
    // the honest provenance statement and the `/sources` link (Minor 1).
    const provenance = screen.getByTestId('walk-fallback-provenance');
    expect(provenance).toHaveTextContent(defaultT('walkFallback.provenance'));
    expect(provenance).toHaveTextContent('BiyaHey!-computed walking estimate');
    // The derived row resolves to its attribution, never the raw id.
    expect(provenance).not.toHaveTextContent('walk-estimate');
    expect(provenance).not.toHaveTextContent('source unavailable');
    const link = within(provenance).getByRole('link');
    expect(link).toHaveAttribute('href', '/sources');
    expect(screen.queryByTestId('fare-breakdown')).toBeNull();

    // The real payload's generic endpoint names render as the honest walk
    // instruction; the timeline is the fallback's only leg detail.
    expect(screen.getByTestId('leg-instruction')).toHaveTextContent(
      'Maglakad papunta sa Destination',
    );
  });

  it('adds the translated walking-distance warning only beyond 25 km', () => {
    const { unmount } = renderDetail(
      makeWalkFallbackItinerary({ distanceM: WALK_FALLBACK_NOT_REALISTIC_M }),
    );
    expect(screen.queryByTestId('walk-fallback-warning')).toBeNull();
    unmount();

    renderDetail(
      makeWalkFallbackItinerary({ distanceM: WALK_FALLBACK_NOT_REALISTIC_M + 1 }),
    );
    expect(screen.getByTestId('walk-fallback-warning')).toHaveTextContent(
      defaultT('walkFallback.tooFar', { km: WALK_FALLBACK_NOT_REALISTIC_KM }),
    );
  });

  it('renders a cached itinerary without a fallback field exactly as before', () => {
    renderDetail();

    expect(screen.getByTestId('fare-total')).toHaveTextContent('₱10.50');
    expect(screen.getByTestId('fare-breakdown')).toBeInTheDocument();
    expect(screen.queryByTestId('walk-fallback')).toBeNull();
    expect(screen.queryByTestId('walk-fallback-badge')).toBeNull();
  });

  it('does not clip a 15-leg, 60-character-stop itinerary', () => {
    renderDetail(LONG_ITINERARY, { sources: LONG_PLAN.sources });

    expect(screen.getByTestId('fare-total')).toBeVisible();
    expect(screen.getByRole('button', { name: /simulan ang biyahe/i })).toBeVisible();
    expect(screen.getAllByTestId('leg-row')).toHaveLength(15);
    expect(screen.getAllByText(new RegExp(LONG_NAME)).length).toBeGreaterThan(0);

    // The map header is sticky; the page itself has no height cap or overflow
    // clipping that could cut off the 15-leg timeline.
    expect(screen.getByTestId('trip-header')).toHaveClass('sticky');
    expect(screen.getByTestId('trip-header')).toHaveClass('top-0');
    expect(screen.getAllByTestId('leg-instruction')[0]).toHaveClass('break-words');
  });

  it('has no axe violations with the stop list expanded', async () => {
    const { container } = renderDetail();
    await user.click(screen.getByRole('button', { name: /ipakita ang 3 hintuan/i }));

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('saves a fare snapshot with dataset version and saved_at', async () => {
    renderDetail();

    const save = screen.getByTestId('save-trip');
    expect(save).toBeEnabled();
    await user.click(save);

    const stored = readSavedTrips();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.itinerary.id).toBe(MRT_ITINERARY.id);
    expect(stored[0]?.fareSnapshot).toEqual(MRT_ITINERARY.fare);
    expect(stored[0]?.datasetVersion).toBe('2026-11-01');
    expect(Number.isNaN(Date.parse(stored[0]?.savedAt ?? ''))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent(/nai-save ang biyahe/i);
    expect(screen.getByTestId('save-trip')).toHaveTextContent('Nai-save');
  });

  it('disables Save for a detail opened from the saved store and keeps its snapshot (M1)', async () => {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([storedRow()]));
    renderApp(`/trip/${MRT_ITINERARY.id}`);

    expect(await screen.findByTestId('saved-snapshot-note')).toBeInTheDocument();
    const save = screen.getByTestId('save-trip');
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent('Nai-save');

    // Clicking must not re-date the snapshot and restart the 30-day clock.
    fireEvent.click(save);
    expect(readSavedTrips()[0]?.savedAt).toBe('2026-11-01T08:00:00.000Z');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('drops every malformed stored row whole instead of partially normalizing it', () => {
    const corruptRows: Record<string, unknown>[] = [
      // I1: a persisted stop list with null entries used to reach StopsList.
      storedRow({ itinerary: itineraryWithLegPatch({ stops: [null, null] }) }),
      storedRow({ savedAt: 'garbage' }),
      storedRow({ itinerary: { ...MRT_ITINERARY, id: '' } }),
      storedRow({ itinerary: { ...MRT_ITINERARY, durationMin: null } }),
      storedRow({ itinerary: { ...MRT_ITINERARY, walkDistanceM: undefined } }),
      storedRow({ itinerary: { ...MRT_ITINERARY, transfers: undefined } }),
      storedRow({ itinerary: { ...MRT_ITINERARY, modes: undefined } }),
      storedRow({ itinerary: itineraryWithLegPatch({ startTime: 'not-a-time' }) }),
      storedRow({ fareSnapshot: { ...MRT_ITINERARY.fare, source_id: 42 } }),
      storedRow({ fareSnapshot: { ...MRT_ITINERARY.fare, effective_from: 'not-a-date' } }),
      storedRow({ datasetVersion: undefined }),
      storedRow({ sources: undefined }),
    ];

    for (const row of corruptRows) {
      localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([row]));
      expect(readSavedTrips()).toEqual([]);
    }
  });

  it('renders a valid itinerary after dropping corrupt stop data', async () => {
    localStorage.setItem(
      SAVED_TRIPS_KEY,
      JSON.stringify([storedRow({ itinerary: itineraryWithLegPatch({ stops: [null, null] }) })]),
    );
    expect(readSavedTrips()).toEqual([]);

    // Rendering the valid itinerary must not crash: the corrupt store never
    // hands a null stop to StopsList.
    renderDetail();
    await user.click(screen.getByRole('button', { name: /ipakita ang 3 hintuan/i }));
    expect(screen.getAllByTestId('stop-row')).toHaveLength(4);
  });

  it('round-trips a valid saved row', () => {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([storedRow()]));

    const stored = readSavedTrips();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.itinerary).toEqual(MRT_ITINERARY);
    expect(stored[0]?.sources).toEqual(MRT_PLAN.sources);
    expect(stored[0]?.fareSnapshot).toEqual(MRT_ITINERARY.fare);
    expect(stored[0]?.datasetVersion).toBe('2026-11-01');
    expect(stored[0]?.savedAt).toBe('2026-11-01T08:00:00.000Z');
  });

  it('shows an honest failure status when storage rejects the save', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    renderDetail();

    await user.click(screen.getByTestId('save-trip'));

    expect(screen.getByRole('status')).toHaveTextContent(/hindi nai-save ang biyahe/i);
    expect(screen.getByTestId('save-trip')).toHaveTextContent('I-save');
    expect(readSavedTrips()).toEqual([]);
  });

  it('tolerates a corrupt saved-trips store and overwrites it on save', async () => {
    localStorage.setItem(SAVED_TRIPS_KEY, '{not-json');
    expect(readSavedTrips()).toEqual([]);

    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([null, { itinerary: { id: 'broken' } }]));
    expect(readSavedTrips()).toEqual([]);

    // A row whose itinerary parses but whose legs contain a null entry must be
    // dropped, not handed to the timeline renderer.
    localStorage.setItem(
      SAVED_TRIPS_KEY,
      JSON.stringify([
        {
          itinerary: { ...MRT_ITINERARY, legs: [null] },
          sources: MRT_PLAN.sources,
          fareSnapshot: MRT_ITINERARY.fare,
          datasetVersion: '2026-11-01',
          savedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(readSavedTrips()).toEqual([]);

    renderDetail();
    await user.click(screen.getByTestId('save-trip'));

    expect(readSavedTrips()).toHaveLength(1);
  });

  it('never invents a source link for a mixed quote without fare rows', () => {
    const mixed: FareQuote = {
      ...MRT_ITINERARY.fare,
      source_id: null,
      breakdown: [{ label: '[ltfrb-fares] Traditional jeepney base fare', amount: 14 }],
    };

    const { container } = render(<FareBreakdown fare={mixed} sources={[]} />);

    expect(container.querySelector('[data-testid="fare-source-link"]')).toBeNull();
    expect(screen.getByText(/mixed fare sources/i)).toBeInTheDocument();
  });

  it('links the fare-related rows for a mixed quote', () => {
    const mixed: FareQuote = {
      ...MRT_ITINERARY.fare,
      source_id: null,
      breakdown: [{ label: '[ltfrb-fares] Traditional jeepney base fare', amount: 14 }],
    };

    render(<FareBreakdown fare={mixed} sources={planCubaoAyalaResponse.sources} />);

    expect(screen.getByRole('link', { name: /LTFRB fare matrix/i })).toHaveAttribute(
      'href',
      'https://ltfrb.gov.ph',
    );
  });

  it('links only the fare rows the itinerary used for a mixed quote', () => {
    const unrelatedFare: DataSource = {
      id: 'crowd-reports',
      name: 'Unrelated fare table',
      publisher: 'Example',
      url: 'https://example.test/fares',
      licence_spdx: 'CC0-1.0',
      licence_url: 'https://example.test/licence',
      coverage: 'NCR',
      last_checked: '2026-11-01',
      attribution: 'Example',
      used_for: ['fare lookup'],
    };

    render(
      <TripDetailScreen
        itinerary={{ ...MRT_ITINERARY, fare: { ...MRT_ITINERARY.fare, source_id: null } }}
        sources={[...MRT_PLAN.sources, unrelatedFare]}
      />,
    );

    // The rail row is one of this itinerary's own sources; the extra fare row
    // belongs to another returned option and must not be linked. Both rail URLs
    // are rendered (M7), so keep the exact count and hrefs rather than `> 0`.
    const railLinks = screen.getAllByRole('link', { name: /lrta/i });
    expect(railLinks).toHaveLength(2);
    expect(railLinks.map((link) => link.getAttribute('href'))).toEqual([
      'https://www.lrta.gov.ph/tickets-and-fares/',
      'https://lrmc.ph',
    ]);
    expect(screen.queryByRole('link', { name: /unrelated fare table/i })).toBeNull();
  });

  it('virtualises a stop list longer than 30 rows and keeps the alight row last', () => {
    const manyStops = Array.from({ length: 40 }, (_value, index) => ({
      name: `Stop ${index + 1}`,
      lat: 14.6,
      lon: 121,
    }));
    manyStops[39] = { name: 'Ayala', lat: 14.55, lon: 121.02 };

    render(<StopsList stops={manyStops} />);

    expect(screen.getByTestId('stops-scroll')).toBeInTheDocument();
    const rows = screen.getAllByTestId('stop-row');
    expect(rows.length).toBeLessThan(40);
    expect(rows.at(-1)).toHaveAttribute('data-alight', 'true');
    expect(rows.at(-1)).toHaveTextContent('Ayala');
  });
  it('shows a tricycle leg with an unpublished fare and a partial total', () => {
    const itinerary = makeItinerary(
      [
        makeLeg({ mode: 'walk' }),
        makeLeg({
          mode: 'tricycle',
          routeShortName: 'Wilson E-trike',
          headsign: 'Greenhills',
          signage: 'Look for: Wilson E-trike',
          fareNotPublished: true,
        }),
      ],
      {
        fareIncomplete: true,
        fare: {
          amount: 0,
          currency: 'PHP',
          confidence: 'official',
          effective_from: '2026-03-23',
          source_id: null,
          breakdown: [],
        },
      },
    );

    renderDetail(itinerary);

    expect(screen.getAllByTestId('leg-strip-segment')[1]).toHaveAttribute('data-mode', 'tricycle');
    expect(screen.getAllByTestId('leg-row')[1]).toHaveTextContent('Traysikel');
    expect(screen.getByTestId('fare-not-published')).toHaveTextContent(
      'Walang publikadong pamasahe',
    );
    // The total is labelled partial, never presented as a complete peso fare.
    expect(screen.getByTestId('fare-total')).toHaveTextContent('Bahagyang pamasahe ₱0');
    expect(screen.getByTestId('fare-breakdown-total')).toHaveTextContent(
      'Bahagyang pamasahe ₱0',
    );
    expect(screen.getByTestId('fare-incomplete')).toHaveTextContent(/hindi kasama sa total/i);
    // A zero total with no breakdown lines is not a free route and has no
    // matrix date of its own: the empty-fare and effectivity copy must be gone,
    // replaced by the honest unpublished sentence.
    expect(screen.getByTestId('fare-unpublished')).toHaveTextContent(
      'Walang publikadong pamasahe',
    );
    expect(screen.queryByText('Walang bayad sa rutang ito.')).toBeNull();
    expect(screen.queryByText(/^Effective /)).toBeNull();
    expect(screen.queryByText(/Effective 2026-03-23/)).toBeNull();
  });

  it('shows the terminal hint only on a walk leg that carries one', () => {
    const hinted = makeItinerary(
      [
        makeLeg({
          mode: 'walk',
          tricycleHint: { terminalName: 'Wilson E-trike Terminal', distanceM: 120 },
        }),
        makeLeg({ mode: 'tricycle', fareNotPublished: true }),
      ],
      {
        fareIncomplete: true,
        fare: {
          amount: 0,
          currency: 'PHP',
          confidence: 'official',
          effective_from: '2026-03-23',
          source_id: null,
          breakdown: [],
        },
      },
    );

    const { unmount } = renderDetail(hinted);
    const badge = screen.getByTestId('tricycle-hint');
    expect(badge).toHaveTextContent('Traysikel malamang dito — wala sa dataset');
    expect(badge).toHaveTextContent('Wilson E-trike Terminal');
    expect(badge).toHaveTextContent('120 m');
    expect(badge).toHaveAttribute('data-distance-m', '120');
    unmount();

    renderDetail(MRT_ITINERARY);
    expect(screen.queryByTestId('tricycle-hint')).toBeNull();
  });

  it('leaves a fully priced jeepney/bus itinerary unchanged', () => {
    const itinerary = makeItinerary(
      [
        makeLeg({ mode: 'walk' }),
        makeLeg({ mode: 'jeepney', routeShortName: 'T101', headsign: 'Novaliches' }),
        makeLeg({ mode: 'walk' }),
        makeLeg({ mode: 'bus', routeShortName: 'BUS 59', headsign: 'Monumento' }),
        makeLeg({ mode: 'walk' }),
      ],
      {
        fare: {
          amount: 43,
          currency: 'PHP',
          confidence: 'official',
          effective_from: '2026-03-23',
          source_id: 'ltfrb-fares',
          breakdown: [
            { label: 'Traditional jeepney base fare', amount: 14 },
            { label: 'City bus ordinary fare', amount: 29 },
          ],
        },
        sources: ['osm', 'ltfrb-fares'],
      },
    );

    renderDetail(itinerary);

    expect(screen.queryByTestId('fare-not-published')).toBeNull();
    expect(screen.getByTestId('fare-total')).toHaveTextContent('₱43');
    expect(screen.getByTestId('fare-total')).not.toHaveTextContent(/bahagyang/i);
    expect(screen.getByTestId('fare-breakdown-total')).toHaveTextContent('Total ₱43');
    expect(screen.queryByTestId('fare-incomplete')).toBeNull();
    expect(screen.queryByTestId('tricycle-hint')).toBeNull();
    expect(
      screen.getAllByTestId('leg-strip-segment').map((segment) => segment.getAttribute('data-mode')),
    ).toEqual(['walk', 'jeepney', 'walk', 'bus', 'walk']);
  });
});

describe('/trip/:id route wiring', () => {
  it('opens the cached itinerary and starts the live walkthrough', async () => {
    renderApp(`/trip/${MRT_ITINERARY.id}`, MRT_PLAN);

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('31 min');
    expect(screen.getByTestId('trip-summary')).toHaveTextContent(/dating 8:31 AM/);
    expect(screen.getByTestId('fare-total')).toHaveTextContent('₱10.50');

    await user.click(screen.getByRole('button', { name: /simulan ang biyahe/i }));

    expect(await screen.findByTestId('live-banner')).toHaveTextContent(
      'no live data — expected wait',
    );
    // m3: the walkthrough title must not claim live tracking. Only the mandated
    // "no live data" sentence may mention live data on this screen.
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Biyahe ngayon');
    expect(title).not.toHaveTextContent(/live/i);
    expect(screen.getByTestId('live-progress')).toHaveTextContent(/hakbang 1 ng 3/i);
    expect(screen.getByTestId('live-trip-summary')).toHaveTextContent('31 min');
    // The plan came from the in-memory cache, not the saved-trips store.
    expect(screen.getByTestId('live-trip-summary')).toHaveTextContent(/naka-cache na plano/i);
    expect(screen.queryByText(/naka-save na plano/i)).toBeNull();
  });

  it('shows the honest notice when the plan cache is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp('/trip/plan-not-in-cache');

    expect(await screen.findByRole('heading', { name: 'Wala nang ruta' })).toBeInTheDocument();
    expect(
      screen.getByText(/hindi na available ang plan na ito sa device/i),
    ).toBeInTheDocument();
    // The notice must not claim the trip is absent from the saved-trips store
    // without reading it (M2).
    expect(screen.queryByText(/naka-save/i)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /bumalik sa search/i }));
    expect(await screen.findByRole('search')).toBeInTheDocument();
  });

  it('opens the detail from /plan with the detail action without a second POST /plan', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    server.use(planSuccessHandler);
    renderApp('/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao');

    await screen.findAllByTestId('route-card');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cachedTrip('plan-cubao-ayala-1')).toBeDefined());

    const detailActions = await screen.findAllByRole('button', { name: /detalye/i });
    expect(detailActions.length).toBeGreaterThan(0);
    await user.click(detailActions[0]!);

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('31 min');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
