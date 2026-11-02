import type { SearchGroup, SearchResultDto } from '@biyahey/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ayalaSearchResponse, cubaoSearchResponse } from '../../test/msw/handlers';
import { SearchResults, formatDistance } from './SearchResults';

/** A copy of a result with the optional distance removed (deep-link case). */
function withoutDistance(result: SearchResultDto): SearchResultDto {
  const copy: SearchResultDto = { ...result };
  delete copy.distanceM;
  return copy;
}

describe('SearchResults', () => {
  it('renders groups in the mandated order and omits empty groups', () => {
    const groups: SearchGroup = {
      ...ayalaSearchResponse.groups,
      saved: [ayalaSearchResponse.groups.landmarks[0]],
    };
    render(<SearchResults groups={groups} onSelect={() => {}} />);

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['Stops', 'Landmarks', 'Saved']);
    expect(screen.getByTestId('search-group-stops')).toBeInTheDocument();
    expect(screen.queryByTestId('search-group-routes')).not.toBeInTheDocument();
  });

  it('formats metres and kilometres, and shows no distance row when the API sent none', () => {
    const [ayalaTerminal] = ayalaSearchResponse.groups.stops;
    const groups: SearchGroup = {
      stops: [ayalaTerminal, withoutDistance(ayalaTerminal)],
      landmarks: [],
      routes: [],
      saved: [],
    };
    render(<SearchResults groups={groups} onSelect={() => {}} />);

    expect(screen.getByText('≈ 120 m')).toBeInTheDocument();
    expect(formatDistance(11_837)).toBe('≈ 11.8 km');
    // Only the API's value is rendered: the copy without distanceM gets no
    // invented distance.
    expect(screen.getAllByText(/≈/)).toHaveLength(1);
  });

  it('gives a result row a readable accessible name including its distance', () => {
    render(<SearchResults groups={cubaoSearchResponse.groups} onSelect={() => {}} />);

    expect(
      screen.getByRole('button', { name: 'Cubao, Quezon City ≈ 11.8 km' }),
    ).toBeInTheDocument();
  });
});
