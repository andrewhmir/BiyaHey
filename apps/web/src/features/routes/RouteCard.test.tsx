import type { DataSource, FareQuote, ItineraryDto } from '@biyahey/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteCard, fareEffectiveLine, transfersLabel, walkLabel } from './RouteCard';

// Attribution rows mirror the checked-in provenance registry. The card only
// ever renders the rows the API response carries (R45), so these stand in for
// the `sources[]` array of a plan response.
const osmSource: DataSource = {
  id: 'osm',
  name: 'OpenStreetMap PH extract',
  publisher: 'OSM contributors / Geofabrik',
  url: 'https://download.geofabrik.de/asia/philippines.html',
  licence_spdx: 'ODbL-1.0',
  licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  coverage: 'Philippines - Geofabrik PH extract (NCR + belt for v1)',
  last_checked: '2026-11-01',
  attribution:
    '© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0',
  used_for: ['roads'],
};

const ltfrbSource: DataSource = {
  id: 'ltfrb-fares',
  name: 'LTFRB fare matrix (transcribed)',
  publisher: 'LTFRB',
  url: 'https://ltfrb.gov.ph',
  licence_spdx: 'NOASSERTION',
  licence_url: 'https://ltfrb.gov.ph',
  coverage: 'Nationwide fare matrix effective 2026-09-28',
  last_checked: '2026-11-01',
  attribution: 'Fares per LTFRB fare matrix effective 28 September 2026',
  used_for: ['fare amounts'],
};

const railSource: DataSource = {
  id: 'rail-fares',
  name: 'LRTA / LRMC / MRT-3 fares & status',
  publisher: 'LRTA, LRMC, DOTr–MRT3',
  url: 'https://www.lrta.gov.ph/tickets-and-fares/ · https://lrmc.ph',
  licence_spdx: 'NOASSERTION',
  licence_url: 'https://www.lrta.gov.ph/tickets-and-fares/',
  coverage: 'LRT-1, LRT-2, MRT-3 fares, schedules and service status',
  last_checked: '2026-11-01',
  attribution:
    'LRT-2/MRT-3 50% discount effective 23 March 2026 · LRT-1 fares effective 2 April 2025 (LRMC)',
  used_for: ['rail fares'],
};

const photonSource: DataSource = {
  id: 'photon',
  name: 'Photon geocoder',
  publisher: 'komoot (OSM data)',
  url: 'https://photon.komoot.io/',
  licence_spdx: 'ODbL-1.0',
  licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  coverage: 'Global OSM-based geocoding (best-effort service)',
  last_checked: '2026-11-01',
  attribution: 'Geocoding by Photon (komoot) — data © OpenStreetMap contributors, ODbL',
  used_for: ['typeahead search'],
};

function fare(overrides: Partial<FareQuote> = {}): FareQuote {
  return {
    amount: 26.4,
    currency: 'PHP',
    confidence: 'official',
    effective_from: '2026-09-28',
    source_id: 'ltfrb-fares',
    breakdown: [
      { label: 'Traditional jeepney base fare (first 4 km)', amount: 14 },
      { label: 'Traditional jeepney distance charge (6.2 km × ₱2.00/km)', amount: 12.4 },
    ],
    ...overrides,
  };
}

function itinerary(overrides: Partial<ItineraryDto> = {}): ItineraryDto {
  return {
    id: 'test-itinerary',
    durationMin: 31,
    startTime: '2026-11-02T08:00:00+08:00',
    endTime: '2026-11-02T08:31:00+08:00',
    transfers: 0,
    walkDistanceM: 484,
    modes: ['walk', 'jeepney'],
    fare: fare(),
    sources: ['osm', 'ltfrb-fares'],
    legs: [],
    ...overrides,
  };
}

function renderCard(
  itineraryOverrides: Partial<ItineraryDto> = {},
  sourceRows: readonly DataSource[] = [osmSource, ltfrbSource, railSource, photonSource],
) {
  return render(
    <RouteCard
      itinerary={itinerary(itineraryOverrides)}
      sources={sourceRows}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
}

describe('fareEffectiveLine', () => {
  it('names the LTFRB matrix for an LTFRB-priced quote', () => {
    expect(fareEffectiveLine(fare())).toBe('Fares: LTFRB matrix effective 2026-09-28');
  });

  it('labels a rail quote with the rail matrix, never the LTFRB matrix', () => {
    const line = fareEffectiveLine(
      fare({
        source_id: 'rail-fares',
        effective_from: '2026-03-23',
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
        effective_from: '2026-03-23',
        breakdown: [
          { label: '[rail-fares] MRT-3 published fare (8.2 km)', amount: 20 },
          { label: '[ltfrb-fares] Traditional jeepney base fare (first 4 km)', amount: 14 },
        ],
      }),
    );

    expect(line).toBe('Fares: mixed fare sources effective 2026-03-23');
    expect(line).not.toMatch(/ltfrb/i);
  });

  it('does not attribute a walk-only quote to any fare matrix', () => {
    const line = fareEffectiveLine(
      fare({ amount: 0, source_id: null, confidence: 'official', breakdown: [] }),
    );

    expect(line).toBe('Fares: no fare effective 2026-09-28');
    expect(line).not.toMatch(/ltfrb/i);
  });
});

describe('RouteCard fare confidence', () => {
  it('marks an estimated fare as an estimate instead of presenting it as official', () => {
    renderCard({
      fare: fare({
        source_id: 'rail-fares',
        effective_from: '2026-03-23',
        confidence: 'estimated',
      }),
    });

    expect(screen.getByTestId('fare-estimate')).toHaveTextContent(/estimate/i);
  });

  it('does not show an estimate marker on an official fare', () => {
    renderCard();

    expect(screen.queryByTestId('fare-estimate')).not.toBeInTheDocument();
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
    renderCard({ sources: ['osm', 'photon'] }, [osmSource, ltfrbSource]);

    const chip = screen.getByTestId('provenance-chip');
    expect(chip).toHaveTextContent('© OpenStreetMap contributors');
    expect(chip).toHaveTextContent('source unavailable');
    // Never renders the raw id or "undefined" as attribution.
    expect(chip).not.toHaveTextContent('undefined');
  });
});

describe('RouteCard copy', () => {
  it('labels transfers and walk distance in Taglish', () => {
    expect(transfersLabel(0)).toBe('direct');
    expect(transfersLabel(2)).toBe('2 sakay');
    expect(walkLabel(484)).toBe('484 m lakad');
    expect(walkLabel(1300)).toBe('1.3 km lakad');
  });
});
