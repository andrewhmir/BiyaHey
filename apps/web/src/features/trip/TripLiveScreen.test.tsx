import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { makeWalkOnlyItinerary } from '../../test/fixtures/itinerary';
import { planMrt3CubaoAyalaResponse } from '../../test/msw/handlers';
import { clearPlanCache, rememberPlan } from '../routes/planCache';
import {
  TripLiveScreen,
  type TripMapRenderer,
  type TripMapRenderState,
} from './TripLiveScreen';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const MRT_ITINERARY = planMrt3CubaoAyalaResponse.itineraries[0]!;

interface MapStub {
  calls: TripMapRenderState[];
  renderMap: TripMapRenderer;
}

function makeMapStub(): MapStub {
  const calls: TripMapRenderState[] = [];
  return {
    calls,
    renderMap: (state) => {
      calls.push(state);
      return (
        <div
          data-testid="map-stub"
          data-active-leg={state.activeLegIndex === null ? 'none' : String(state.activeLegIndex)}
        />
      );
    },
  };
}

function latestCall(stub: MapStub): TripMapRenderState {
  const call = stub.calls[stub.calls.length - 1];
  if (call === undefined) {
    throw new Error('renderMap was never called');
  }
  return call;
}

let user: UserEvent;

beforeEach(() => {
  user = userEvent.setup();
  localStorage.clear();
  clearPlanCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPlanCache();
  delete (navigator as unknown as { geolocation?: Geolocation }).geolocation;
});

