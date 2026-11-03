import type { DataSource, ItineraryDto, PlanResponse } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AppRoutes } from '../../routes';
import {
  planCubaoAyalaResponse,
  planEmptyHandler,
  planErrorHandler,
  planPendingHandler,
  planSuccessHandler,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { makeWalkOnlyItinerary } from '../../test/fixtures/itinerary';
import { RouteOptionsScreen, type RouteFilter } from './RouteOptionsScreen';
import type { PlanOutcome } from './usePlan';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here; token
// contrast is reviewed against `tokens.css` instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const CUBAO = { lat: 14.619, lon: 121.053 };
const AYALA = { lat: 14.554, lon: 121.024 };

let fetchSpy: ReturnType<typeof spyOnFetch>;

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch');
}

/** A controlled `PlanOutcome` from the checked-in three-option plan fixture. */
function outcome(
  itineraries: ItineraryDto[] = [...planCubaoAyalaResponse.itineraries],
  sources: DataSource[] = [...planCubaoAyalaResponse.sources],
): PlanOutcome {
  return { status: 'success', itineraries, sources, error: null, retry: vi.fn() };
}

/** Stable plan identity: the announcement effect must not re-run per render. */
const DEFAULT_PLAN = outcome();

function renderRouteOptions(
  onEditTrip?: () => void,
  onOpenDetail?: (id: string) => void,
  onBack?: () => void,
) {
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
        onEditTrip={onEditTrip}
        onOpenDetail={onOpenDetail}
        onBack={onBack}
      />
    </QueryClientProvider>,
  );
  return { user, queryClient, ...utils };
}

/**
 * The `/plan` mount: a controlled plan with its own filter and selection state,
 * so a card press and the detail action move together exactly as they do in the
 * page.
 */
