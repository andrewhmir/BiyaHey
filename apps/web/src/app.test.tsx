import { render, screen } from '@testing-library/react';
import { App } from './app';

it('renders the search pill as the app entry point', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /saan ka pupunta/i })).toBeInTheDocument();
});