describe('TripLiveScreen walkthrough', () => {
  it('starts on the first step with the progress rail, current-leg card and map position', () => {
    const stub = makeMapStub();
    render(<TripLiveScreen itinerary={MRT_ITINERARY} renderMap={stub.renderMap} />);

    expect(screen.getByTestId('live-map')).toHaveAttribute('role', 'region');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-active-leg', '0');
    expect(latestCall(stub).itinerary).toBe(MRT_ITINERARY);
    expect(latestCall(stub).activeLegIndex).toBe(0);

    const progress = screen.getByTestId('live-progress');
    expect(progress).toHaveTextContent('Hakbang 1 ng 3');
    expect(progress).toHaveTextContent('Lakad');
    expect(within(progress).getByTestId('leg-strip')).toBeInTheDocument();

    expect(screen.getByTestId('live-current-leg')).toHaveTextContent('Kasalukuyang hakbang');
    expect(screen.getByTestId('live-instruction')).toHaveTextContent(
      'Maglakad papunta sa Cubao MRT-3 Station',
    );
    expect(screen.getByTestId('live-prev')).toBeDisabled();
    expect(screen.getByTestId('live-next')).toBeEnabled();
    expect(screen.getByTestId('live-announce')).toHaveTextContent(/hakbang 1 ng 3/i);
  });

  it('keeps the mandated honesty banner, tagged lang="en"', () => {
    render(<TripLiveScreen itinerary={MRT_ITINERARY} />);

    const banner = screen.getByTestId('live-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');

    const mandated = screen.getByText('no live data — expected wait');
    expect(mandated).toHaveAttribute('lang', 'en');
    expect(banner).toHaveTextContent(/gabay lamang ito batay sa nakaplanong itinerary/i);
    expect(banner).toHaveTextContent(/walang live tracking/i);
  });

  it('advances to the next leg and updates the map, the card and the announcement', async () => {
    const stub = makeMapStub();
    render(<TripLiveScreen itinerary={MRT_ITINERARY} renderMap={stub.renderMap} />);

    await user.click(screen.getByTestId('live-next'));

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 2 ng 3');
    expect(screen.getByTestId('live-progress')).toHaveTextContent('MRT-3');
    expect(screen.getByTestId('live-instruction')).toHaveTextContent(
      'Sakay MRT-3 papuntang Ayala',
    );
    expect(screen.getByTestId('live-signage')).toHaveTextContent('MRT-3 / Ayala');
    expect(screen.getByTestId('live-alight')).toHaveTextContent('Baba sa Ayala');
    expect(screen.getByTestId('live-stop-counter')).toHaveTextContent('3 hintuan · baba sa Ayala');
    expect(screen.getByTestId('live-announce')).toHaveTextContent(/hakbang 2 ng 3/i);
    expect(latestCall(stub).activeLegIndex).toBe(1);
    expect(screen.getByTestId('live-prev')).toBeEnabled();
  });

  it('goes back a step and keeps Previous disabled on the first step', async () => {
    render(<TripLiveScreen itinerary={MRT_ITINERARY} />);

    await user.click(screen.getByTestId('live-next'));
    await user.click(screen.getByTestId('live-prev'));

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 1 ng 3');
    expect(screen.getByTestId('live-instruction')).toHaveTextContent(
      'Maglakad papunta sa Cubao MRT-3 Station',
    );
    expect(screen.getByTestId('live-prev')).toBeDisabled();
  });

  it('finishes after the last step, keeps the map on the last leg, and can start over', async () => {
    const stub = makeMapStub();
    render(<TripLiveScreen itinerary={MRT_ITINERARY} renderMap={stub.renderMap} />);

    await user.click(screen.getByTestId('live-next'));
    await user.click(screen.getByTestId('live-next'));
    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 3 ng 3');

    await user.click(screen.getByTestId('live-next'));

    const finish = screen.getByTestId('live-finish');
    expect(finish).toHaveTextContent('Tapos ang biyahe');
    expect(finish).toHaveTextContent('Narating mo na ang destinasyon. Ingat sa pag-uwi!');
    expect(screen.queryByTestId('live-current-leg')).toBeNull();
    expect(latestCall(stub).activeLegIndex).toBe(2);
    expect(screen.getByTestId('live-announce')).toHaveTextContent('Tapos ang biyahe');

    await user.click(screen.getByTestId('live-start-over'));

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 1 ng 3');
    expect(screen.queryByTestId('live-finish')).toBeNull();
    expect(latestCall(stub).activeLegIndex).toBe(0);
  });

  it('jumps to a leg tapped on the map', () => {
    const stub = makeMapStub();
    render(<TripLiveScreen itinerary={MRT_ITINERARY} renderMap={stub.renderMap} />);

    const fromMap = latestCall(stub);
    act(() => fromMap.onSelectLeg(2));

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 3 ng 3');
    expect(latestCall(stub).activeLegIndex).toBe(2);
  });

  it('never calls navigator.geolocation', async () => {
    const getCurrentPosition = vi.fn();
    const watchPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
      configurable: true,
    });

    render(<TripLiveScreen itinerary={MRT_ITINERARY} />);
    await user.click(screen.getByTestId('live-next'));
    await user.click(screen.getByTestId('live-next'));
    await user.click(screen.getByTestId('live-next'));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('falls back to the cached plan when only an itinerary id is passed', () => {
    rememberPlan(planMrt3CubaoAyalaResponse);
    render(<TripLiveScreen itineraryId={MRT_ITINERARY.id} />);

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 1 ng 3');
    expect(screen.getByTestId('live-trip-summary')).toHaveTextContent('31 min');
    expect(screen.getByTestId('live-trip-summary')).toHaveTextContent(/naka-cache na plano/i);
  });

  it('keeps the saved-snapshot honesty copy when opened from the saved store', () => {
    render(
      <TripLiveScreen itinerary={MRT_ITINERARY} savedSnapshotAt="2026-11-01T08:00:00.000Z" />,
    );

    const note = screen.getByTestId('saved-snapshot-note');
    expect(note).toHaveAttribute('lang', 'en');
    expect(note).toHaveTextContent(/saved route \(no live data\)/i);
    expect(note).toHaveTextContent(/last updated/i);
    expect(screen.getByTestId('live-trip-summary')).not.toHaveTextContent(/naka-cache/i);
  });

  it('shows the honest no-cached notice with the back action', async () => {
    const onBack = vi.fn();
    render(<TripLiveScreen itineraryId="not-in-cache" onBack={onBack} />);

    expect(screen.getByTestId('live-no-cached')).toHaveTextContent(/wala nang ruta sa cache/i);
    await user.click(screen.getByRole('button', { name: 'Bumalik sa detalye' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('walks a single-leg, walk-only itinerary to completion', async () => {
    const stub = makeMapStub();
    render(<TripLiveScreen itinerary={makeWalkOnlyItinerary()} renderMap={stub.renderMap} />);

    expect(screen.getByTestId('live-progress')).toHaveTextContent('Hakbang 1 ng 1');
    expect(screen.getByTestId('live-prev')).toBeDisabled();
    expect(latestCall(stub).activeLegIndex).toBe(0);

    await user.click(screen.getByTestId('live-next'));

    expect(screen.getByTestId('live-finish')).toBeInTheDocument();
    expect(latestCall(stub).activeLegIndex).toBe(0);
  });

  it('renders an aria-hidden map placeholder when no renderer is supplied', () => {
    render(<TripLiveScreen itinerary={MRT_ITINERARY} />);

    expect(screen.getByTestId('live-map')).toBeInTheDocument();
    expect(screen.getByTestId('live-map-placeholder')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no axe violations on the first step', async () => {
    const { container } = render(<TripLiveScreen itinerary={MRT_ITINERARY} />);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