function ControlledRouteOptions({
  plan = DEFAULT_PLAN,
  onOpenDetail,
}: {
  plan?: PlanOutcome;
  onOpenDetail?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<RouteFilter>('recommended');
  const [selectedId, setSelectedId] = useState<string | null>(
    plan.itineraries[0]?.id ?? null,
  );

  return (
    <RouteOptionsScreen
      plan={plan}
      filter={filter}
      onFilterChange={setFilter}
      selectedId={selectedId}
      onSelect={(id) => setSelectedId(id)}
      onOpenDetail={onOpenDetail}
      originLabel="Cubao"
      destinationLabel="Ayala"
      onBack={vi.fn()}
    />
  );
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
  it('shows 3 v2 cards in recommended order with leg strips and provenance', async () => {
    renderRouteOptions();

    const cards = await screen.findAllByTestId('route-card');
    expect(cards).toHaveLength(3);

    // ETA leads, with the arrival line beneath it.
    expect(cards[0]).toHaveTextContent('31 min');
    expect(cards[0]).toHaveTextContent('₱26.40');
    // Arrival is rendered from the API's `endTime` in Philippine time.
    expect(cards[0]).toHaveTextContent('Dating 8:31 AM');
    expect(cards[0]).toHaveTextContent(/fares:/i);
    expect(cards[0]).toHaveTextContent(/direct/i);
    expect(cards[0]).toHaveTextContent('484 m lakad');

    // Every card carries the signature leg ribbon, one segment per API leg.
    const strips = screen.getAllByTestId('leg-strip');
    expect(strips).toHaveLength(3);
    expect(strips[0]).toHaveAttribute('data-leg-count', '3');
    expect(strips[1]).toHaveAttribute('data-leg-count', '4');
    expect(strips[2]).toHaveAttribute('data-leg-count', '5');
    expect(
      within(strips[0]!)
        .getAllByTestId('leg-strip-segment')
        .map((segment) => segment.getAttribute('data-mode')),
    ).toEqual(['walk', 'jeepney', 'walk']);

    // The 2-transfer option uses the Taglish transfer wording; the long walk
    // switches to kilometres.
    expect(screen.getByText('2 sakay')).toBeInTheDocument();
    expect(screen.getByText('1.3 km lakad')).toBeInTheDocument();

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
    expect(screen.getAllByTestId('route-badge')).toHaveLength(1);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');

    // All four local filters exist; Recommended is active by default and the
    // active pill uses the ink inverse fill.
    const recommended = screen.getByRole('button', { name: 'Recommended' });
    expect(recommended).toHaveAttribute('aria-pressed', 'true');
    expect(recommended).toHaveClass('bg-inverse-surface', 'text-inverse-on-surface');
    expect(screen.getByRole('button', { name: 'Cheapest' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Fewest transfers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Less walking' })).toBeInTheDocument();
  });

  it('shows the Kalsada header: eyebrow, trip line and departure sub-line', async () => {
    const { container } = renderRouteOptions(undefined, undefined, vi.fn());
    await screen.findAllByTestId('route-card');

    expect(screen.getByText('Plano ng biyahe')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Cubao → Ayala' })).toBeInTheDocument();
    // The first ranked itinerary departs at 08:00 Philippine time (12-hour UI).
    expect(screen.getByText('alis 8:00 AM')).toBeInTheDocument();

    // The count line above the cards names the count and the fastest option.
    expect(screen.getByTestId('routes-count')).toHaveTextContent(
      '3 ruta · pinakamabilis 31 min',
    );

    // The back button is first in DOM order (and first for keyboard/SR) even
    // though it is visually on the trailing edge.
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    const headerButtons = within(header as HTMLElement).getAllByRole('button');
    expect(headerButtons).toHaveLength(1);
    expect(headerButtons[0]).toHaveAccessibleName('Bumalik');
  });

  it('re-ranks by cheapest without refetching', async () => {
    const { user } = renderRouteOptions();
    await screen.findAllByTestId('route-card');

    const initialFares = screen.getAllByTestId('fare-amount').map((node) => node.textContent);
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

  it('leads with the consensus winner when one option wins three of the four criteria', async () => {
    // The reported contradiction: every single-criterion chip led with option B
    // while Recommended still led with option A merely because A was fastest.
    // Here A wins only ETA; B wins fare, transfers and walking; C sits between
    // them and wins nothing — so the consensus must put B first even though the
    // API sent it second. Fares keep their breakdown summing to the amount (R60).
    const base = planCubaoAyalaResponse.itineraries[0]!;
    const consensusPlan: PlanResponse = {
      ...planCubaoAyalaResponse,
      itineraries: [
        {
          ...base,
          id: 'plan-consensus-fast',
          durationMin: 22,
          endTime: '2026-11-02T08:22:00+08:00',
          transfers: 2,
          walkDistanceM: 2100,
          fare: {
            ...base.fare,
            amount: 60,
            breakdown: [{ label: 'Fast option fare', amount: 60 }],
          },
        },
        {
          ...base,
          id: 'plan-consensus-value',
          durationMin: 35,
          endTime: '2026-11-02T08:35:00+08:00',
          transfers: 0,
          walkDistanceM: 500,
          fare: {
            ...base.fare,
            amount: 25,
            breakdown: [{ label: 'Value option fare', amount: 25 }],
          },
        },
        {
          ...base,
          id: 'plan-consensus-middle',
          durationMin: 28,
          endTime: '2026-11-02T08:28:00+08:00',
          transfers: 1,
          walkDistanceM: 1000,
          fare: {
            ...base.fare,
            amount: 40,
            breakdown: [{ label: 'Middle option fare', amount: 40 }],
          },
        },
      ],
    };
    server.use(http.post('*/plan', () => HttpResponse.json(consensusPlan)));

    const { user } = renderRouteOptions();
    await screen.findAllByTestId('route-card');
    const etaOrder = () => screen.getAllByTestId('route-eta').map((node) => node.textContent);

    // Wins first: B wins 3 criteria, A wins only ETA (1) and C wins none, so
    // the fare/transfer/walk winner leads; the rank-sum only orders options
    // once their wins counts tie (B 6, C 8, A 10 before that key).
    expect(etaOrder()).toEqual(['35 min', '22 min', '28 min']);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');
    // "pinakamabilis" must name the minimum duration in the returned set (22),
    // not the ranked lead's (35) — the discriminating case for review I3.
    expect(screen.getByTestId('routes-count')).toHaveTextContent(
      '3 ruta · pinakamabilis 22 min',
    );

    // Every other chip must agree on the same lead, and each names its own
    // criterion instead of claiming the Recommended BEST badge.
    for (const { chip, badge } of [
      { chip: 'Cheapest', badge: 'CHEAPEST' },
      { chip: 'Fewest transfers', badge: 'FEWEST TRANSFERS' },
      { chip: 'Less walking', badge: 'LEAST WALKING' },
    ]) {
      await user.click(screen.getByRole('button', { name: chip }));
      expect(etaOrder()).toEqual(['35 min', '28 min', '22 min']);
      expect(screen.getAllByTestId('route-badge')).toHaveLength(1);
      expect(screen.getByTestId('route-badge')).toHaveTextContent(badge);
    }

    // Going back to Recommended keeps that same lead — the exact complaint.
    await user.click(screen.getByRole('button', { name: 'Recommended' }));
    expect(etaOrder()).toEqual(['35 min', '22 min', '28 min']);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');
    // Four chip presses only re-ranked locally: the plan was fetched once.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows the chips on a 5-option plan where a pure rank-sum would pick another lead', async () => {
    // Shape of a live Cubao → Manila plan (verified on the BFF): options 4 and
    // 5 repeat options 1 and 2's metrics, which the engine can return. Option 3
    // wins duration, fare and walking but has one transfer; by pure rank-sum its
    // transfer rank (5) outweighs those wins (option 2 scores 7, option 3 scores
    // 8), so option 2 would lead Recommended while Cheapest and Less walking led
    // option 3 — the original complaint again. The wins-count primary key must
    // keep all three chips on option 3, with Fewest transfers on option 2.
    const base = planCubaoAyalaResponse.itineraries[0]!;
    const liveOption = (
      id: string,
      durationMin: number,
      amount: number,
      transfers: number,
      walkDistanceM: number,
      endTime: string,
    ): PlanResponse['itineraries'][number] => ({
      ...base,
      id,
      durationMin,
      endTime,
      transfers,
      walkDistanceM,
      // The fare breakdown keeps summing to the amount (R60).
      fare: { ...base.fare, amount, breakdown: [{ label: `${id} fare`, amount }] },
    });
    const livePlan: PlanResponse = {
      ...planCubaoAyalaResponse,
      itineraries: [
        liveOption('plan-consensus-live-1', 60, 26.9, 0, 1069, '2026-11-02T09:00:00+08:00'),
        liveOption('plan-consensus-live-2', 60, 25.93, 0, 1069, '2026-11-02T09:00:00+08:00'),
        liveOption('plan-consensus-live-3', 45, 24.5, 1, 886, '2026-11-02T08:45:00+08:00'),
        liveOption('plan-consensus-live-4', 60, 26.9, 0, 1069, '2026-11-02T09:00:00+08:00'),
        liveOption('plan-consensus-live-5', 60, 25.93, 0, 1069, '2026-11-02T09:00:00+08:00'),
      ],
    };
    server.use(http.post('*/plan', () => HttpResponse.json(livePlan)));

    const { user } = renderRouteOptions();
    await screen.findAllByTestId('route-card');
    const leadCard = () => screen.getAllByTestId('route-card')[0];
    const leadFare = () => screen.getAllByTestId('fare-amount')[0]!.textContent;

    // Recommended agrees with the chips' convergent pick: option 3.
    expect(leadCard()).toHaveTextContent('45 min');
    expect(leadFare()).toBe('₱24.50');
    expect(screen.getAllByTestId('route-badge')).toHaveLength(1);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');

    // Cheapest and Less walking both lead option 3, as they must.
    await user.click(screen.getByRole('button', { name: 'Cheapest' }));
    expect(leadFare()).toBe('₱24.50');
    expect(screen.getByTestId('route-badge')).toHaveTextContent('CHEAPEST');

    await user.click(screen.getByRole('button', { name: 'Less walking' }));
    expect(leadCard()).toHaveTextContent('45 min');
    expect(screen.getByTestId('route-badge')).toHaveTextContent('LEAST WALKING');

    // Fewest transfers genuinely picks another option (direct, 60 min, ₱25.93)
    // and labels its own criterion instead of claiming BEST.
    await user.click(screen.getByRole('button', { name: 'Fewest transfers' }));
    expect(leadCard()).toHaveTextContent('60 min');
    expect(leadFare()).toBe('₱25.93');
    expect(screen.getByTestId('route-badge')).toHaveTextContent('FEWEST TRANSFERS');

    // Back to Recommended: the chips' convergent pick again, and still BEST.
    await user.click(screen.getByRole('button', { name: 'Recommended' }));
    expect(leadCard()).toHaveTextContent('45 min');
    expect(leadFare()).toBe('₱24.50');
    expect(screen.getAllByTestId('route-badge')).toHaveLength(1);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a walk-only plan as one walk segment without a mode-colour assumption', async () => {
    const walkPlan: PlanResponse = {
      v: 1,
      sources: planCubaoAyalaResponse.sources,
      itineraries: [makeWalkOnlyItinerary()],
    };
    server.use(http.post('*/plan', () => HttpResponse.json(walkPlan)));

    renderRouteOptions();

    const cards = await screen.findAllByTestId('route-card');
    expect(cards).toHaveLength(1);
    const segments = within(cards[0]!).getAllByTestId('leg-strip-segment');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveAttribute('data-mode', 'walk');
    // The badge rule still applies to a one-option plan.
    expect(screen.getAllByTestId('route-badge')).toHaveLength(1);
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');
    // A walk-only fare is still shown with its honest provenance line.
    expect(screen.getByTestId('fare-date')).toHaveTextContent('Fares: no fare effective');
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
    expect(screen.getByRole('status')).toHaveTextContent(/naghahanap ng ruta/i);
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

  it('shows an honest named empty state that offers to change the starting point', async () => {
    server.use(planEmptyHandler);
    const onEditTrip = vi.fn();

    const { user } = renderRouteOptions(onEditTrip);

    expect(
      await screen.findByText('Walang ruta sa pagitan ng Cubao at Ayala'),
    ).toBeInTheDocument();
    // The old dead-end copy suggested a nearby landmark; the honest message
    // names the trip the rider actually planned and offers a way forward.
    expect(screen.queryByText('Walang ruta — try a nearby landmark')).not.toBeInTheDocument();
    expect(screen.getByText(/subukan ang ibang starting point/i)).toBeInTheDocument();
    expect(screen.queryByTestId('route-card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Palitan ang starting point' }));
    expect(onEditTrip).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with a retry that recovers and announces it once', async () => {
    server.use(planErrorHandler);

    const { user } = renderRouteOptions();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/hindi ma-load/i);
    // m4: the assertive alert is the single announcement for the error state.
    // The polite status region must stay silent so the sentence is not read
    // twice; the About-data screen follows the same contract.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    server.use(planSuccessHandler);
    await user.click(screen.getByRole('button', { name: /subukan ulit/i }));

    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The polite region is back to its normal job after recovery.
    expect(screen.getByRole('status')).toHaveTextContent('3 ruta');
  });

  it('highlights the tapped card and keeps exactly one card selected', async () => {
    const { user } = renderRouteOptions();
    const cards = await screen.findAllByTestId('route-card');
    const selectOf = (card: HTMLElement) => within(card).getByTestId('route-card-select');
    expect(selectOf(cards[0]!)).toHaveAttribute('aria-pressed', 'true');

    await user.click(selectOf(cards[2]!));

    const updated = screen.getAllByTestId('route-card');
    expect(selectOf(updated[2]!)).toHaveAttribute('aria-pressed', 'true');
    expect(selectOf(updated[1]!)).toHaveAttribute('aria-pressed', 'false');
    expect(selectOf(updated[0]!)).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps exactly one route-detail-action directly under the selected card', async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    render(<ControlledRouteOptions onOpenDetail={onOpenDetail} />);

    const actions = screen.getAllByTestId('route-detail-action');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveTextContent('Tingnan ang detalye');
    expect(actions[0]).toHaveAttribute('aria-label', 'Tingnan ang detalye ng rutang 31 min');
    // The legacy per-card button id is gone: E2E uses the new one.
    expect(screen.queryByTestId('trip-open')).not.toBeInTheDocument();
    const firstItem = actions[0]!.closest('li') as HTMLElement;
    expect(within(firstItem).getByTestId('route-card-select')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Selecting another card moves the single action with the selection.
    await user.click(
      within(screen.getAllByTestId('route-card')[2]!).getByTestId('route-card-select'),
    );

    const movedActions = screen.getAllByTestId('route-detail-action');
    expect(movedActions).toHaveLength(1);
    expect(movedActions[0]).toHaveAttribute(
      'aria-label',
      'Tingnan ang detalye ng rutang 45 min',
    );
    const movedItem = movedActions[0]!.closest('li') as HTMLElement;
    expect(within(movedItem).getByTestId('route-card-select')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(movedActions[0]!);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith(planCubaoAyalaResponse.itineraries[2]!.id);
  });

  it('renders no detail action when the screen owns no navigation', async () => {
    render(<ControlledRouteOptions />);
    await screen.findAllByTestId('route-card');

    expect(screen.queryByTestId('route-detail-action')).not.toBeInTheDocument();
  });

  it('announces an explicit selection once, without repeating the count message', async () => {
    const { user } = renderRouteOptions();
    await screen.findAllByTestId('route-card');

    // Only the count announcement exists until the rider actually selects.
    const countStatus = screen.getByRole('status');
    expect(countStatus).toHaveTextContent('3 ruta');
    expect(screen.queryByText(/Napili ang rutang/)).not.toBeInTheDocument();

    await user.click(
      within(screen.getAllByTestId('route-card')[2]!).getByTestId('route-card-select'),
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    const selectionAnnouncements = statuses.filter((node) =>
      /Napili ang rutang/.test(node.textContent ?? ''),
    );
    expect(selectionAnnouncements).toHaveLength(1);
    expect(selectionAnnouncements[0]).toHaveTextContent('Napili ang rutang 45 min');
    // The count announcement is unchanged — the selection has its own region.
    expect(countStatus).toHaveTextContent('3 ruta');
  });

  it('has no axe violations with route cards rendered', async () => {
    const { container } = renderRouteOptions(undefined, vi.fn());
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
    expect(screen.getByRole('heading', { level: 1, name: 'Cubao → Ayala' })).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // The URL's `from` is the request origin and `dest` the destination —
    // never swapped.
    expect(captured).toEqual({
      origin: { lat: 14.619, lon: 121.053 },
      destination: { lat: 14.554, lon: 121.024 },
    });
  });

  it('plans with ordered via stops and shows them in the trip line', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    const viaStop = {
      lat: 14.58,
      lon: 121.04,
      stopId: 'gtfs_bus-lx:node:6014597491',
      name: 'Guadalupe',
    };
    let captured: unknown;
    server.use(
      http.post('*/plan', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(planCubaoAyalaResponse);
      }),
    );

    renderPlanRoute(
      `/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao&via=${encodeURIComponent(JSON.stringify([viaStop]))}`,
    );

    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cubao → Guadalupe → Ayala' }),
    ).toBeInTheDocument();
    // The POST body carries the stop's served id in travel order; the display
    // name stays in the URL only.
    expect(captured).toEqual({
      origin: { lat: 14.619, lon: 121.053 },
      destination: { lat: 14.554, lon: 121.024 },
      stops: [{ lat: 14.58, lon: 121.04, stopId: 'gtfs_bus-lx:node:6014597491' }],
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns to the prefilled directions form from the empty state', async () => {
    server.use(planEmptyHandler);
    const user = userEvent.setup();

    renderPlanRoute(
      '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao',
    );

    // The named outcome is the announced live region (the top status is silent
    // for the empty state, so it is not read twice) — R89 review.
    expect(
      await screen.findByText('Walang ruta sa pagitan ng Cubao at Ayala'),
    ).toHaveAttribute('role', 'status');

    await user.click(screen.getByRole('button', { name: 'Palitan ang starting point' }));

    expect(await screen.findByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /mula sa/i })).toHaveValue('Cubao');
    expect(screen.getByRole('searchbox', { name: /papunta sa/i })).toHaveValue('Ayala');
  });

  it('hosts the options in the sheet and keeps one detail action for the selected card', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    const user = userEvent.setup();

    renderPlanRoute(
      '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao',
    );

    const cards = await screen.findAllByTestId('route-card');
    expect(cards).toHaveLength(3);
    // The route layer owns the one `POST /plan`; the controlled screen must not
    // fetch a second copy of the same plan.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-detent', 'half');
    // The Kalsada trip line is the sheet's heading.
    expect(within(sheet).getByRole('heading', { level: 1, name: 'Cubao → Ayala' })).toBeInTheDocument();
    expect(within(sheet).getAllByTestId('route-card')).toHaveLength(3);
    // Exactly one 48 dp detail action, belonging to the selected lead card.
    const detailActions = within(sheet).getAllByTestId('route-detail-action');
    expect(detailActions).toHaveLength(1);
    expect(detailActions[0]).toHaveAttribute(
      'aria-label',
      'Tingnan ang detalye ng rutang 31 min',
    );
    const detailItem = detailActions[0]!.closest('li') as HTMLElement;
    expect(within(detailItem).getByTestId('route-card-select')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByTestId('routes-count')).toHaveTextContent(
      '3 ruta · pinakamabilis 31 min',
    );

    // Tapping another card moves the single action there (not a per-card row).
    await user.click(
      within(within(sheet).getAllByTestId('route-card')[2]!).getByTestId('route-card-select'),
    );
    const movedActions = within(sheet).getAllByTestId('route-detail-action');
    expect(movedActions).toHaveLength(1);
    expect(movedActions[0]).toHaveAttribute(
      'aria-label',
      'Tingnan ang detalye ng rutang 45 min',
    );
  });

  it('plans a legacy /plan?dest link from the device location when no from is given', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 14.5547, longitude: 121.0244 },
      } as GeolocationPosition);
    });
    vi.stubGlobal('navigator', {
      ...window.navigator,
      geolocation: { getCurrentPosition },
    });
    let captured: unknown;
    server.use(
      http.post('*/plan', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(planCubaoAyalaResponse);
      }),
    );

    renderPlanRoute('/plan?dest=14.554,121.024&name=Ayala');

    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    // The legacy hand-off labels the device fix honestly instead of inventing a
    // place, and the one bounded read supplies the request origin.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Kasalukuyang lokasyon → Ayala' }),
    ).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(captured).toEqual({
      origin: { lat: 14.5547, lon: 121.0244 },
      destination: { lat: 14.554, lon: 121.024 },
    });
  });

  it('rejects an unreadable from instead of guessing an origin', async () => {
    renderPlanRoute('/plan?dest=14.554,121.024&name=Ayala&from=nope');

    expect(
      await screen.findByRole('heading', { name: 'Hindi valid ang starting point' }),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
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
