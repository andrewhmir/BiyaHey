import type { SearchResponse, SearchResultDto } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '../../app';
import { server } from '../../test/msw/server';
import {
  ayalaSearchResponse,
  cubaoSearchResponse,
  emptySearchHandler,
  partialSearchHandler,
  searchErrorHandler,
  searchNetworkErrorHandler,
  searchSlowHandler,
  searchSuccessHandler,
} from '../../test/msw/handlers';
import { SearchScreen } from './SearchScreen';
import { SAVED_PLACES_KEY } from './savedPlaces';
import { writeSearchCache } from './searchCache';

// The brief pins the debounce at 250 ms; hard-code it here so the test still
// fails if the implementation drifts rather than importing its constant.
const DEBOUNCE_MS = 250;
const WAIT = { timeout: 3000 };
// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here; token
// contrast is reviewed against `tokens.css` instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const savedHome: SearchResultDto = {
  id: 'saved-home',
  name: 'Bahay',
  label: 'Bahay, Quezon City',
  type: 'landmark',
  lat: 14.676,
  lon: 121.0437,
  locality: 'Quezon City',
  source_id: 'osm',
};

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch');
}

let fetchSpy: ReturnType<typeof spyOnFetch>;

function seedSavedPlaces(places: SearchResultDto[]): void {
  window.localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(places));
}

function renderSearchScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const user: UserEvent = vi.isFakeTimers()
    ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    : userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/search']}>
        <SearchScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, queryClient, ...utils };
}

async function typeQuery(user: UserEvent, text: string): Promise<void> {
  await user.type(screen.getByRole('searchbox'), text);
}

/** Advance fake timers inside `act` so React flushes the resulting render. */
async function advanceBy(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * With fake timers active, RTL's `findBy*` never advances its own polling
 * timer, so poll manually while advancing.
 */
async function flushUntilReady(read: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (read()) {
      return;
    }
    await advanceBy(10);
  }
  throw new Error('The expected UI state did not appear.');
}

