import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider, useT } from './useT';

function Probe() {
  const { t, locale } = useT();
  return (
    <output data-testid="probe">
      {locale}|{t('common.fare')}|{t('search.results', { count: 2 })}
    </output>
  );
}

afterEach(() => {
  document.documentElement.lang = 'tl';
});

describe('useT', () => {
  it('defaults to Taglish and sets <html lang="tl">', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('tl|Pamasahe|2 resulta');
    expect(document.documentElement.lang).toBe('tl');
  });

  it('renders the English fallback and sets <html lang="en"> for an en provider', () => {
    render(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('en|Fare|2 result(s)');
    expect(document.documentElement.lang).toBe('en');
  });

  it('updates <html lang> when the locale prop changes', () => {
    const { rerender } = render(
      <LocaleProvider locale="tl">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe('tl');

    rerender(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to Taglish outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('tl|Pamasahe');
  });
});
