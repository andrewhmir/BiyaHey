import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { formatFare, transfersLabel, walkLabel } from '../../lib/format';
import { planCubaoAyalaResponse } from '../../test/msw/handlers';
import { makeItinerary, makeLeg, makeWalkOnlyItinerary } from '../../test/fixtures/itinerary';
import { RouteCard, fareEffectiveLine, type RouteBadge } from './RouteCard';

// Registration rows for the checked-in Cubao → Ayala plan: the card only ever
// renders the ids the API returned (R45), resolved against these rows.
const KNOWN_SOURCES: readonly DataSource[] = planCubaoAyalaResponse.sources;

function fare(overrides: Partial<FareQuote> = {}): FareQuote {
  return {
    amount: 29,
    currency: 'PHP',
    confidence: 'official',
    effective_from: '2026-03-23',
    source_id: 'rail-fares',
    breakdown: [{ label: 'MRT-3 published fare (8.2 km)', amount: 29 }],
    ...overrides,
  };
}

interface RenderCardOptions {
  badge?: RouteBadge;
  selected?: boolean;
  sources?: readonly DataSource[];
  onSelect?: (id: string) => void;
}

function renderCard(itineraryOverrides: Partial<ItineraryDto> = {}, options: RenderCardOptions = {}) {
  const itinerary = makeItinerary(
    [
      makeLeg({ mode: 'walk', durationMin: 4, distanceM: 189 }),
      makeLeg({ mode: 'mrt3', durationMin: 20 }),
      makeLeg({ mode: 'walk', durationMin: 6, distanceM: 412 }),
    ],
    {
      id: 'card-trip',
      durationMin: 30,
      endTime: '2026-11-03T06:03:00.000Z',
      transfers: 0,
      walkDistanceM: 601,
      fare: fare(),
      sources: ['osm', 'ltfrb-fares'],
      ...itineraryOverrides,
    },
  );

  return render(
    <RouteCard
      itinerary={itinerary}
      sources={options.sources ?? KNOWN_SOURCES}
      selected={options.selected ?? false}
      onSelect={options.onSelect ?? vi.fn()}
      badge={options.badge}
    />,
  );
}

describe('fareEffectiveLine', () => {
  it('names the LTFRB matrix for an LTFRB-priced quote', () => {
    expect(
      fareEffectiveLine(
        fare({ source_id: 'ltfrb-fares', breakdown: [{ label: 'Jeepney fare', amount: 29 }] }),
      ),
    ).toBe('Fares: LTFRB matrix effective 2026-03-23');
  });

  it('labels a rail quote with the rail matrix, never the LTFRB matrix', () => {
    const line = fareEffectiveLine(
      fare({
        source_id: 'rail-fares',
        confidence: 'estimated',
        breakdown: [{ label: 'MRT-3 published fare (8.2 km)', amount: 20 }],
      }),
    );

    expect(line).toBe('Fares: rail fare matrix effective 2026-03-23');
    expect(line).not.toMatch(/ltfrb/i);
  });

  it('labels a mixed-source (null) quote truthfully, never as the LTFRB matrix', () => {
    const line = fareEffectiveLine(
      fare({
        source_id: null,
        breakdown: [
          { label: '[rail-fares] MRT-3 published fare (8.2 km)', amount: 20 },
          { label: '[ltfrb-fares] Traditional jeepney base fare (first 4 km)', amount: 9 },
        ],
      }),
    );

    expect(line).toBe('Fares: mixed fare sources effective 2026-03-23');
    expect(line).not.toMatch(/ltfrb/i);
  });

  it('does not attribute a walk-only quote to any fare matrix', () => {
    const line = fareEffectiveLine(fare({ amount: 0, source_id: null, breakdown: [] }));

    expect(line).toBe('Fares: no fare effective 2026-03-23');
    expect(line).not.toMatch(/ltfrb/i);
  });
});

