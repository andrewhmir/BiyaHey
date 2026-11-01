import type { FareQuote } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AppRoutes } from '../../routes';
import { cachedTrip, clearPlanCache, rememberPlan } from '../routes/planCache';
import {
  planCubaoAyalaResponse,
  planLong15LegsResponse,
  planMrt3CubaoAyalaResponse,
  planSuccessHandler,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { FareBreakdown } from './FareBreakdown';
import { StopsList } from './StopsList';
import { TripDetailScreen } from './TripDetailScreen';
import { SAVED_TRIPS_KEY, readSavedTrips } from './savedTrips';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const MRT_PLAN = planMrt3CubaoAyalaResponse;
const MRT_ITINERARY = MRT_PLAN.itineraries[0]!;
const LONG_ITINERARY = planLong15LegsResponse.itineraries[0]!;
const LONG_NAME = 'Boni MRT-3 Station Northbound Stairs beside Boni Avenue Hall';

function renderDetail(itinerary = MRT_ITINERARY) {
  return render(<TripDetailScreen itinerary={itinerary} sources={MRT_PLAN.sources} />);
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

let user: UserEvent;

beforeEach(() => {
  user = userEvent.setup();
  localStorage.clear();
  clearPlanCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPlanCache();
});

describe('TripDetailScreen', () => {
  it('renders leg instructions with signage to look for and landmark hints', () => {
    renderDetail();

    expect(screen.getByText(/look for: MRT-3 \/ Ayala/i)).toBeInTheDocument();
    expect(screen.getByText(/landmark: Farmers Plaza/i)).toBeInTheDocument();
    // Every instruction has a landmark line, including when the API sent none.
    expect(screen.getByText(/landmark: walang landmark — use the stop name/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('leg-row')).toHaveLength(3);
  });

  it('expands a ride leg to its stop list with the alight stop pinned last', async () => {
    renderDetail();

    await user.click(screen.getByRole('button', { name: /show 3 stops/i }));

    const stops = screen.getAllByTestId('stop-row');
    expect(stops).toHaveLength(4);
    expect(stops[0]).toHaveTextContent('Cubao');
    expect(stops.at(-1)).toHaveAttribute('data-alight', 'true');
    expect(stops.at(-1)).toHaveTextContent('Ayala');
    expect(screen.getByTestId('stop-counter')).toHaveTextContent('4 stops');
    expect(screen.getByRole('button', { name: /hide 3 stops/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('renders the fare breakdown with its source and effectivity date', () => {
    renderDetail();

    expect(screen.getByText(/mrt-3 published fare \(9\.26 km\)/i)).toBeInTheDocument();
    expect(screen.getByText(/effective 2026-03-23/i)).toBeInTheDocument();
    expect(screen.getByTestId('fare-estimate')).toHaveTextContent(/estimate/i);
    expect(screen.getByTestId('fare-breakdown-total')).toHaveTextContent('₱10.50');

    const link = screen.getByRole('link', { name: /lrta/i });
    expect(link).toHaveAttribute('href', 'https://www.lrta.gov.ph/tickets-and-fares/');
  });

  it('labels an informal transfer with the 5-minute buffer', () => {
    render(
      <TripDetailScreen
        itinerary={planCubaoAyalaResponse.itineraries[1]!}
        sources={planCubaoAyalaResponse.sources}
      />,
    );

    expect(screen.getByText('Allow 5 min transfer')).toBeInTheDocument();
    expect(screen.getByTestId('informal-transfer')).toHaveTextContent('informal_transfer');
  });

  it('does not clip a 15-leg, 60-character-stop itinerary', () => {
    render(
      <TripDetailScreen itinerary={LONG_ITINERARY} sources={planLong15LegsResponse.sources} />,
    );

    expect(screen.getByTestId('fare-total')).toBeVisible();
    expect(screen.getByRole('button', { name: /start trip/i })).toBeVisible();
    expect(screen.getAllByTestId('leg-row')).toHaveLength(15);
    expect(screen.getAllByText(new RegExp(LONG_NAME)).length).toBeGreaterThan(0);

    // The CTAs are pinned by a sticky header; the page itself has no height cap
    // or overflow clipping that could cut off the 15-leg timeline.
    expect(screen.getByTestId('trip-header')).toHaveClass('sticky');
    expect(screen.getByTestId('trip-header')).toHaveClass('top-0');
    expect(screen.getAllByTestId('leg-instruction')[0]).toHaveClass('break-words');
  });

  it('has no axe violations with the stop list expanded', async () => {
    const { container } = renderDetail();
    await user.click(screen.getByRole('button', { name: /show 3 stops/i }));

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('saves a fare snapshot with dataset version and saved_at', async () => {
    renderDetail();

    await user.click(screen.getByTestId('save-trip'));

    const stored = readSavedTrips();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.itinerary.id).toBe(MRT_ITINERARY.id);
    expect(stored[0]?.fareSnapshot).toEqual(MRT_ITINERARY.fare);
    expect(stored[0]?.datasetVersion).toBe('2026-11-01');
    expect(Number.isNaN(Date.parse(stored[0]?.savedAt ?? ''))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent(/nai-save ang biyahe/i);
    expect(screen.getByTestId('save-trip')).toHaveTextContent('Nai-save');
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
});

describe('/trip/:id route wiring', () => {
  it('opens the cached itinerary and starts the static live placeholder', async () => {
    renderApp(`/trip/${MRT_ITINERARY.id}`, MRT_PLAN);

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('31 min · arrive 08:31 · ₱10.50');

    await user.click(screen.getByRole('button', { name: /start trip/i }));

    expect(await screen.findByTestId('live-banner')).toHaveTextContent(
      'no live data — expected wait',
    );
    expect(screen.getByTestId('live-trip-summary')).toHaveTextContent('31 min');
  });

  it('shows the honest notice when the plan cache is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp('/trip/plan-not-in-cache');

    expect(await screen.findByRole('heading', { name: 'Wala nang ruta' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /bumalik sa search/i }));
    expect(await screen.findByRole('search')).toBeInTheDocument();
  });

  it('opens the detail from /plan with the Detalye action without a second POST /plan', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    server.use(planSuccessHandler);
    renderApp('/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao');

    await screen.findAllByTestId('route-card');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cachedTrip('plan-cubao-ayala-1')).toBeDefined());

    const detailActions = screen.getAllByRole('button', { name: 'Detalye' });
    expect(detailActions.length).toBeGreaterThan(0);
    await user.click(detailActions[0]!);

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('31 min');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
