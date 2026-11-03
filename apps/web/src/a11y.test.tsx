import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { BottomSheet } from './components/sheet/BottomSheet';
import { MapCredit } from './components/map/MapCredit';
import { SavedScreen } from './features/saved/SavedScreen';
import { AboutDataScreen } from './features/provenance/AboutDataScreen';
import { RouteOptionsScreen } from './features/routes/RouteOptionsScreen';
import type { PlanOutcome } from './features/routes/usePlan';
import { TripDetailScreen } from './features/trip/TripDetailScreen';
import { saveTrip } from './lib/savedTripsStore';
import { AppRoutes } from './routes';
import { planCubaoAyalaResponse, planMrt3CubaoAyalaResponse } from './test/msw/handlers';

/**
 * Aggregate WCAG 2.2 AA pass over the key screens (plan Task 9).
 *
 * R52 exception: jsdom has no layout engine or canvas, so axe's `color-contrast`
 * rule can only produce noise here. Contrast is reviewed against the token pairs
 * in `src/theme/tokens.css`; every other axe rule stays enabled. Real-browser
 * verification (Lighthouse/Playwright zoom + rendered layout) is Task 10's.
 */
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const MRT_PLAN = planMrt3CubaoAyalaResponse;
const MRT_ITINERARY = MRT_PLAN.itineraries[0]!;
const NOW = new Date('2026-11-02T03:00:00.000Z');

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

function renderApp(entry: string) {
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, ...utils };
}

function renderRouteOptions() {
  const plan: PlanOutcome = {
    status: 'success',
    itineraries: planCubaoAyalaResponse.itineraries,
    sources: planCubaoAyalaResponse.sources,
    error: null,
    retry: () => undefined,
  };
  return render(
    <RouteOptionsScreen
      plan={plan}
      filter="recommended"
      onFilterChange={() => undefined}
      selectedId={plan.itineraries[0]?.id ?? null}
      onSelect={() => undefined}
      onOpenDetail={() => undefined}
      originLabel="Cubao"
      destinationLabel="Ayala"
    />,
  );
}

