import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ProvenanceChip } from '../../components/provenance/ProvenanceChip';
import { AppRoutes } from '../../routes';
import {
  planCubaoAyalaResponse,
  sourcesErrorHandler,
  sourcesMalformedRowHandler,
  sourcesNetworkErrorHandler,
  sourcesPendingHandler,
  sourcesSuccessHandler,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { FareBreakdown } from '../trip/FareBreakdown';
import { AboutDataScreen } from './AboutDataScreen';

// R52: jsdom has no canvas, so axe's colour-contrast rule is noise here; token
// contrast is reviewed against `tokens.css` instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const PLAN_ENTRY = '/plan?dest=14.554,121.024&name=Ayala&from=14.619,121.053&fromName=Cubao';

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

function renderAbout() {
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={newQueryClient()}>
      <AboutDataScreen onBack={() => undefined} />
    </QueryClientProvider>,
  );
  return { user, ...utils };
}

function renderApp(entry: string) {
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, ...utils };
}

beforeEach(() => {
  // The report-issue link is only rendered when a deployment configures it;
  // pin the default so the honest fallback is deterministic in tests.
  vi.stubEnv('VITE_REPORT_ISSUE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('AboutDataScreen', () => {
  it('lists every dataset with publisher, licence and last-checked date', async () => {
    renderAbout();

    const cards = await screen.findAllByTestId('dataset-card');
    expect(cards).toHaveLength(11);

    const osm = cards.find((card) => card.textContent?.includes('OpenStreetMap'))!;
    // The registry's publisher and the row's own attribution, both from the API.
    expect(osm).toHaveTextContent('OSM contributors / Geofabrik');
    expect(osm).toHaveTextContent('OpenStreetMap contributors');
    // SPDX identifier and its documented human name.
    expect(osm).toHaveTextContent('ODbL-1.0');
    expect(osm).toHaveTextContent('Open Database License (ODbL) 1.0');
    // Last checked, coverage and the honest confidence state.
    expect(osm).toHaveTextContent('2026-11-01');
    expect(osm).toHaveTextContent('Philippines - Geofabrik PH extract (NCR + belt for v1)');
    expect(osm).toHaveTextContent('hindi naka-publish');
    expect(screen.getByRole('status')).toHaveTextContent('11 na dataset');
  });

  it('opens the licence sheet with the full licence link and source URL', async () => {
    const { user } = renderAbout();

    await user.click((await screen.findAllByTestId('dataset-card'))[0]!);

    const dialog = screen.getByRole('dialog', { name: 'OpenStreetMap PH extract' });
    expect(within(dialog).getByRole('link', { name: /open database license/i })).toHaveAttribute(
      'href',
      'https://opendatacommons.org/licenses/odbl/1-0/',
    );
    expect(within(dialog).getByRole('link', { name: /download\.geofabrik\.de/ })).toHaveAttribute(
      'href',
      'https://download.geofabrik.de/asia/philippines.html',
    );
    expect(dialog).toHaveTextContent('SPDX: ODbL-1.0');
    expect(dialog).toHaveTextContent('© OpenStreetMap contributors');

    await user.click(within(dialog).getByRole('button', { name: 'Isara' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the derived walk-estimate row as plain text with no anchor (I1)', async () => {
    const { user } = renderAbout();

    const derivedCard = (await screen.findAllByTestId('dataset-card')).find((card) =>
      card.textContent?.includes('BiyaHey! walking-time estimate'),
    )!;
    await user.click(derivedCard);

    const dialog = screen.getByRole('dialog', { name: 'BiyaHey! walking-time estimate' });
    // Honest copy — never "No licence asserted" inside an href-less anchor.
    expect(
      within(dialog).getByText('Tantiyang kalkulado — walang lisensya ng dataset'),
    ).toBeInTheDocument();
    // The registry's computation method replaces the source URL, as plain text.
    expect(within(dialog).getByTestId('derived-method')).toHaveTextContent(
      /Haversine distance between the requested origin and destination/i,
    );
    // No anchor of any kind: no licence link and no invented external source.
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0);
    expect(dialog.querySelector('a')).toBeNull();

    // Control: a dataset row still renders its real licence link.
    await user.click(within(dialog).getByRole('button', { name: 'Isara' }));
    const osmCard = (await screen.findAllByTestId('dataset-card')).find((card) =>
      card.textContent?.includes('OpenStreetMap PH extract'),
    )!;
    await user.click(osmCard);
    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: /open database license/i }),
    ).toHaveAttribute('href', 'https://opendatacommons.org/licenses/odbl/1-0/');
  });

  it('closes the licence sheet with Escape', async () => {
    const { user } = renderAbout();
    const card = (await screen.findAllByTestId('dataset-card'))[0]!;
    await user.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // M4: focus returns to the card that opened the sheet.
    expect(card).toHaveFocus();
  });

  it('traps focus, locks body scroll and closes on a backdrop tap (M4)', async () => {
    const { user } = renderAbout();
    const card = (await screen.findAllByTestId('dataset-card'))[0]!;
    await user.click(card);

    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Isara' });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    // Shift+Tab from the first focusable wraps to the last one inside the sheet.
    const links = within(dialog).getAllByRole('link');
    await user.tab({ shift: true });
    expect(links.at(-1)).toHaveFocus();
    // Tab from the last focusable wraps back to the close button.
    await user.tab();
    expect(close).toHaveFocus();

    fireEvent.click(screen.getByTestId('licence-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(card).toHaveFocus();
  });

  it('does not invent a report link when none is configured', async () => {
    const { user } = renderAbout();
    await user.click((await screen.findAllByTestId('dataset-card'))[0]!);

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/wala pang naka-configure na report link/i),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /report/i })).not.toBeInTheDocument();
  });

  it('renders the configured report-issue link when a deployment sets one', async () => {
    vi.stubEnv('VITE_REPORT_ISSUE_URL', 'https://example.test/biyahey/issues/new');
    const { user } = renderAbout();
    await user.click((await screen.findAllByTestId('dataset-card'))[0]!);

    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: /mag-report ng isyu/i }),
    ).toHaveAttribute('href', 'https://example.test/biyahey/issues/new');
  });

  it('shows the loading state while /sources is pending', async () => {
    server.use(sourcesPendingHandler);
    renderAbout();

    expect(await screen.findByText(/nilo-load ang mga pinagmulan/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByTestId('dataset-card')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry that recovers', async () => {
    server.use(sourcesErrorHandler);
    const { user } = renderAbout();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/hindi ma-load/i);

    server.use(sourcesSuccessHandler);
    await user.click(within(alert).getByRole('button', { name: /subukan ulit/i }));

    expect(await screen.findAllByTestId('dataset-card')).toHaveLength(11);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error/retry state for a malformed /sources row (M3)', async () => {
    server.use(sourcesMalformedRowHandler);
    const { user } = renderAbout();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/hindi ma-load/i);
    // The whole list is rejected: no card is rendered with undefined fields.
    expect(screen.queryByTestId('dataset-card')).not.toBeInTheDocument();

    server.use(sourcesSuccessHandler);
    await user.click(within(alert).getByRole('button', { name: /subukan ulit/i }));
    expect(await screen.findAllByTestId('dataset-card')).toHaveLength(11);
  });

  it('uses the typed transport failure and never announces the error twice (M5/M6)', async () => {
    server.use(sourcesNetworkErrorHandler);
    renderAbout();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/walang koneksyon/i);
    // The role="alert" is the single announcement; the polite status region
    // stays silent instead of repeating the same sentence.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('has no axe violations', async () => {
    const { container } = renderAbout();
    await screen.findAllByTestId('dataset-card');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no axe violations with the licence sheet open', async () => {
    const { container, user } = renderAbout();
    await user.click((await screen.findAllByTestId('dataset-card'))[0]!);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('ProvenanceChip', () => {
  it('shows "source unavailable" when an itinerary references a missing dataset', () => {
    render(<ProvenanceChip sourcesFromItinerary={['made-up']} knownSources={[]} />);

    expect(screen.getByText(/source unavailable/i)).toBeInTheDocument();
  });

  it('keeps the Task 5 chip text, two-source cap and ⓘ affordance', () => {
    render(
      <ProvenanceChip
        sourcesFromItinerary={['osm', 'ltfrb-fares', 'photon']}
        knownSources={planCubaoAyalaResponse.sources}
      />,
    );

    const chip = screen.getByTestId('provenance-chip');
    expect(chip).toHaveTextContent('© OpenStreetMap contributors');
    expect(chip).toHaveTextContent('Fares per LTFRB fare matrix effective 28 September 2026');
    expect(chip).not.toHaveTextContent('Photon');
    expect(chip).toHaveTextContent('Data sources');
    expect(chip).toHaveTextContent('ⓘ');
    expect(within(chip).getByRole('link')).toHaveAttribute('href', '/sources');
  });

  it('marks a partly missing source set without rendering undefined', () => {
    render(
      <ProvenanceChip
        sourcesFromItinerary={['osm', 'photon']}
        knownSources={[planCubaoAyalaResponse.sources[0]!]}
      />,
    );

    const chip = screen.getByTestId('provenance-chip');
    expect(chip).toHaveTextContent('© OpenStreetMap contributors');
    expect(chip).toHaveTextContent('source unavailable');
    expect(chip).not.toHaveTextContent('undefined');
  });
});

describe('About-data entry points', () => {
  it('opens About data from a route-card chip in one tap', async () => {
    const { user } = renderApp(PLAN_ENTRY);

    const chips = await screen.findAllByTestId('provenance-chip');
    await user.click(within(chips[0]!).getByRole('link'));

    expect(await screen.findByRole('heading', { name: 'Pinagmulan ng datos' })).toBeInTheDocument();
    expect(await screen.findAllByTestId('dataset-card')).toHaveLength(11);
  });

  it('reaches About data from the map-credit ⓘ in two taps', async () => {
    const { user } = renderApp(PLAN_ENTRY);

    await screen.findAllByTestId('route-card');
    await user.click(screen.getByRole('button', { name: 'Pinagmulan ng data' }));

    const credit = screen.getByRole('dialog', { name: 'Pinagmulan ng data' });
    await user.click(within(credit).getByRole('link', { name: /about data/i }));

    expect(await screen.findByRole('heading', { name: 'Pinagmulan ng datos' })).toBeInTheDocument();
  });

  it('reaches About data from the trip-detail fare footer', async () => {
    const { user } = renderApp(PLAN_ENTRY);

    await screen.findAllByTestId('route-card');
    // UX v2 RouteCard: one "Tingnan ang detalye" action under the selected card
    // (the ranked lead), with the route's duration in its accessible name.
    const detail = screen.getAllByRole('button', {
      name: /tingnan ang detalye ng rutang \d+ min/i,
    })[0]!;
    await user.click(detail);
    expect(await screen.findByText('Detalye ng biyahe')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /about data/i }));

    expect(await screen.findByRole('heading', { name: 'Pinagmulan ng datos' })).toBeInTheDocument();
  });

  it('offers an About-data entry from Home', async () => {
    const { user } = renderApp('/');

    // M2: the link lives in the expanded sheet body; expand it like a rider
    // would before activating the link.
    const expand = screen.getByRole('button', { name: /expand sheet/i });
    await user.click(expand);
    await user.click(expand);
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-detent', 'expanded');

    await user.click(screen.getByRole('link', { name: /about data/i }));

    expect(await screen.findByRole('heading', { name: 'Pinagmulan ng datos' })).toBeInTheDocument();
    expect(await screen.findAllByTestId('dataset-card')).toHaveLength(11);
  });

  it('focuses search with the global / shortcut', async () => {
    renderApp('/');

    fireEvent.keyDown(window, { key: '/' });

    expect(await screen.findByRole('search')).toBeInTheDocument();
    // R89: `/search` is a directions form; the shortcut focuses the first
    // `input[type="search"]`, which is the From picker.
    await waitFor(() => expect(screen.getByRole('searchbox', { name: /mula sa/i })).toHaveFocus());
  });

  it('does not hijack / while the rider is typing', async () => {
    const { user } = renderApp('/search');

    const field = screen.getByRole('searchbox', { name: /mula sa/i });
    await user.type(field, '/');

    expect(field).toHaveValue('/');
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('never hijacks / from a textarea, select, contenteditable or with a modifier (M10)', () => {
    renderApp('/');

    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    select.append(document.createElement('option'));
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(textarea, select, editable);

    for (const target of [textarea, select, editable]) {
      fireEvent.keyDown(target, { key: '/' });
      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    fireEvent.keyDown(window, { key: '/', altKey: true });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();

    // Control: the same key outside a typing target does navigate, so the
    // guards above are what the assertions are proving.
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('search')).toBeInTheDocument();

    textarea.remove();
    select.remove();
    editable.remove();
  });

  it('links the fare footer to About data', () => {
    render(
      <MemoryRouter>
        <FareBreakdown
          fare={planCubaoAyalaResponse.itineraries[0]!.fare}
          sources={planCubaoAyalaResponse.sources}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /about data/i })).toHaveAttribute('href', '/sources');
  });
});