describe('RouteCard v2 anatomy', () => {
  it('leads with the ETA row, badge, fare and arrival line', () => {
    renderCard({}, { badge: 'BEST' });

    const eta = screen.getByTestId('route-eta');
    expect(eta).toHaveTextContent('30 min');
    expect(eta).toHaveClass('text-2xl', 'font-bold', 'tracking-tight');
    // Arrival is rendered from the API's `endTime` in Philippine time.
    expect(screen.getByText('Dating 2:03 PM')).toBeInTheDocument();
    expect(screen.getByTestId('route-badge')).toHaveTextContent('BEST');
    expect(screen.getByTestId('fare-amount')).toHaveTextContent('₱29');
    // The mandatory provenance line: matrix label + the API's effectivity date.
    expect(screen.getByTestId('fare-date')).toHaveTextContent(
      'Fares: rail fare matrix effective 2026-03-23',
    );
  });

  it('renders the leg-strip ribbon in API leg order with modes and minutes', () => {
    renderCard();

    const strip = screen.getByTestId('leg-strip');
    expect(strip).toHaveAttribute('data-leg-count', '3');
    expect(strip).toHaveAccessibleName('Mga bahagi ng biyahe');

    const segments = within(strip).getAllByTestId('leg-strip-segment');
    expect(segments.map((segment) => segment.getAttribute('data-mode'))).toEqual([
      'walk',
      'mrt3',
      'walk',
    ]);
    expect(segments.map((segment) => segment.getAttribute('data-minutes'))).toEqual([
      '4',
      '20',
      '6',
    ]);
    expect(strip).toHaveTextContent('MRT-3');
  });

  it('renders one strip segment for a walk-only itinerary', () => {
    renderCard({ ...makeWalkOnlyItinerary(), id: 'walk-only', fare: fare({ amount: 0 }) });

    const strip = screen.getByTestId('leg-strip');
    expect(strip).toHaveAttribute('data-leg-count', '1');
    const segments = within(strip).getAllByTestId('leg-strip-segment');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveAttribute('data-mode', 'walk');
  });

  it('renders legacy payloads whose legs carry no geometry', () => {
    // Cached/saved snapshots from before path geometry existed: straight
    // from→to legs must still render the ribbon and the card.
    const itinerary = makeItinerary([
      makeLeg({ mode: 'walk', durationMin: 3 }),
      makeLeg({ mode: 'jeepney', durationMin: 18 }),
      makeLeg({ mode: 'bus', durationMin: 12 }),
      makeLeg({ mode: 'walk', durationMin: 4 }),
    ]);
    expect(itinerary.legs.every((leg) => leg.geometry === undefined)).toBe(true);

    renderCard({ ...itinerary });

    expect(screen.getAllByTestId('leg-strip-segment')).toHaveLength(4);
    expect(screen.getByTestId('route-card')).toBeInTheDocument();
  });

  it('labels transfers and walk distance on the meta line', () => {
    renderCard({ transfers: 2, walkDistanceM: 1300 });

    expect(screen.getByText('2 sakay')).toBeInTheDocument();
    expect(screen.getByText('1.3 km lakad')).toBeInTheDocument();
  });
});

describe('RouteCard fare confidence', () => {
  it('marks an estimated fare as an estimate instead of presenting it as official', () => {
    renderCard({ fare: fare({ confidence: 'estimated' }) });

    expect(screen.getByTestId('fare-estimate')).toHaveTextContent(/estimate/i);
  });

  it('does not show an estimate marker on an official fare', () => {
    renderCard();

    expect(screen.queryByTestId('fare-estimate')).not.toBeInTheDocument();
  });
});

