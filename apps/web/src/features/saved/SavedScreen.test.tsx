import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { PlanResponse } from '@biyahey/shared';
import { defaultT } from '../../i18n/strings';
import { WALK_FALLBACK_NOT_REALISTIC_KM, WALK_FALLBACK_NOT_REALISTIC_M } from '../../components/transit/WalkFallback';
import { makeWalkFallbackItinerary } from '../../test/fixtures/itinerary';
import {
  RECENT_TRIPS_KEY,
  SAVED_TRIPS_KEY,
  readRecentTrips,
  readSavedTrips,
  type SavedTrip,
} from '../../lib/savedTripsStore';
import { AppRoutes } from '../../routes';
import {
  fareStatusErrorHandler,
  fareStatusPendingHandler,
  planCubaoAyalaResponse,
  planMrt3CubaoAyalaResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { clearPlanCache, rememberPlan } from '../routes/planCache';
import { SavedScreen } from './SavedScreen';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const NOW = new Date('2026-11-02T03:00:00.000Z');
const MRT_PLAN = planMrt3CubaoAyalaResponse;
const MRT_ITINERARY = MRT_PLAN.itineraries[0]!;
const PUV_ITINERARY = planCubaoAyalaResponse.itineraries[0]!;

function storedRow(
  plan: PlanResponse = MRT_PLAN,
  savedAt = '2026-09-01T08:00:00.000Z',
  patch: Partial<SavedTrip> = {},
): SavedTrip {
  const itinerary = plan.itineraries[0]!;
  return {
    itinerary,
    sources: plan.sources,
    fareSnapshot: itinerary.fare,
    datasetVersion: '2026-11-01',
    savedAt,
    ...patch,
  };
}

function seedSaved(rows: unknown[]): void {
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(rows));
}

