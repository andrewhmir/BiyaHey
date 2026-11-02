import type { SearchResponse, SearchResultDto } from '@biyahey/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '../../app';
import { server } from '../../test/msw/server';
import {
  ayalaSearchResponse,
  cubaoSearchResponse,
  emptySearchHandler,
  partialEmptySearchHandler,
  partialSearchHandler,
  searchErrorHandler,
  searchNetworkErrorHandler,
  searchSlowHandler,
  searchSuccessHandler,
} from '../../test/msw/handlers';
import { SearchScreen } from './SearchScreen';
import { SAVED_PLACES_KEY } from './savedPlaces';
import { SEARCH_CACHE_KEY, writeSearchCache } from './searchCache';
import { buildPlanPath } from './tripParams';

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

/** Seed a raw cache entry, including payloads the typed writer would reject. */
function seedSearchCache(query: string, response: unknown): void {
  window.localStorage.setItem(
    SEARCH_CACHE_KEY,
    JSON.stringify([{ query, response, savedAt: Date.now() }]),
  );
}

/** Records the router location so navigation targets are assertable. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPlanner(entry = '/search') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const user: UserEvent = vi.isFakeTimers()
    ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    : userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <SearchScreen />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, queryClient, ...utils };
}

const fromBox = () => screen.getByRole('searchbox', { name: /mula sa/i });
const toBox = () => screen.getByRole('searchbox', { name: /papunta sa/i });
const stopBox = (index: number) =>
  screen.getByRole('searchbox', { name: new RegExp(`hintuan ${index}`, 'i') });
const addStopButton = () => screen.getByRole('button', { name: /magdagdag ng hintuan/i });
const findRouteButton = () => screen.getByRole('button', { name: /maghanap ng ruta/i });
const locateButton = () => screen.getByRole('button', { name: /gamitin ang lokasyon ko/i });
const swapButton = () =>
  screen.getByRole('button', { name: /palitan ang mula at papunta/i });

function paramsFromPath(path: string): URLSearchParams {
  return new URL(path, 'https://app.test').searchParams;
}

async function pickPlace(
  user: UserEvent,
  box: HTMLElement,
  query: string,
  resultName: RegExp,
): Promise<void> {
  await user.type(box, query);
  await user.click(await screen.findByRole('button', { name: resultName }, WAIT));
}

async function pickFrom(user: UserEvent): Promise<void> {
  await pickPlace(user, fromBox(), 'ayala', /ayala terminal/i);
}

async function pickTo(user: UserEvent): Promise<void> {
  await pickPlace(user, toBox(), 'cubao', /^cubao\b/i);
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

describe('SearchScreen directions form', () => {
  it('renders the labelled trip form, an autofocused empty field and a disabled CTA', () => {
    renderPlanner();

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plano ng biyahe' })).toBeInTheDocument();
    expect(fromBox()).toHaveValue('');
    expect(toBox()).toHaveValue('');
    // Autofocus lands on the first empty field (From).
    expect(fromBox()).toHaveFocus();

    expect(findRouteButton()).toBeDisabled();
    expect(addStopButton()).toBeEnabled();
    expect(locateButton()).toBeInTheDocument();
    expect(swapButton()).toBeInTheDocument();
  });

  it('debounces the active field query before rendering grouped results', async () => {
    // Fake timers make the 249/250 ms boundary observable. The change is fired
    // directly (not via userEvent) so React's timer plumbing cannot overshoot.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    renderPlanner();

    fireEvent.change(fromBox(), { target: { value: 'ayala' } });
    await advanceBy(DEBOUNCE_MS - 1);
    expect(fetchSpy).not.toHaveBeenCalled();

    await advanceBy(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await flushUntilReady(() => screen.queryByText('Ayala Triangle Gardens') !== null);

    expect(screen.getByRole('heading', { name: /^stops$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^landmarks$/i })).toBeInTheDocument();
    expect(screen.getByText('≈ 120 m')).toBeInTheDocument();
    expect(screen.getByTestId('search-status')).toHaveTextContent(/4 resulta/i);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/search?q=ayala');
  });

  it('fills From, moves focus to To, and enables the CTA only when both ends are set', async () => {
    const { user } = renderPlanner();

    await pickFrom(user);
    expect(fromBox()).toHaveValue('Ayala Terminal, Makati');
    expect(toBox()).toHaveFocus();
    expect(findRouteButton()).toBeDisabled();

    await pickTo(user);
    expect(toBox()).toHaveValue('Cubao, Quezon City');
    expect(findRouteButton()).toBeEnabled();
  });

  it('clears the previous field results before they can be picked as the new field', async () => {
    // Live-E2E regression (R89): selecting the destination and then immediately
    // typing in From used to leave the To query's "Cubao" results rendered for
    // the whole 250 ms debounce window, so the first tap picked Cubao as the
    // start and /plan received origin === destination. Fake timers make the
    // window observable instead of racing it.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    renderPlanner();

    // Fill the To session: type, wait out the debounce, pick the Cubao stop.
    fireEvent.change(toBox(), { target: { value: 'cubao' } });
    await advanceBy(DEBOUNCE_MS);
    await flushUntilReady(() => screen.queryByTestId('search-group-stops') !== null);
    fireEvent.click(within(screen.getByTestId('search-group-stops')).getByRole('button'));
    expect(toBox()).toHaveValue('Cubao, Quezon City');

    // The From session starts clean: the To results are gone on the next render.
    fireEvent.change(fromBox(), { target: { value: 'ayala' } });
    expect(screen.queryByTestId('search-group-stops')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-status')).toHaveTextContent(/naghahanap/i);

    // The real From results arrive after the debounce and fill the right field.
    await advanceBy(DEBOUNCE_MS);
    await flushUntilReady(() => screen.queryByTestId('search-group-stops') !== null);
    fireEvent.click(
      within(screen.getByTestId('search-group-stops')).getByRole('button', {
        name: /ayala terminal/i,
      }),
    );
    expect(fromBox()).toHaveValue('Ayala Terminal, Makati');
    expect(toBox()).toHaveValue('Cubao, Quezon City');
  });

  it('navigates to /plan with the explicit from and destination', async () => {
    const { user } = renderPlanner();
    await pickFrom(user);
    await pickTo(user);

    await user.click(findRouteButton());

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/plan\?/),
    );
    const params = paramsFromPath(screen.getByTestId('location').textContent ?? '');
    expect(params.get('from')).toBe('14.549272,121.029103');
    expect(params.get('fromName')).toBe('Ayala Terminal, Makati');
    expect(params.get('dest')).toBe('14.6194,121.0531');
    expect(params.get('name')).toBe('Cubao, Quezon City');
    expect(params.has('via')).toBe(false);
  });

  it('adds a stop, offers Stops only, and carries the chosen stop id in via', async () => {
    const { user } = renderPlanner();
    await pickFrom(user);
    await pickTo(user);

    await user.click(addStopButton());
    expect(stopBox(1)).toHaveFocus();

    await user.type(stopBox(1), 'ayala');
    expect(
      await screen.findByRole('heading', { name: /^stops$/i }, WAIT),
    ).toBeInTheDocument();
    // Stop pickers must not offer landmarks: the router needs a stop id.
    expect(screen.queryByRole('heading', { name: /^landmarks$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Ayala Triangle Gardens')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /ayala terminal/i }));

    await user.click(findRouteButton());
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/plan\?/),
    );
    const path = screen.getByTestId('location').textContent ?? '';
    const params = paramsFromPath(path);
    expect(params.get('fromName')).toBe('Ayala Terminal, Makati');
    // One URLSearchParams read decodes the JSON exactly once.
    expect(JSON.parse(params.get('via') ?? '[]')).toEqual([
      {
        lat: 14.549272,
        lon: 121.029103,
        stopId: 'gtfs_bus-lx:node:6014597491',
        name: 'Ayala Terminal',
      },
    ]);
    // Single encoding in the raw string, not a double-encoded blob.
    expect(path).toContain('via=%5B%7B%22lat%22%3A14.549272');
  });

  it('caps added stops at two and removes a row again', async () => {
    const { user } = renderPlanner();

    await user.click(addStopButton());
    await user.click(addStopButton());
    expect(stopBox(1)).toBeInTheDocument();
    expect(stopBox(2)).toBeInTheDocument();
    expect(addStopButton()).toBeDisabled();
    expect(addStopButton()).toHaveTextContent('(2/2)');

    await user.click(
      within(screen.getByTestId('stop-row-2')).getByRole('button', { name: /alisin/i }),
    );

    expect(screen.queryByTestId('stop-row-2')).not.toBeInTheDocument();
    expect(stopBox(1)).toBeInTheDocument();
    expect(addStopButton()).toBeEnabled();
  });

  it('says honestly when a stop query matches no stops', async () => {
    server.use(
      http.get('*/search', () =>
        HttpResponse.json({
          partial: false,
          groups: {
            stops: [],
            landmarks: ayalaSearchResponse.groups.landmarks,
            routes: [],
            saved: [],
          },
        }),
      ),
    );
    const { user } = renderPlanner();

    await user.click(addStopButton());
    await user.type(stopBox(1), 'ayala');

    expect(
      await screen.findByText(/walang hintuang nakita/i, {}, WAIT),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^landmarks$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-group-landmarks')).not.toBeInTheDocument();
  });

  it('swaps the from and to places', async () => {
    const { user } = renderPlanner();
    await pickFrom(user);
    await pickTo(user);

    await user.click(swapButton());

    expect(fromBox()).toHaveValue('Cubao, Quezon City');
    expect(toBox()).toHaveValue('Ayala Terminal, Makati');
  });

  it('drops a picked value as soon as the rider edits that field', async () => {
    const { user } = renderPlanner();
    await pickFrom(user);
    await pickTo(user);
    expect(findRouteButton()).toBeEnabled();

    // Editing the destination text without choosing a suggestion must not leave
    // the previous destination in the submitted trip (R89 review).
    await user.type(toBox(), 'x');
    expect(findRouteButton()).toBeDisabled();

    await user.clear(toBox());
    await pickTo(user);
    expect(findRouteButton()).toBeEnabled();
  });

  it('keeps keyboard focus inside the form after picks and stop removal', async () => {
    const { user } = renderPlanner();

    // Choosing To first leaves From as the next empty endpoint.
    await pickTo(user);
    expect(fromBox()).toHaveFocus();

    await pickFrom(user);
    expect(findRouteButton()).toHaveFocus();

    // Adding a stop focuses its row; picking the stop returns focus to the CTA.
    await user.click(addStopButton());
    expect(stopBox(1)).toHaveFocus();
    await user.type(stopBox(1), 'ayala');
    await user.click(await screen.findByRole('button', { name: /ayala terminal/i }, WAIT));
    expect(findRouteButton()).toHaveFocus();

    // Removing the row must not drop focus to <body>.
    await user.click(
      within(screen.getByTestId('stop-row-1')).getByRole('button', { name: /alisin/i }),
    );
    expect(addStopButton()).toHaveFocus();
  });

  it('fills From from one bounded geolocation read on tap, never automatically', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 14.5547, longitude: 121.0244 },
      } as GeolocationPosition);
    });
    vi.stubGlobal('navigator', {
      ...window.navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const { user } = renderPlanner();

    expect(getCurrentPosition).not.toHaveBeenCalled();
    await user.click(locateButton());

    await waitFor(() => expect(fromBox()).toHaveValue('Kasalukuyang lokasyon'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(toBox()).toHaveValue('');
  });

  it('reports a denied location honestly instead of inventing a start', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1 } as GeolocationPositionError);
      },
    );
    vi.stubGlobal('navigator', {
      ...window.navigator,
      onLine: true,
      geolocation: { getCurrentPosition },
    });
    const { user } = renderPlanner();

    await user.click(locateButton());

    expect(await screen.findByTestId('locate-note')).toHaveTextContent(
      /hindi pinayagan ang lokasyon/i,
    );
    expect(fromBox()).toHaveValue('');
    expect(findRouteButton()).toBeDisabled();
  });

  it('prefills the form from the same query parameters used by /plan', () => {
    const stop = { lat: 14.58, lon: 121.04, stopId: 'stop-one', name: 'One Ayala' };
    const planPath = buildPlanPath({
      from: { lat: 14.549272, lon: 121.029103 },
      fromName: 'Ayala Terminal, Makati',
      dest: { lat: 14.6194, lon: 121.0531 },
      destName: 'Cubao, Quezon City',
      stops: [stop],
    });
    renderPlanner(planPath.replace('/plan?', '/search?'));

    expect(fromBox()).toHaveValue('Ayala Terminal, Makati');
    expect(toBox()).toHaveValue('Cubao, Quezon City');
    expect(stopBox(1)).toHaveValue('One Ayala');
    expect(findRouteButton()).toBeEnabled();
  });

  it('shows the offline state with saved places when the API is unreachable', async () => {
    seedSavedPlaces([savedHome]);
    server.use(searchNetworkErrorHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ayala');

    expect(
      await screen.findByText('Walang signal — showing saved places', {}, WAIT),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /saved places/i })).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(screen.queryByText('Ayala Triangle Gardens')).not.toBeInTheDocument();
  });

  it('falls back to saved places without a request when the browser reports offline', async () => {
    seedSavedPlaces([savedHome]);
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ayala');

    expect(
      await screen.findByText('Walang signal — showing saved places', {}, WAIT),
    ).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows an error state with a retry that recovers', async () => {
    server.use(searchErrorHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ayala');

    expect(await screen.findByText(/hindi ma-load/i, {}, WAIT)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /subukan ulit/i });

    server.use(searchSuccessHandler);
    await user.click(retry);

    expect(await screen.findByText('Ayala Triangle Gardens', {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/hindi ma-load/i)).not.toBeInTheDocument();
  });

  it('shows an honest note when the API reports partial results', async () => {
    server.use(partialSearchHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ayala');

    expect(await screen.findByText(/results may be incomplete/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('search-status')).toHaveTextContent(/1 resulta/i);
  });

  it('shows a no-results message instead of an empty screen', async () => {
    server.use(emptySearchHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'zzzzzz');

    expect(await screen.findByText(/walang resulta/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('search-status')).toHaveTextContent(
      'Walang resulta para sa “zzzzzz”.',
    );
    expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
  });

  it('keeps the partial caveat when the API returns zero results', async () => {
    server.use(partialEmptySearchHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'zzzzzz');

    expect(await screen.findByText(/results may be incomplete/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('search-status')).toHaveTextContent(
      'Walang kumpletong resulta para sa “zzzzzz”.',
    );
    expect(screen.queryByText('Walang resulta para sa “zzzzzz”.')).not.toBeInTheDocument();
  });

  it('shows recents and saved places before a query, and a recent fills the active field', async () => {
    seedSavedPlaces([savedHome]);
    writeSearchCache('cubao', cubaoSearchResponse);

    const { user } = renderPlanner();

    expect(screen.getByRole('heading', { name: /mga kamakailang hanap/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^saved$/i })).toBeInTheDocument();
    expect(screen.getByText('Bahay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cubao' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'cubao' }));
    expect(fromBox()).toHaveValue('cubao');
  });

  it('ignores a cached response with a corrupt group row instead of crashing', async () => {
    seedSearchCache('zzzzzz', {
      partial: false,
      groups: { stops: [null], landmarks: [], routes: [], saved: [] },
    });
    server.use(emptySearchHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'zzzzzz');

    expect(await screen.findByText(/walang resulta/i, {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByTestId('search-group-stops')).not.toBeInTheDocument();
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

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ay');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), WAIT);

    const firstSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    await user.type(fromBox(), 'a');
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

  it('aborts the in-flight request when the screen unmounts', async () => {
    server.use(searchSlowHandler);

    const { user, unmount } = renderPlanner();
    await user.type(fromBox(), 'ayala');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), WAIT);

    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    await waitFor(() => expect(signal?.aborted).toBe(true), WAIT);
  });

  it('announces a loading state while a slow search is in flight', async () => {
    server.use(searchSlowHandler);

    const { user } = renderPlanner();
    await user.type(fromBox(), 'ayala');

    expect(await screen.findByText(/naghahanap/i, {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('Ayala Triangle Gardens', {}, WAIT)).toBeInTheDocument();
  });

  it('has no axe violations with the directions form and grouped results', async () => {
    const { container, user } = renderPlanner();
    await user.type(fromBox(), 'ayala');
    await screen.findByText('Ayala Triangle Gardens', {}, WAIT);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('Home to search navigation', () => {
  it('opens the directions form when the Home search pill is activated', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /saan ka pupunta/i }));

    expect(await screen.findByRole('search', {}, WAIT)).toBeInTheDocument();
    expect(
      await screen.findByRole('searchbox', { name: /papunta sa/i }, WAIT),
    ).toBeInTheDocument();
  });
});