beforeEach(() => {
  window.localStorage.clear();
  fetchSpy = spyOnFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('SearchScreen', () => {
  it('labels the searchbox and debounces the query before rendering grouped results', async () => {
    // Fake timers make the 249/250 ms boundary observable. `setImmediate` stays
    // real because React's act() flushes its queue through it; the change is
    // fired directly (not via userEvent) so React's timer-advance plumbing
    // cannot overshoot the debounce window.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    renderSearchScreen();

    expect(screen.getByRole('searchbox', { name: /maghanap ng lugar/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Saan ka pupunta?')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ayala' } });
    await advanceBy(DEBOUNCE_MS - 1);
    expect(fetchSpy).not.toHaveBeenCalled();

    await advanceBy(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await flushUntilReady(() => screen.queryByText('Ayala Triangle Gardens') !== null);

    // Grouped sections: Stops before Landmarks, each with its heading.
    expect(screen.getByRole('heading', { name: /^stops$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^landmarks$/i })).toBeInTheDocument();

    // Distance rendering from `distanceM`, in metres and kilometres.
    expect(screen.getByText('≈ 120 m')).toBeInTheDocument();
    expect(screen.getByText('≈ 1.2 km')).toBeInTheDocument();

    // The live region announces the result count for the debounced query.
    expect(screen.getByRole('status')).toHaveTextContent(/4 resulta/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/search?q=ayala');
  });

  it('renders all four groups: Stops, Landmarks, Routes and Saved', async () => {
    const route: SearchResultDto = {
      id: 'route-edsa',
      name: 'EDSA Carousel',
      label: 'EDSA Carousel',
      type: 'stop',
      lat: 14.5547,
      lon: 121.0244,
      locality: null,
      source_id: 'osm',
    };
    server.use(
      http.get('*/search', () =>
        HttpResponse.json({
          partial: false,
          groups: {
            stops: ayalaSearchResponse.groups.stops,
            landmarks: ayalaSearchResponse.groups.landmarks,
            routes: [route],
            saved: [savedHome],
          },
        }),
      ),
    );

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByRole('heading', { name: /^routes$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^saved$/i })).toBeInTheDocument();
    expect(screen.getByText('EDSA Carousel')).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
  });

  it('renders locality as the subtitle and a distance only when the API sends one', async () => {
    const museum: SearchResultDto = {
      id: 'landmark-museum',
      name: 'Ayala Museum',
      label: 'Ayala Museum, Makati',
      type: 'landmark',
      lat: 14.5535,
      lon: 121.0271,
      locality: 'Makati',
      source_id: 'osm',
    };
    server.use(
      http.get('*/search', () =>
        HttpResponse.json({
          partial: false,
          groups: { stops: [], landmarks: [museum], routes: [], saved: [] },
        }),
      ),
    );

    const { user } = renderSearchScreen();
    await typeQuery(user, 'museum');

    const row = await screen.findByRole('button', { name: /ayala museum/i });
    expect(within(row).getByText('Makati')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('≈');
  });

  it('shows recents and saved places before a query instead of a blank screen', async () => {
    seedSavedPlaces([savedHome]);
    writeSearchCache('cubao', cubaoSearchResponse);

    const { user } = renderSearchScreen();

    expect(screen.getByRole('heading', { name: /mga kamakailang hanap/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^saved$/i })).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cubao' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'cubao' }));
    expect(screen.getByRole('searchbox')).toHaveValue('cubao');
  });

  it('shows the offline state with saved places when the API is unreachable', async () => {
    seedSavedPlaces([savedHome]);
    server.use(searchNetworkErrorHandler);

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByText(/walang signal/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/showing saved places/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /saved places/i })).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(screen.queryByText('Ayala Triangle Gardens')).not.toBeInTheDocument();
  });

  it('falls back to saved places without a request when the browser reports offline', async () => {
    seedSavedPlaces([savedHome]);
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByText(/walang signal/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows an error state with a retry that recovers', async () => {
    server.use(searchErrorHandler);

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByText(/hindi ma-load/i, {}, WAIT)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /subukan ulit/i });

    server.use(searchSuccessHandler);
    await user.click(retry);

    expect(await screen.findByText('Ayala Triangle Gardens', {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/hindi ma-load/i)).not.toBeInTheDocument();
  });

  it('shows an honest note when the API reports partial results', async () => {
    server.use(partialSearchHandler);

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByText(/results may be incomplete/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/1 resulta/i);
  });

  it('shows a no-results message instead of an empty screen', async () => {
    server.use(emptySearchHandler);

    const { user } = renderSearchScreen();
    await typeQuery(user, 'zzzzzz');

    expect(await screen.findByText(/walang resulta/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
  });

  it('cancels the in-flight request when the next keystroke starts a newer one', async () => {
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const stale: SearchResultDto = {
      id: 'stale',
      name: 'Stale Ayala',
      label: 'Stale Ayala',
      type: 'stop',
      lat: 1,
      lon: 1,
      locality: null,
      source_id: 'osm',
    };
    const current: SearchResultDto = {
      id: 'current',
      name: 'Current Ayala',
      label: 'Current Ayala',
      type: 'stop',
      lat: 2,
      lon: 2,
      locality: null,
      source_id: 'osm',
    };
    const queries: string[] = [];
    const responseFor = (result: SearchResultDto): SearchResponse => ({
      partial: false,
      groups: { stops: [result], landmarks: [], routes: [], saved: [] },
    });
    server.use(
      http.get('*/search', async ({ request }) => {
        const query = new URL(request.url).searchParams.get('q') ?? '';
        queries.push(query);
        if (query === 'ay') {
          await firstGate;
          return HttpResponse.json(responseFor(stale));
        }
        return HttpResponse.json(responseFor(current));
      }),
    );

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ay');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), WAIT);

    const firstSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    // The second keystroke makes the debounced query "aya"; the older request
    // must be aborted, not left to race the newer response.
    await typeQuery(user, 'a');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), WAIT);

    expect(firstSignal?.aborted).toBe(true);
    expect(await screen.findByText('Current Ayala', {}, WAIT)).toBeInTheDocument();

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });

    expect(queries).toEqual(['ay', 'aya']);
    expect(screen.queryByText('Stale Ayala')).not.toBeInTheDocument();
    expect(screen.getByText('Current Ayala')).toBeInTheDocument();
  });

  it('announces a loading state while a slow search is in flight', async () => {
    server.use(searchSlowHandler);

    const { user } = renderSearchScreen();
    await typeQuery(user, 'ayala');

    expect(await screen.findByText(/naghahanap/i, {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('Ayala Triangle Gardens', {}, WAIT)).toBeInTheDocument();
  });

  it('has no axe violations with grouped results rendered', async () => {
    const { container, user } = renderSearchScreen();
    await typeQuery(user, 'ayala');
    await screen.findByText('Ayala Triangle Gardens', {}, WAIT);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('Home to search navigation', () => {
  it('navigates to /search when the Home search pill is activated', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /saan ka pupunta/i }));

    expect(
      await screen.findByRole('searchbox', { name: /maghanap ng lugar/i }, WAIT),
    ).toBeInTheDocument();
  });
});