function seedRecents(rows: unknown[]): void {
  localStorage.setItem(RECENT_TRIPS_KEY, JSON.stringify(rows));
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

let user: UserEvent;

beforeEach(() => {
  localStorage.clear();
  clearPlanCache();
  setOnline(true);
  user = userEvent.setup();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setOnline(true);
  clearPlanCache();
  localStorage.clear();
});

describe('SavedScreen offline snapshot', () => {
  it('keeps saved trips fully readable offline with a staleness stamp', async () => {
    seedSaved([storedRow()]);
    setOnline(false);

    render(<SavedScreen now={NOW} />);

    expect(await screen.findByText(/saved route \(no live data\)/i)).toBeInTheDocument();
    expect(screen.getByText(/fare may have changed since you saved this/i)).toBeInTheDocument();
    expect(screen.getByText(/last updated/i)).toBeInTheDocument();
    expect(screen.getByTestId('offline-badge')).toHaveTextContent(/offline/i);

    // The fare and its effectivity date are readable without the API.
    expect(screen.getByTestId('saved-fare')).toHaveTextContent('₱10.50');
    expect(screen.getByTestId('saved-fare')).toHaveTextContent('2026-03-23');
    // The itinerary timeline summary survives too (31 min on the MRT fixture).
    expect(screen.getByTestId('saved-eta')).toHaveTextContent('31 min');
  });
});

describe('SavedScreen card v2', () => {
  it('titles a saved row by its itinerary endpoints and shows its leg strip', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-09-01T08:00:00.000Z')]);

    render(<SavedScreen now={NOW} />);

    const row = await screen.findByTestId('saved-row');
    // The title comes from `itineraryEndpoints()` — first leg origin → last leg
    // destination — never from the itinerary id or a "START → END" placeholder.
    expect(screen.getByTestId('saved-title')).toHaveTextContent(
      'Cubao, Quezon City → Ayala Triangle Gardens',
    );
    // The stored plan's own legs are drawn as the shared ribbon.
    expect(within(row).getByTestId('leg-strip')).toHaveAttribute('data-leg-count', '3');
    // The saved date is labelled as the save action's date (not a live ETA).
    // `formatLongDate` renders in Asia/Manila via the en-PH formatter.
    expect(screen.getByTestId('saved-date')).toHaveTextContent(/na-save noong sep 1, 2026/i);
  });

  it('marks a saved walk fallback without a fare amount', async () => {
    const itinerary = makeWalkFallbackItinerary({ distanceM: 2100, durationMin: 27 });
    seedSaved([
      {
        itinerary,
        sources: [],
        fareSnapshot: itinerary.fare,
        datasetVersion: '2026-11-01',
        savedAt: '2026-10-31T08:00:00.000Z',
      },
    ]);

    render(<SavedScreen now={NOW} />);

    const row = await screen.findByTestId('saved-row');
    expect(within(row).getByTestId('walk-fallback-badge')).toHaveTextContent(
      defaultT('walkFallback.badge'),
    );
    expect(within(row).getByTestId('walk-fallback-stat')).toHaveTextContent('2.1 km');
    // The row states the honest sentence, not only a badge/value pair.
    expect(within(row).getByTestId('walk-fallback-body')).toHaveTextContent(
      defaultT('walkFallback.body'),
    );
    expect(within(row).queryByTestId('walk-fallback-warning')).toBeNull();
    expect(screen.queryByTestId('saved-fare')).toBeNull();
    expect(row).not.toHaveTextContent('₱');
    expect(row).not.toHaveTextContent(/fare matrix|fare may have changed/i);
  });

  it('warns on a saved fallback over 25 km while still showing the estimate', async () => {
    const itinerary = makeWalkFallbackItinerary({
      distanceM: WALK_FALLBACK_NOT_REALISTIC_M + 1,
    });
    seedSaved([
      {
        itinerary,
        sources: [],
        fareSnapshot: itinerary.fare,
        datasetVersion: '2026-11-01',
        savedAt: '2026-10-31T08:00:00.000Z',
      },
    ]);

    render(<SavedScreen now={NOW} />);

    const row = await screen.findByTestId('saved-row');
    expect(within(row).getByTestId('walk-fallback-stat')).toHaveTextContent('25.0 km');
    expect(within(row).getByTestId('walk-fallback-warning')).toHaveTextContent(
      defaultT('walkFallback.tooFar', { km: WALK_FALLBACK_NOT_REALISTIC_KM }),
    );
    expect(row).not.toHaveTextContent('₱');
  });

  it('has no axe violations on a saved fallback row', async () => {
    const itinerary = makeWalkFallbackItinerary({
      distanceM: WALK_FALLBACK_NOT_REALISTIC_M + 1,
    });
    seedSaved([
      {
        itinerary,
        sources: [],
        fareSnapshot: itinerary.fare,
        datasetVersion: '2026-11-01',
        savedAt: '2026-10-31T08:00:00.000Z',
      },
    ]);
    const { container } = render(<SavedScreen now={NOW} />);

    await screen.findByTestId('saved-row');
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('lets a nickname win the title while keeping the endpoints visible', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-09-01T08:00:00.000Z', { nickname: 'Bahay → Opisina' })]);

    render(<SavedScreen now={NOW} />);

    expect(await screen.findByTestId('saved-title')).toHaveTextContent('Bahay → Opisina');
    expect(screen.getByTestId('saved-row')).toHaveTextContent(
      'Cubao, Quezon City → Ayala Triangle Gardens',
    );
  });

  it('labels a recent row with its last-opened date', async () => {
    seedRecents([storedRow(MRT_PLAN, '2026-10-31T08:00:00.000Z')]);

    render(<SavedScreen now={NOW} />);
    await user.click(screen.getByRole('tab', { name: /recent/i }));

    expect(await screen.findByTestId('recent-row')).toBeInTheDocument();
    expect(screen.getByTestId('saved-title')).toHaveTextContent(
      'Cubao, Quezon City → Ayala Triangle Gardens',
    );
    expect(screen.getByTestId('saved-date')).toHaveTextContent(/huling binuksan oct 31, 2026/i);
  });
});

describe('SavedScreen tabs', () => {
  it('renders only the selected tab panel and hides the other (I1)', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    seedRecents([storedRow(MRT_PLAN, '2026-10-31T08:00:00.000Z')]);
    const { container } = render(<SavedScreen now={NOW} />);

    const savedTab = screen.getByRole('tab', { name: /^saved$/i });
    const recentTab = screen.getByRole('tab', { name: /^recent$/i });
    function panelFor(tab: HTMLElement): HTMLElement {
      const panel = container.querySelector<HTMLElement>(
        `[role="tabpanel"][aria-labelledby="${tab.id}"]`,
      );
      expect(panel).not.toBeNull();
      // The tab's aria-controls must point at the panel it labels.
      expect(tab).toHaveAttribute('aria-controls', panel?.id ?? '');
      return panel as HTMLElement;
    }

    const savedPanel = panelFor(savedTab);
    const recentPanel = panelFor(recentTab);
    expect(savedPanel).toBeVisible();
    expect(recentPanel).not.toBeVisible();
    expect(recentPanel).toHaveAttribute('hidden');
    // A `flex`/`block` utility on either section would beat the [hidden] UA
    // rule in the built Tailwind CSS and show both lists at once.
    for (const panel of [savedPanel, recentPanel]) {
      expect(panel.className).not.toMatch(/\b(flex|grid|block|inline|inline-flex|table)\b/);
    }

    await user.click(recentTab);
    expect(savedPanel).not.toBeVisible();
    expect(recentPanel).toBeVisible();
  });

  it('supports Home and End in the tablist (M9)', async () => {
    render(<SavedScreen now={NOW} />);
    const savedTab = screen.getByRole('tab', { name: /saved/i });
    const recentTab = screen.getByRole('tab', { name: /recent/i });

    await user.click(savedTab);
    await user.keyboard('{End}');
    expect(recentTab).toHaveFocus();
    expect(recentTab).toHaveAttribute('aria-selected', 'true');
    expect(recentTab).toHaveAttribute('tabindex', '0');

    await user.keyboard('{Home}');
    expect(savedTab).toHaveFocus();
    expect(savedTab).toHaveAttribute('aria-selected', 'true');
    expect(savedTab).toHaveAttribute('tabindex', '0');
  });
});

