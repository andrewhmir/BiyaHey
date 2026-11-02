import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { MapSlot } from './MapSlot';

describe('AppShell', () => {
  it('layers the map under the sheet and publishes map padding', () => {
    render(
      <AppShell
        map={<MapSlot mapPadding={320} />}
        sheet={<div data-testid="sheet-stub">sheet</div>}
      />,
    );

    const mapSlot = screen.getByTestId('map-slot');
    expect(mapSlot).toHaveAttribute('data-map-padding-bottom', '320');
    expect(mapSlot.style.getPropertyValue('--map-padding-bottom')).toBe('320px');
    expect(screen.getByTestId('sheet-stub')).toBeInTheDocument();
  });

  it('renders the placeholder map slot when no map is supplied', () => {
    render(<AppShell sheet={<div>sheet</div>} />);
    expect(screen.getByTestId('map-slot')).toBeInTheDocument();
  });
});