describe('RouteCard selection', () => {
  it('is one select control that reports the itinerary id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderCard({}, { onSelect });

    const card = screen.getByTestId('route-card');
    expect(card).toHaveAttribute('data-selected', 'false');
    const select = screen.getByTestId('route-card-select');
    expect(select).toHaveAttribute('aria-pressed', 'false');
    // The card clips overflow, so the focus ring must be drawn inside the box or
    // keyboard users see no focus indicator (WCAG 2.4.7, re-review N1).
    expect(select.className).toContain('focus-visible:outline-offset-[-3px]');
    // The overlay's accessible name stays short and honest; the leg strip and
    // provenance text live outside the button (review I2).
    expect(select).toHaveAccessibleName(/30 min/);
    expect(select).toHaveAccessibleName(/₱/);

    await user.click(select);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('card-trip');
  });

  it('gives the selected card the brand ring, surface and elevation', () => {
    const { rerender } = renderCard({}, { selected: true });

    let card = screen.getByTestId('route-card');
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveClass('shadow-elevation-2', 'bg-surface-container-lowest');
    let select = screen.getByTestId('route-card-select');
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(select).toHaveClass('border-primary', 'ring-2', 'ring-primary-container');

    rerender(
      <RouteCard
        itinerary={makeItinerary([makeLeg({ mode: 'walk' })])}
        sources={KNOWN_SOURCES}
        selected={false}
        onSelect={vi.fn()}
      />,
    );

    card = screen.getByTestId('route-card');
    select = screen.getByTestId('route-card-select');
    expect(card).not.toHaveClass('shadow-elevation-2');
    expect(select).toHaveClass('border-outline-variant');
    expect(select).not.toHaveClass('ring-2');
  });
});

describe('RouteCard badge', () => {
  it('renders the badge it is given with the criteria wording', () => {
    renderCard({}, { badge: 'FEWEST TRANSFERS' });

    expect(screen.getByTestId('route-badge')).toHaveTextContent('FEWEST TRANSFERS');
  });

  it('renders no badge when the ranking gives this card none', () => {
    renderCard();

    expect(screen.queryByTestId('route-badge')).not.toBeInTheDocument();
  });
});

describe('RouteCard provenance chip (R45)', () => {
  it('shows only the first two itinerary source ids', () => {
    renderCard({ sources: ['osm', 'ltfrb-fares', 'photon'] });

    const chip = screen.getByTestId('provenance-chip');
    expect(chip).toHaveTextContent('© OpenStreetMap contributors');
    expect(chip).toHaveTextContent('Fares per LTFRB fare matrix effective 28 September 2026');
    expect(chip).not.toHaveTextContent('Photon');
  });

  it('marks a source id that is missing from the response as unavailable', () => {
    renderCard({ sources: ['osm', 'photon'] }, { sources: [KNOWN_SOURCES[0]!] });

    const chip = screen.getByTestId('provenance-chip');
    expect(chip).toHaveTextContent('© OpenStreetMap contributors');
    expect(chip).toHaveTextContent('source unavailable');
    // Never renders the raw id or "undefined" as attribution.
    expect(chip).not.toHaveTextContent('undefined');
  });

  it('does not select the card when the provenance chip is activated (M14)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <RouteCard
          itinerary={makeItinerary([makeLeg({ mode: 'walk' })], {
            sources: ['osm', 'ltfrb-fares'],
          })}
          sources={KNOWN_SOURCES}
          selected={false}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );

    await user.click(within(screen.getByTestId('provenance-chip')).getByRole('link'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('route-card')).toHaveAttribute('data-selected', 'false');
  });
});

describe('shared formatters', () => {
  it('formats integer fares whole and fractional fares with two decimals', () => {
    expect(formatFare(29)).toBe('29');
    expect(formatFare(26.4)).toBe('26.40');
  });

  it('labels transfers and walk distance in Taglish', () => {
    expect(transfersLabel(0)).toBe('direct');
    expect(transfersLabel(2)).toBe('2 sakay');
    expect(walkLabel(484)).toBe('484 m lakad');
    expect(walkLabel(1300)).toBe('1.3 km lakad');
  });
});