describe('SavedScreen delete, undo and recent expiry', () => {
  it('deletes with undo and expires recents after 30 days', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    seedRecents([
      storedRow(MRT_PLAN, '2026-09-01T08:00:00.000Z', {
        itinerary: { ...MRT_ITINERARY, id: 'old-recent' },
      }),
      storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z', {
        itinerary: { ...MRT_ITINERARY, id: 'fresh-recent' },
      }),
    ]);

    render(<SavedScreen now={NOW} />);

    const row = await screen.findByTestId('saved-row');
    // The swipe has a visible, keyboard-reachable alternative (a11y).
    expect(screen.getByTestId('delete-saved')).toBeInTheDocument();

    fireEvent.pointerDown(row, { clientX: 220, clientY: 40 });
    fireEvent.pointerMove(row, { clientX: 100, clientY: 40 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 40 });

    await waitFor(() => expect(screen.queryByTestId('saved-row')).not.toBeInTheDocument());
    expect(readSavedTrips()).toEqual([]);
    expect(screen.getByTestId('undo-toast')).toBeInTheDocument();
    // Focus leaves the removed row for a deliberate target (M9).
    await waitFor(() => expect(screen.getByRole('button', { name: /^undo$/i })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /^undo$/i }));

    expect(await screen.findByTestId('saved-row')).toBeInTheDocument();
    expect(readSavedTrips()).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: /recent/i }));
    expect(screen.getAllByTestId('recent-row')).toHaveLength(1);
    expect(readRecentTrips(NOW).map((trip) => trip.itinerary.id)).toEqual(['fresh-recent']);
    expect(screen.queryByText('old-recent')).toBeNull();
  });

  it('also deletes from the explicit button for non-pointer users', async () => {
    seedSaved([storedRow()]);
    render(<SavedScreen now={NOW} />);

    await user.click(await screen.findByTestId('delete-saved'));

    expect(screen.queryByTestId('saved-row')).not.toBeInTheDocument();
    expect(readSavedTrips()).toEqual([]);
  });

  it('cannot turn a release outside the row into a delete (M2)', async () => {
    seedSaved([storedRow()]);
    render(<SavedScreen now={NOW} />);

    const row = await screen.findByTestId('saved-row');
    fireEvent.pointerDown(row, { clientX: 220, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(row, { clientX: 100, clientY: 40, pointerId: 1 });
    // The pointer leaves the row and the release lands on another element: no
    // pointerup reaches the row handler, so the offset must be reset.
    fireEvent.pointerLeave(row, { clientX: 100, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(document.body, { clientX: 100, clientY: 40, pointerId: 1 });

    // A later tap must not consume a stale ≤ −72 offset.
    fireEvent.pointerDown(row, { clientX: 100, clientY: 40, pointerId: 2 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 40, pointerId: 2 });

    expect(screen.getByTestId('saved-row')).toBeInTheDocument();
    expect(readSavedTrips()).toHaveLength(1);
    expect(screen.queryByTestId('undo-toast')).toBeNull();
  });
});

describe('SavedScreen does not blank on a silent network', () => {
  it('does not clear the screen when the network is silent', async () => {
    seedSaved([storedRow()]);
    server.use(fareStatusPendingHandler);
    vi.useFakeTimers();

    render(<SavedScreen now={NOW} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByTestId('saved-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('saved-row')).toHaveLength(1);
    expect(screen.getByTestId('saved-updated')).toHaveTextContent(/last updated/i);
  });
});

describe('SavedScreen honesty labels', () => {
  it('labels every saved ETA and follows offline/online events', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    render(<SavedScreen now={NOW} />);

    const eta = await screen.findByTestId('saved-eta');
    expect(eta).toHaveTextContent(/saved snapshot \(no live eta\)/i);
    expect(screen.queryByTestId('offline-badge')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('offline-badge')).toBeInTheDocument();
    for (const label of screen.getAllByTestId('saved-eta')) {
      expect(label).toHaveTextContent(/saved route \(no live data\)/i);
    }

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('offline-badge')).toBeNull();
  });

  it('flags a changed PUV fare matrix and never recomputes the saved fare', async () => {
    seedSaved([
      storedRow(planCubaoAyalaResponse, '2026-10-30T08:00:00.000Z', {
        fareSnapshot: { ...PUV_ITINERARY.fare, effective_from: '2026-06-01' },
      }),
    ]);
    render(<SavedScreen now={NOW} />);

    // A PUV quote effective 2026-06-01 vs the API matrix 2026-09-28 is a real
    // matrix change (R73: only PUV quotes may use the PUV matrix comparison).
    expect(await screen.findByText(/kasalukuyang fare matrix: 2026-09-28/i)).toBeInTheDocument();
    expect(screen.getByTestId('fare-staleness')).toHaveTextContent(
      /fare may have changed since you saved this/i,
    );
    // The displayed fare is still the API-returned snapshot, not a re-quote.
    expect(screen.getByTestId('saved-fare')).toHaveTextContent('₱26.40');
    expect(screen.getByTestId('saved-fare')).toHaveTextContent('2026-06-01');
  });

  it('keeps the PUV matrix date off a rail snapshot (R73)', async () => {
    seedSaved([
      // The PUV row's fresh note proves the matrix request has resolved.
      storedRow(planCubaoAyalaResponse, '2026-10-30T08:00:00.000Z'),
      storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z'),
    ]);
    render(<SavedScreen now={NOW} />);

    expect(await screen.findByText(/pareho ang fare matrix \(2026-09-28\)/i)).toBeInTheDocument();

    const railFare = screen
      .getAllByTestId('saved-fare')
      .find((element) => element.textContent?.includes('2026-03-23'));
    expect(railFare).toBeDefined();
    const railCard = railFare!.closest('li');
    expect(railCard).not.toBeNull();
    const rail = within(railCard as HTMLElement);
    expect(rail.getByText(/hindi puv fare ang snapshot na ito/i)).toBeInTheDocument();
    expect(rail.getByTestId('fare-staleness')).toHaveTextContent(
      /fare may have changed since you saved this/i,
    );
    // The MRT quote's 2026-03-23 rail matrix is never compared with, or
    // presented as, the PUV matrix date.
    expect(rail.queryByText(/kasalukuyang fare matrix/i)).toBeNull();
    expect(rail.queryByText(/pareho ang fare matrix/i)).toBeNull();
    expect(rail.getByTestId('saved-fare')).toHaveTextContent('2026-03-23');
  });

  it('never certifies freshness when the matrix check fails (M7)', async () => {
    seedSaved([storedRow(planCubaoAyalaResponse, '2026-10-30T08:00:00.000Z')]);
    server.use(fareStatusErrorHandler);
    render(<SavedScreen now={NOW} />);

    expect(await screen.findByTestId('fare-staleness')).toHaveTextContent(
      /fare may have changed since you saved this/i,
    );
    expect(screen.getByText(/hindi ma-check ang fare matrix ngayon/i)).toBeInTheDocument();
    expect(screen.queryByText(/pareho ang fare matrix/i)).toBeNull();
    expect(screen.queryByText(/kasalukuyang fare matrix/i)).toBeNull();
  });

  it('does not claim a change when the snapshot matches the current matrix', async () => {
    seedSaved([storedRow(planCubaoAyalaResponse, '2026-10-30T08:00:00.000Z')]);
    render(<SavedScreen now={NOW} />);

    expect(await screen.findByText(/pareho ang fare matrix \(2026-09-28\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId('fare-staleness')).toBeNull();
  });
});

describe('SavedScreen rename', () => {
  it('persists a renamed trip across a remount', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    const { unmount } = render(<SavedScreen now={NOW} />);

    await user.click(await screen.findByRole('button', { name: /palitan ang pangalan/i }));
    const input = screen.getByLabelText(/pangalan ng biyahe/i);
    await user.clear(input);
    await user.type(input, 'Bahay → Opisina');
    await user.click(screen.getByRole('button', { name: /i-save ang pangalan/i }));

    expect(await screen.findByRole('heading', { name: 'Bahay → Opisina' })).toBeInTheDocument();
    expect(readSavedTrips()[0]?.nickname).toBe('Bahay → Opisina');

    unmount();
    render(<SavedScreen now={NOW} />);
    expect(await screen.findByRole('heading', { name: 'Bahay → Opisina' })).toBeInTheDocument();
  });
});

describe('/trip/:id saved-store fallback', () => {
  it('opens a saved trip after reload when the in-memory plan cache is empty', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <MemoryRouter initialEntries={[`/trip/${MRT_ITINERARY.id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(screen.getByTestId('saved-snapshot-note')).toHaveTextContent(
      /saved route \(no live data\)/i,
    );
    expect(screen.getByTestId('saved-snapshot-note')).toHaveTextContent(/last updated/i);
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('31 min');
    // A reload is served by the store, not by inventing a plan-by-id request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('recent trip recording (M6)', () => {
  it('records a fresh /trip/:id view as a recent trip', async () => {
    rememberPlan(MRT_PLAN);

    render(
      <MemoryRouter initialEntries={[`/trip/${MRT_ITINERARY.id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();
    expect(readRecentTrips().map((trip) => trip.itinerary.id)).toEqual([MRT_ITINERARY.id]);
  });

  it('does not record a saved-snapshot deep link as a recent trip', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);

    render(
      <MemoryRouter initialEntries={[`/trip/${MRT_ITINERARY.id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('saved-snapshot-note')).toBeInTheDocument();
    expect(readRecentTrips()).toEqual([]);
  });
});

describe('SavedScreen accessibility', () => {
  it('has no axe violations with saved and recent trips', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    seedRecents([storedRow(MRT_PLAN, '2026-10-31T08:00:00.000Z')]);
    const { container } = render(<SavedScreen now={NOW} onSearch={() => {}} />);

    expect(await screen.findByTestId('saved-row')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /recent/i }));
    expect(screen.getByTestId('recent-row')).toBeInTheDocument();

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
