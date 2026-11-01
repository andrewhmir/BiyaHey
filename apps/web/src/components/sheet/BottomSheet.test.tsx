import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { BottomSheet, useSheetMapPadding } from './BottomSheet';

const DETENTS = [96, 'half', 'expanded'] as const;

// R52: jsdom has no layout engine and no canvas, so axe's color-contrast rule
// can only report noise here. Contrast is reviewed against the token pairs in
// `src/theme/tokens.css` (WCAG 2.2 AA) instead; every other axe rule stays on.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BottomSheet', () => {
  it('starts at peek and expands one detent via the accessible control', async () => {
    const user = userEvent.setup();
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-detent', 'peek');
    expect(sheet).toHaveAttribute('data-motion', 'full');

    await user.click(screen.getByRole('button', { name: /expand sheet/i }));

    expect(sheet).toHaveAttribute('data-detent', 'half');
    // `aria-expanded` means "fully expanded", not "above peek", so it stays
    // false at half and a screen reader is told there is more to expand.
    expect(screen.getByRole('button', { name: /expand sheet/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /collapse sheet/i })).toBeInTheDocument();
  });

  it('expands stepwise with ArrowUp and collapses one detent per activation', async () => {
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    const handle = screen.getByRole('button', { name: /expand sheet/i });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'expanded');

    await userEvent.click(screen.getByRole('button', { name: /collapse sheet/i }));
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'half');
  });

  it('collapses one detent with Escape and stops at peek', async () => {
    const user = userEvent.setup();
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    await user.click(screen.getByRole('button', { name: /expand sheet/i }));
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'peek');

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'peek');
  });

  it('collapses one detent on browser back before the route pops', async () => {
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    await userEvent.click(screen.getByRole('button', { name: /expand sheet/i }));
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'expanded');

    await act(async () => {
      window.history.back();
    });

    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'half'));
  });

  it('respects prefers-reduced-motion while keeping detent changes instant', async () => {
    mockReducedMotion(true);
    const user = userEvent.setup();
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-motion', 'reduced');
    expect(sheet.className).toContain('transition-none');

    await user.click(screen.getByRole('button', { name: /expand sheet/i }));
    expect(sheet).toHaveAttribute('data-detent', 'half');
  });

  it('reports map padding through the callback and the sheet context', async () => {
    const onMapPaddingChange = vi.fn();

    function PaddingProbe() {
      const padding = useSheetMapPadding();
      return <output data-testid="padding">{padding?.bottom ?? 'none'}</output>;
    }

    render(
      <BottomSheet detents={[...DETENTS]} initial="peek" onMapPaddingChange={onMapPaddingChange}>
        <PaddingProbe />
      </BottomSheet>,
    );

    expect(screen.getByTestId('padding')).toHaveTextContent('96');
    expect(onMapPaddingChange).toHaveBeenLastCalledWith({ detent: 'peek', height: 96, bottom: 96 });

    await userEvent.click(screen.getByRole('button', { name: /expand sheet/i }));

    const half = Math.round(window.innerHeight / 2);
    expect(screen.getByTestId('padding')).toHaveTextContent(String(half));
    expect(onMapPaddingChange).toHaveBeenLastCalledWith({
      detent: 'half',
      height: half,
      bottom: half,
    });
  });

  it('snaps to the nearest detent after a pointer drag', () => {
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    const handle = screen.getByRole('button', { name: /expand sheet/i });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 700 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 500 });

    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'half');
  });

  it('reaches expanded by activating the handle from half', async () => {
    const user = userEvent.setup();
    render(
      <BottomSheet detents={[...DETENTS]} initial="peek">
        <p>content</p>
      </BottomSheet>,
    );

    const sheet = screen.getByTestId('sheet');
    const expand = () => screen.getByRole('button', { name: /expand sheet/i });

    // peek -> half
    await user.click(expand());
    expect(sheet).toHaveAttribute('data-detent', 'half');
    expect(expand()).toHaveAttribute('aria-expanded', 'false');

    // half -> expanded: no hardware keyboard or drag required.
    await user.click(expand());
    expect(sheet).toHaveAttribute('data-detent', 'expanded');
    expect(expand()).toHaveAttribute('aria-expanded', 'true');
    expect(expand()).toHaveAttribute('aria-disabled', 'true');
  });

  it('collapses expanded -> half -> peek with the separate collapse control', async () => {
    const user = userEvent.setup();
    render(
      <BottomSheet detents={[...DETENTS]} initial="expanded">
        <p>content</p>
      </BottomSheet>,
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('data-detent', 'expanded');

    const collapse = () => screen.getByRole('button', { name: /collapse sheet/i });
    await user.click(collapse());
    expect(sheet).toHaveAttribute('data-detent', 'half');

    await user.click(collapse());
    expect(sheet).toHaveAttribute('data-detent', 'peek');
    // Nothing left to collapse at peek, so the control is not rendered.
    expect(screen.queryByRole('button', { name: /collapse sheet/i })).not.toBeInTheDocument();
  });

  it.each(['peek', 'half', 'expanded'] as const)('has no axe violations at %s', async (initial) => {
    const { container } = render(
      <BottomSheet detents={[...DETENTS]} initial={initial}>
        <h1>Mga biyahe</h1>
        <p>content</p>
      </BottomSheet>,
    );

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