function renderTripDetail() {
  return render(<TripDetailScreen itinerary={MRT_ITINERARY} sources={MRT_PLAN.sources} />);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.fontSize = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WCAG 2.2 axe pass over the key screens', () => {
  it('has no violations on Home', async () => {
    const { container } = renderApp('/');
    expect(await screen.findByTestId('sheet')).toBeInTheDocument();
    // Resolve the lazy map chunk inside the query so its Suspense update is
    // act-wrapped; the map is part of the Home screen being audited.
    expect(await screen.findByTestId('map-canvas')).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no violations on Search with grouped results', async () => {
    const { container, user } = renderApp('/search');
    // `/search` is a lazy route (Task 10): wait for its chunk before typing.
    // R89: the screen is a directions form, so target the From picker.
    const searchbox = await screen.findByRole('searchbox', { name: /mula sa/i });
    await user.type(searchbox, 'ayala');
    // The result text waits out a 250 ms debounce; give it headroom so the suite
    // does not flake under CPU contention (m1). Real content then axe.
    expect(
      await screen.findByText('Ayala Triangle Gardens', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no violations on Route options', async () => {
    const { container } = renderRouteOptions();
    expect(await screen.findAllByTestId('route-card')).toHaveLength(3);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no violations on Trip detail (stop list expanded)', async () => {
    const { container } = renderTripDetail();
    // UX v2 copy: the expander is `trip.stopsShow` ("Ipakita ang N hintuan").
    await userEvent.click(screen.getByRole('button', { name: /ipakita ang \d+ hintuan/i }));
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no violations on Saved', async () => {
    saveTrip(MRT_ITINERARY, MRT_PLAN.sources);
    const { container } = render(
      <QueryClientProvider client={newQueryClient()}>
        <SavedScreen now={NOW} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('saved-row')).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no violations on About data', async () => {
    const { container } = render(
      <QueryClientProvider client={newQueryClient()}>
        <AboutDataScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findAllByTestId('dataset-card')).toHaveLength(10);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('200% text zoom at 320 px', () => {
  /**
   * jsdom has no layout engine: it cannot measure overflow, so this asserts the
   * parts the markup controls — both controls stay rendered/visible at a doubled
   * root font size, the fare has no truncation/nowrap class, and the summary can
   * wrap. Real 320 px × 200% rendering is verified in Task 10's browser pass.
   */
  beforeEach(() => {
    document.documentElement.style.fontSize = '200%';
    vi.stubGlobal('innerWidth', 320);
  });

  it('keeps the route-options fare and detail CTA visible and untruncated', () => {
    renderRouteOptions();

    expect(window.innerWidth).toBe(320);
    const fare = screen.getAllByTestId('fare-amount')[0]!;
    const cta = screen.getAllByTestId('route-detail-action')[0]!;
    expect(fare).toBeVisible();
    expect(cta).toBeVisible();
    expect(fare.className).not.toMatch(/truncate|whitespace-nowrap/);
    expect(cta.className).not.toMatch(/truncate|whitespace-nowrap/);
  });

  it('keeps the trip-detail total fare and start-trip CTA visible', () => {
    renderTripDetail();

    expect(screen.getByTestId('fare-total')).toBeVisible();
    expect(screen.getByRole('button', { name: /simulan ang biyahe/i })).toBeVisible();
    expect(screen.getByTestId('trip-summary').className).toContain('break-words');
  });
});

describe('touch targets and the sheet drag alternative', () => {
  it('gives every provenance and fare entry point a 48 dp target', () => {
    // Home About-data link.
    const home = renderApp('/');
    const homeAbout = screen.getByRole('link', { name: /about data/i });
    expect(homeAbout.className).toContain('min-h-12');
    home.unmount();

    // Route-card provenance chip link.
    const routes = renderRouteOptions();
    const chipLinks = screen
      .getAllByTestId('provenance-chip')
      .map((chip) => within(chip).getByRole('link'));
    expect(chipLinks.length).toBeGreaterThan(0);
    for (const link of chipLinks) {
      expect(link.className).toContain('min-h-12');
    }
    routes.unmount();

    // Fare-footer source links and About-data link.
    const detail = renderTripDetail();
    for (const link of screen.getAllByTestId('fare-source-link')) {
      expect(link.className).toContain('min-h-12');
    }
    expect(screen.getByRole('link', { name: /about data/i }).className).toContain('min-h-12');
    detail.unmount();

    // Map-credit ⓘ toggle.
    render(<MapCredit autoCollapseMs={0} />);
    expect(screen.getByRole('button', { name: /pinagmulan ng data/i }).className).toContain(
      'size-12',
    );
  });

  it('reaches every sheet detent with the keyboard only (drag alternative)', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const sheet = screen.getByTestId('sheet');
    const expand = screen.getByRole('button', { name: /expand sheet/i });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(sheet).toHaveAttribute('data-detent', 'half');
    await user.keyboard('{Enter}');
    expect(sheet).toHaveAttribute('data-detent', 'expanded');

    // Escape collapses one detent; the separate collapse control keeps working
    // for touch/switch users without a keyboard.
    await user.keyboard('{Escape}');
    expect(sheet).toHaveAttribute('data-detent', 'half');
    const collapse = screen.getByRole('button', { name: /collapse sheet/i });
    collapse.focus();
    await user.keyboard('{Enter}');
    expect(sheet).toHaveAttribute('data-detent', 'peek');
  });

  it('disables sheet and skeleton motion under prefers-reduced-motion', async () => {
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

    const sheet = render(
      <BottomSheet detents={[96, 'half', 'expanded']} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-motion', 'reduced');
    sheet.unmount();

    // Skeleton cards opt out of the pulse. The base layer's global
    // reduced-motion safety net for transitions is CSS (checked in the build /
    // Task 10 browser pass, not measurable in jsdom).
    vi.useFakeTimers();
    const plan: PlanOutcome = {
      status: 'loading',
      itineraries: [],
      sources: [],
      error: null,
      retry: () => undefined,
    };
    render(
      <RouteOptionsScreen
        plan={plan}
        filter="recommended"
        onFilterChange={() => undefined}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const skeleton = screen.getAllByTestId('route-card-skeleton')[0]!;
    expect(skeleton.className).toContain('motion-reduce:animate-none');
  });
});
