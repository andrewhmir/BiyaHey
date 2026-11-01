import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { PlanResponse } from '@biyahey/shared';
import {
  RECENT_TRIPS_KEY,
  SAVED_TRIPS_KEY,
  readRecentTrips,
  readSavedTrips,
  type SavedTrip,
} from '../../lib/savedTripsStore';
import { AppRoutes } from '../../routes';
import {
  fareStatusPendingHandler,
  planCubaoAyalaResponse,
  planMrt3CubaoAyalaResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { clearPlanCache } from '../routes/planCache';
import { SavedScreen } from './SavedScreen';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const NOW = new Date('2026-11-02T03:00:00.000Z');
const MRT_PLAN = planMrt3CubaoAyalaResponse;
const MRT_ITINERARY = MRT_PLAN.itineraries[0]!;

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

  it('flags a changed fare matrix and never recomputes the saved fare', async () => {
    seedSaved([storedRow(MRT_PLAN, '2026-10-30T08:00:00.000Z')]);
    render(<SavedScreen now={NOW} />);

    // The MRT fixture's quote is effective 2026-03-23; the API matrix is
    // 2026-09-28, so the snapshot must be flagged.
    expect(await screen.findByText(/kasalukuyang fare matrix: 2026-09-28/i)).toBeInTheDocument();
    expect(screen.getByTestId('fare-staleness')).toHaveTextContent(
      /fare may have changed since you saved this/i,
    );
    // The displayed fare is still the API-returned snapshot, not a re-quote.
    expect(screen.getByTestId('saved-fare')).toHaveTextContent('₱10.50');
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
