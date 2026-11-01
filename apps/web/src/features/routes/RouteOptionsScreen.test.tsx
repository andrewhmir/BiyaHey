import type { PlanResponse } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AppRoutes } from '../../routes';
import { mapInstances } from '../../test/mocks/maplibre';
import {
  planCubaoAyalaResponse,
  planEmptyHandler,
  planErrorHandler,
  planPendingHandler,
  planSuccessHandler,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { RouteOptionsScreen } from './RouteOptionsScreen';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here; token
// contrast is reviewed against `tokens.css` instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const CUBAO = { lat: 14.619, lon: 121.053 };
const AYALA = { lat: 14.554, lon: 121.024 };

let fetchSpy: ReturnType<typeof spyOnFetch>;

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch');
}

function renderRouteOptions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const user: UserEvent = vi.isFakeTimers()
    ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    : userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouteOptionsScreen
        origin={CUBAO}
        destination={AYALA}
        originLabel="Cubao"
        destinationLabel="Ayala"
      />
    </QueryClientProvider>,
  );
  return { user, queryClient, ...utils };
}

beforeEach(() => {
  fetchSpy = spyOnFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RouteOptionsScreen', () => {
  it('shows 3 fare-forward cards sorted by ETA with provenance chips', async () => {
    renderRouteOptions();

    const cards = await screen.findAllByTestId('route-card');
    expect(cards).toHaveLength(3);

    // ETA is largest; the fare is a first-class field with its source line.
    expect(cards[0]).toHaveTextContent('31 min');
    expect(cards[0]).toHaveTextContent('₱26.40');
    // Arrival is rendered from the API's `endTime` in Philippine time.
    expect(cards[0]).toHaveTextContent('Dating 8:31 AM');
    // The plan's mandated copy is "Fares: ...", so the label assertion matches
    // the plural (the plan snippet's `/fare:/i` would not match its own copy).
    expect(cards[0]).toHaveTextContent(/fares:/i);
    expect(cards[0]).toHaveTextContent(/direct/i);
    expect(cards[0]).toHaveTextContent('Lakad');
    expect(cards[0]).toHaveTextContent('Jeepney');

    // The 2-transfer option uses the Taglish transfer wording; the long walk
    // switches to kilometres; every card has a labelled mode-chip group.
    expect(screen.getByText('2 sakay')).toBeInTheDocument();
    expect(screen.getByText('1.3 km lakad')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Mga mode ng sakay' })).toHaveLength(3);

    // Every displayed fare carries its effectivity date.
    const fareDates = screen.getAllByTestId('fare-date');
    expect(fareDates).toHaveLength(3);
    for (const fareDate of fareDates) {
      expect(fareDate).toHaveTextContent('2026-09-28');
    }

    // One provenance chip per card, built from the first two source ids only.
    const chips = screen.getAllByTestId('provenance-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('© OpenStreetMap contributors');
    expect(chips[0]).toHaveTextContent('Fares per LTFRB fare matrix effective 28 September 2026');
    expect(chips[0]).toHaveTextContent('Data sources');
    expect(chips[1]).toHaveTextContent('Route inventory derived from OpenStreetMap Wiki');
    // Card 2's third source id is `ltfrb-fares`; the two-source cap must hide it
    // (its fare line lives in a different node, so this proves the chip itself).
    expect(chips[1]).not.toHaveTextContent('Fares per LTFRB fare matrix');

    // One badge for the recommended lead card.
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');

    // All four local filters exist; Recommended is active by default.
    expect(screen.getByRole('button', { name: 'Recommended' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Cheapest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fewest transfers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Less walking' })).toBeInTheDocument();
  });

  it('re-ranks by cheapest without refetching', async () => {
    const { user } = renderRouteOptions();
    await screen.findAllByTestId('route-card');

    const initialFares = screen
      .getAllByTestId('fare-amount')
      .map((node) => node.textContent);
    expect(initialFares).toEqual(['₱26.40', '₱41.17', '₱40.61']);

    await user.click(screen.getByRole('button', { name: 'Cheapest' }));

    const fares = screen
      .getAllByTestId('fare-amount')
      .map((node) => Number(node.textContent!.replace('₱', '')));
    expect(fares).toEqual([...fares].sort((a, b) => a - b));
    expect(fares).toEqual([26.4, 40.61, 41.17]);
    expect(screen.getByRole('button', { name: 'Cheapest' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('route-badge')).toHaveTextContent('CHEAPEST');

    // The filter is a local re-rank: the plan was fetched exactly once.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('renders an unknown mode with a generic sakay chip', async () => {
    const lead = planCubaoAyalaResponse.itineraries[0];
    const planWithUnknownMode: PlanResponse = {
      ...planCubaoAyalaResponse,
      itineraries: [
        {
          ...lead,
          id: 'plan-unknown-mode',
          modes: ['walk', 'hovercraft'],
        },
      ],
    };
    server.use(http.post('*/plan', () => HttpResponse.json(planWithUnknownMode)));

    renderRouteOptions();

    expect(await screen.findByText(/sakay \(hovercraft\)/i)).toBeInTheDocument();
  });

  it('renders a rail chip with its line name and the line colour', async () => {
    const lead = planCubaoAyalaResponse.itineraries[0];
    const railPlan: PlanResponse = {
      ...planCubaoAyalaResponse,
      itineraries: [{ ...lead, id: 'plan-rail', modes: ['walk', 'mrt3'] }],
    };
    server.use(http.post('*/plan', () => HttpResponse.json(railPlan)));

    renderRouteOptions();

    // Colour is never the only carrier of meaning: the line name is text.
    expect(await screen.findByText('MRT-3')).toBeInTheDocument();
    expect(screen.getByTestId('rail-colour-mrt3')).toBeInTheDocument();
  });

  it('shows skeleton cards after 300ms, never a spinner', async () => {
    // Only the skeleton timer is faked; the pending request never settles.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    server.use(planPendingHandler);

    renderRouteOptions();

    // Before the 300 ms threshold the screen announces the search in its live
    // region but shows no skeleton and no spinner.
    expect(screen.queryByTestId('route-card-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(screen.queryByTestId('route-card-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getAllByTestId('route-card-skeleton')).toHaveLength(3);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the honest empty state when the API has no routes', async () => {
    server.use(planEmptyHandler);

    renderRouteOptions();

    expect(
      await screen.findByText('Walang ruta — try a nearby landmark'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('route-card')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry that recovers', async () => {
    server.use(planErrorHandler);

    const { user } = renderRouteOptions();

    expect(await screen.findByRole('alert')).toHaveTextContent(/hindi ma-load/i);

    server.use(planSuccessHandler);
    await user.click(screen.getByRole('button', { name: /subukan ulit/i }));

    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('highlights the tapped card and keeps exactly one card selected', async () => {
    const { user } = renderRouteOptions();
    const cards = await screen.findAllByTestId('route-card');
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');

    await user.click(cards[2]);

    const updated = screen.getAllByTestId('route-card');
    expect(updated[2]).toHaveAttribute('aria-pressed', 'true');
    expect(updated[0]).toHaveAttribute('aria-pressed', 'false');
    expect(updated[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no axe violations with route cards rendered', async () => {
    const { container } = renderRouteOptions();
    await screen.findAllByTestId('route-card');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('/plan route wiring', () => {
  function renderPlanRoute(entry: string) {
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

  it('plans from an explicit from pair without reading the device location', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    let captured: unknown;
    server.use(
      http.post('*/plan', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(planCubaoAyalaResponse);
      }),
    );

    renderPlanRoute(
      '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao',
    );

    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    expect(screen.getByText('Cubao → Ayala')).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // The URL's `from` is the request origin and `dest` the destination —
    // never swapped.
    expect(captured).toEqual({
      origin: { lat: 14.619, lon: 121.053 },
      destination: { lat: 14.554, lon: 121.024 },
    });
  });

  it('hosts the options in the map + sheet container and highlights the tapped polyline', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    const user = userEvent.setup();

    renderPlanRoute(
      '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao',
    );

    const cards = await screen.findAllByTestId('route-card');
    // The route layer owns the one `POST /plan`; the controlled screen must not
    // fetch a second copy of the same plan.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-detent', 'half');
    expect(within(sheet).getByRole('heading', { name: 'Mga ruta' })).toBeInTheDocument();
    expect(within(sheet).getAllByTestId('route-card')).toHaveLength(3);

    const map = mapInstances[0]!;
    act(() => {
      map.emit('load');
    });

    // Every returned itinerary is drawn (R53 straight-leg geometry).
    await waitFor(() => expect(map.addSource).toHaveBeenCalledTimes(3));
    for (const id of ['plan-cubao-ayala-1', 'plan-cubao-ayala-2', 'plan-cubao-ayala-3']) {
      expect(map.getSource(`route-${id}`)).toBeDefined();
    }

    // The lead card's itinerary is the emphasised line (6 px, others 4 px).
    await waitFor(() =>
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        'route-plan-cubao-ayala-1',
        'line-width',
        6,
      ),
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-plan-cubao-ayala-2', 'line-width', 4);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-plan-cubao-ayala-3', 'line-width', 4);

    // Tapping a card moves the emphasis to that itinerary's line.
    await user.click(cards[2]);
    await waitFor(() =>
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        'route-plan-cubao-ayala-3',
        'line-width',
        6,
      ),
    );
    await waitFor(() =>
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        'route-plan-cubao-ayala-1',
        'line-width',
        4,
      ),
    );

    // The plan response's provenance rows reach the map credit's ⓘ detail.
    await user.click(screen.getByRole('button', { name: 'Data sources' }));
    expect(screen.getByRole('dialog', { name: 'Data sources' })).toHaveTextContent(
      'LTFRB fare matrix (transcribed)',
    );
  });

  it('shows an honest origin state and offers search instead of a dead-end retry when location is unsupported', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: undefined });

    renderPlanRoute('/plan?dest=14.554,121.024&name=Ayala');

    expect(
      await screen.findByRole('heading', { name: /walang location/i }),
    ).toBeInTheDocument();
    // Retrying a browser that cannot report location would be a no-op.
    expect(screen.queryByRole('button', { name: /subukan ulit/i })).not.toBeInTheDocument();
    // No invented default origin means no plan request is made at all.
    expect(fetchSpy).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /bumalik sa search/i }));

    expect(await screen.findByRole('search')).toBeInTheDocument();
  });

  it('rejects a malformed destination without planning or inventing a place', async () => {
    renderPlanRoute('/plan?dest=nope');

    expect(
      await screen.findByRole('heading', { name: 'Walang destinasyon' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maghanap ng lugar' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns to search instead of leaving the app when /plan is the first history entry', async () => {
    // A PWA deep link has no in-app history to go back to (idx 0 / absent).
    window.history.replaceState(null, '');
    const user = userEvent.setup();

    renderPlanRoute(
      '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao',
    );
    await screen.findAllByTestId('route-card');

    await user.click(screen.getByRole('button', { name: 'Bumalik' }));

    expect(await screen.findByRole('search')).toBeInTheDocument();
  });
});
