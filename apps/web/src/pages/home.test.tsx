import type { ItineraryDto } from '@biyahey/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { makeItinerary, makeLeg, makeRailTrip } from '../test/fixtures/itinerary';
import { RECENT_TRIPS_KEY } from '../lib/savedTripsStore';
import { HomePage, HOME_RECENTS_LIMIT } from './home';

// jsdom has no canvas, so the MapLibre-backed MapView is replaced by a stub:
// these tests are about the sheet, not the map (the map integration test lives
// in `components/map/map.test.tsx`).
vi.mock('../components/map/MapView', () => ({
  MapView: () => <div data-testid="map-view" />,
}));

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here; token
// contrast is reviewed against `tokens.css` instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function place(name: string) {
  return { name, lat: 14.62, lon: 121.05 };
}

/** An itinerary whose endpoints helper yields exactly `from → to`. */
function itineraryBetween(id: string, from: string, to: string): ItineraryDto {
  return makeItinerary(
    [
      makeLeg({ mode: 'walk', from: place(from), to: place('Sakayan') }),
      makeLeg({
        mode: 'jeepney',
        from: place('Sakayan'),
        to: place(to),
        routeShortName: 'JEEP',
        stops: [{ name: 'Sakayan', lat: 14.62, lon: 121.05 }],
      }),
    ],
    { id },
  );
}

function recentRow(itinerary: ItineraryDto): unknown {
  return {
    itinerary,
    sources: [],
    fareSnapshot: itinerary.fare,
    datasetVersion: '2026-11-01',
    savedAt: new Date().toISOString(),
  };
}

function seedRecents(rows: unknown[]): void {
  window.localStorage.setItem(RECENT_TRIPS_KEY, JSON.stringify(rows));
}

function searchPill(): HTMLElement {
  return screen.getByRole('button', { name: /saan ka pupunta/i });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('HomePage peek contract', () => {
  it('keeps the search pill as the first element in the sheet body', () => {
    render(<HomePage />);

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-detent', 'peek');

    // jsdom has no layout engine, so "first element rendered in the sheet body"
    // is the proxy for "the only thing fully visible in the 96 px peek strip":
    // 96 px minus the 48 px drag handle leaves one 48 px row (R54).
    const bodyId = screen
      .getByRole('button', { name: /expand sheet/i })
      .getAttribute('aria-controls');
    const body = document.getElementById(bodyId ?? '');
    expect(body).not.toBeNull();
    expect(body?.querySelector('button, h1, h2, h3, p')).toBe(searchPill());
  });

  it('surfaces the search screen from the pill', async () => {
    const user = userEvent.setup();
    const onSearchClick = vi.fn();
    render(<HomePage onSearchClick={onSearchClick} />);

    await user.click(searchPill());

    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });
});

describe('HomePage brand and honest empty state', () => {
  it('shows the wordmark, tagline and an empty recents invitation without invented trips', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'BiyaHey!' })).toBeInTheDocument();
    expect(screen.getByText('Ang plano mo sa bawat biyahe.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /mga kamakailang biyahe/i })).toBeInTheDocument();
    expect(screen.getByTestId('home-recents-empty')).toHaveTextContent(/wala pang biyahe/i);
    expect(screen.queryByTestId('recent-trip')).not.toBeInTheDocument();
  });
});

describe('HomePage recent trips', () => {
  it('renders at most three recents, newest first, with endpoint titles and leg strips', () => {
    const trips = [
      recentRow(itineraryBetween('recent-1', 'Cubao', 'Ayala')),
      recentRow(itineraryBetween('recent-2', 'Guadalupe', 'Ortigas')),
      recentRow(itineraryBetween('recent-3', 'Taft', 'Quezon Ave')),
      recentRow(itineraryBetween('recent-4', 'Monumento', 'Baclaran')),
    ];
    seedRecents(trips);

    render(<HomePage />);

    const rows = screen.getAllByTestId('recent-trip');
    expect(rows).toHaveLength(HOME_RECENTS_LIMIT);
    // The store returns newest first; Home neither re-sorts nor adds its own.
    expect(rows[0]).toHaveTextContent('Cubao → Ayala');
    expect(rows[1]).toHaveTextContent('Guadalupe → Ortigas');
    expect(rows[2]).toHaveTextContent('Taft → Quezon Ave');
    expect(rows[0]).not.toHaveTextContent('Monumento');

    // Every row carries the leg ribbon and the honest duration/fare summary.
    for (const row of rows) {
      expect(within(row).getByTestId('leg-strip')).toHaveAttribute('data-leg-count', '2');
    }
    expect(rows[0]).toHaveTextContent('24 min');
    expect(rows[0]).toHaveTextContent('₱29');
  });

  it('opens the tapped recent trip through the route-layer handoff', async () => {
    const user = userEvent.setup();
    const onOpenRecent = vi.fn();
    seedRecents([recentRow(itineraryBetween('recent-1', 'Cubao', 'Ayala'))]);

    render(<HomePage onOpenRecent={onOpenRecent} />);
    const row = screen.getByTestId('recent-trip');
    await user.click(within(row).getByRole('button'));

    expect(onOpenRecent).toHaveBeenCalledWith('recent-1');
  });

  it('carries the fare effectivity date and snapshot freshness on every row', () => {
    seedRecents([recentRow(itineraryBetween('recent-1', 'Cubao', 'Ayala'))]);

    render(<HomePage />);

    const row = screen.getByTestId('recent-trip');
    // R45/R63: a stored fare must show its own matrix date, and a recent trip
    // must say when it was opened — the same honesty rule as the saved list.
    expect(row).toHaveTextContent(/fare effective \d{4}-\d{2}-\d{2}/);
    expect(row).toHaveTextContent(/Huling binuksan|Na-save noong/);
  });

  it('renders a rail recent with its own endpoint title and fare', () => {
    const rail = makeRailTrip();
    seedRecents([recentRow(rail)]);

    render(<HomePage />);

    const row = screen.getByTestId('recent-trip');
    expect(row).toHaveTextContent('Cubao → Ayala');
    expect(row).toHaveTextContent('₱29');
    expect(within(row).getByTestId('leg-strip')).toHaveAttribute('data-leg-count', '3');
  });

  it('does not crash when the recents store is unreadable', () => {
    seedRecents([recentRow(itineraryBetween('recent-1', 'Cubao', 'Ayala'))]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    render(<HomePage />);

    expect(screen.getByTestId('home-recents-empty')).toBeInTheDocument();
    expect(searchPill()).toBeInTheDocument();
  });
});

describe('HomePage doors', () => {
  it('routes the saved door through the route layer', async () => {
    const user = userEvent.setup();
    const onSavedClick = vi.fn();
    render(<HomePage onSavedClick={onSavedClick} />);

    await user.click(screen.getByRole('button', { name: /naka-save at kamakailan/i }));

    expect(onSavedClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a 48 dp About-data door to /sources', () => {
    render(<HomePage />);

    const about = screen.getByRole('link', { name: /about data/i });
    expect(about).toHaveAttribute('href', '/sources');
    expect(about).toHaveClass('min-h-12');
  });
});

describe('HomePage accessibility', () => {
  it('has no axe violations with an empty sheet', async () => {
    const { container } = render(<HomePage onSavedClick={() => undefined} />);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no axe violations with recent trips', async () => {
    seedRecents([
      recentRow(itineraryBetween('recent-1', 'Cubao', 'Ayala')),
      recentRow(makeRailTrip()),
    ]);
    const { container } = render(<HomePage onSavedClick={() => undefined} />);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
