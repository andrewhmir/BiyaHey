import { render, screen } from '@testing-library/react';
import { App } from './app';

it('renders the search pill as the app entry point', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /saan ka pupunta/i })).toBeInTheDocument();
});

it('shows the search pill first in the peek strip', () => {
  render(<App />);

  const sheet = screen.getByTestId('sheet');
  expect(sheet).toHaveAttribute('data-detent', 'peek');

  const search = screen.getByRole('button', { name: /saan ka pupunta/i });
  expect(search).toBeVisible();

  // jsdom has no layout engine, so "first element rendered in the sheet body"
  // is the proxy for "the only thing fully visible in the peek strip": 96 px
  // minus the 48 px drag handle leaves one 48 px row (R54).
  const bodyId = screen
    .getByRole('button', { name: /expand sheet/i })
    .getAttribute('aria-controls');
  const body = document.getElementById(bodyId ?? '');
  expect(body).not.toBeNull();
  expect(body?.querySelector('button, h1, h2, h3, p')).toBe(search);
});
