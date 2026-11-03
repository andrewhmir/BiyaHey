import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  makeLeg,
  makeLongItinerary,
  makeRailTrip,
  makeWalkOnlyItinerary,
} from '../../test/fixtures/itinerary';
import { LegStrip } from './LegStrip';

describe('LegStrip', () => {
  it('renders one segment per leg in travel order', () => {
    const itinerary = makeRailTrip();
    render(<LegStrip legs={itinerary.legs} />);

    const strip = screen.getByTestId('leg-strip');
    expect(strip).toHaveAttribute('data-leg-count', '3');
    expect(strip).toHaveAttribute('aria-label', 'Mga bahagi ng biyahe');

    const segments = screen.getAllByTestId('leg-strip-segment');
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.getAttribute('data-mode'))).toEqual([
      'walk',
      'mrt3',
      'walk',
    ]);
    expect(segments.map((segment) => segment.getAttribute('data-minutes'))).toEqual([
      '4',
      '20',
      '4',
    ]);
  });

  it('gives every segment a proportional width with a one-minute floor', () => {
    const itinerary = makeRailTrip();
    const first = render(<LegStrip legs={itinerary.legs} />);

    const segments = screen.getAllByTestId('leg-strip-segment');
    expect(segments[0]?.parentElement?.style.flex).toContain('4 1');
    expect(segments[1]?.parentElement?.style.flex).toContain('20 1');
    first.unmount();

    const short = makeLeg({ mode: 'walk', durationMin: 1 });
    render(<LegStrip legs={[short]} />);
    const [single] = screen.getAllByTestId('leg-strip-segment');
    // 1 minute must still be growable/visible, never a zero-width segment.
    expect(single?.parentElement?.style.flex).toBe('1 1 0%');
  });

  it('describes every leg in text so colour is never the only channel', () => {
    const itinerary = makeRailTrip();
    render(<LegStrip legs={itinerary.legs} />);

    const segments = screen.getAllByTestId('leg-strip-segment');
    expect(segments[1]?.textContent).toContain('MRT-3');
    expect(segments[1]?.textContent).toContain('hintuan');
    expect(segments[0]?.textContent).toContain('min');
  });

  it('renders a 15-leg itinerary without dropping segments', () => {
    const itinerary = makeLongItinerary(15);
    render(<LegStrip legs={itinerary.legs} />);
    expect(screen.getAllByTestId('leg-strip-segment')).toHaveLength(15);
  });

  it('renders a walk-only itinerary', () => {
    const itinerary = makeWalkOnlyItinerary();
    render(<LegStrip legs={itinerary.legs} />);

    const segments = screen.getAllByTestId('leg-strip-segment');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveAttribute('data-mode', 'walk');
  });

  it('is a button per segment and reports the focused leg when interactive', async () => {
    const user = userEvent.setup();
    const onSelectLeg = vi.fn();
    const itinerary = makeRailTrip();
    render(
      <LegStrip
        legs={itinerary.legs}
        selectedLegIndex={1}
        onSelectLeg={onSelectLeg}
      />,
    );

    expect(screen.getByTestId('leg-strip')).toHaveAttribute('data-interactive', 'true');
    const segments = screen.getAllByRole('button');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveAttribute('aria-pressed', 'false');
    expect(segments[1]).toHaveAttribute('aria-pressed', 'true');
    expect(segments[1]).toHaveAccessibleName(/MRT-3/);

    await user.click(segments[2]!);
    expect(onSelectLeg).toHaveBeenCalledWith(2);
  });
});
