# BiyaHey! PWA MVP (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mobile-first PWA from spec §11 in the approved Google-Maps-faithful layout (Option A): search any NCR place, compare 3–5 fare-forward route options, follow step-by-step sakay instructions, save/operate offline, and read exactly where every dataset came from.

**Architecture:** A React 19 + Vite + TypeScript SPA renders a full-bleed MapLibre map with a persistent three-detent bottom sheet. It talks only to the BFF from the data-spine plan (`/search`, `/plan`, `/sources`) through a typed client; server state is cached with TanStack Query, offline state and saved trips live in localStorage + a Workbox service worker. All UI copy comes from a Taglish string module; all attribution strings come from the API's `sources[]` array.

**Tech Stack:** React 19, TypeScript strict, Vite 6, Tailwind CSS 3.4, MapLibre GL JS 6, OpenFreeMap "Liberty" style, Lucide React, React Router 7, TanStack Query 5, vite-plugin-pwa (Workbox), Vitest + React Testing Library + vitest-axe, MSW 2, Playwright, Lighthouse CI.

**Spec:** `docs/superpowers/specs/2026-11-01-biyahey-design.md` (§11, §12 phase 2, §13) and the approved mockup `.superpowers/mockups/option-a-maps-faithful.html`. Depends on `docs/superpowers/plans/2026-11-01-biyahey-data-spine.md` (API contract in its Task 10).

## Global Constraints

- Node 22 + npm 10; TypeScript strict; ESLint 9 flat config; no `any` in exported types.
- Commits: Conventional Commits; branches `feature/…`; PRs disclose AI assistance.
- The UI must keep the Option A container: search pill on top of a live map, **non-modal standard bottom sheet** (peek/half/expanded), one visual emphasis per route card, provenance chip in every card footer.
- **Fare is a first-class card field** and every displayed fare shows its `effective_from` date; no fare is ever shown without a source or an "estimate" label.
- Provenance is generated only from `sources[]` returned by the API — no hardcoded attribution strings in components except the map-tile credit required by the tile provider and the OSM credit.
- Modes never rely on colour alone; transit line colours come from feed data only.
- Performance budgets (CI-enforced): cold start → interactive map ≤ 3 s on a 4×-throttled mobile profile; first route-screen payload ≤ 250 KB gzip; network silent for 60 s must not blank the screen.
- Accessibility: WCAG 2.2 AA — 4.5:1 text contrast, 3:1 non-text contrast, 48 dp targets, 24×24 px minimum, 200 % text resize, drag alternative for the sheet.
- Taglish string set for the top ~60 strings, English fallback; screen-reader language tags correct.
- Works fully on a 4 GB Android-Go-class device: no WebGL fallback requirement, but `saveData` → raster tile fallback and no animation on the sheet when `prefers-reduced-motion`.
- No user accounts, no real-time claims; any "live" wording is forbidden — use "expected wait".

## Review Focus

1. **Long/overflowing content**: a route with 15+ legs and a 60-character stop name must not clip the fare, ETA, or CTA; the sheet scrolls, cards truncate name lines gracefully — tested in Tasks 5 and 6.
2. **Offline reload**: killing the network then reloading a saved trip renders the saved snapshot with a staleness stamp and never a blank screen — tested in Task 8.
3. **200 % text zoom at 320 px width**: fare and primary CTA remain visible and tappable (no horizontal scroll) — tested in Task 9.
4. **Unknown itinerary mode** (an API mode outside the icon set): renders a generic "sakay" chip with the mode name, no crash — tested in Task 5.
5. **Itinerary references a source missing from `/sources`**: the provenance chip shows "source unavailable" and About-data lists what exists, rather than rendering `undefined` — tested in Task 7.

---

### Task 1: Web app scaffold, routers, test harness

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/app.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/theme/tailwind.css`
- Create: `apps/web/src/test/setup.ts`, `apps/web/src/app.test.tsx`, `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`
- Create: `apps/web/tailwind.config.js`, `apps/web/postcss.config.js`

**Interfaces:**
- Produces: `App` component rendered at `/`; route table `/`, `/search`, `/plan`, `/trip/:id`, `/saved`, `/sources`; Vitest project `web`; Playwright config with `webServer` running `npm run dev --workspace @biyahey/web`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/app.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './app';
it('renders the search pill as the app entry point', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /saan ka pupunta/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web`
Expected: FAIL — `App` module missing.

- [ ] **Step 3: Scaffold the app**

Vite React-TS app; Tailwind with the design-token CSS variables from Task 2 (initially empty tokens); React Router routes as above; TanStack Query client provider; `@biyahey/shared` dependency; Vitest jsdom + RTL + jest-dom setup; Playwright config with mobile viewport (390×844, Pixel 7 emulation). The placeholder `App` renders the search pill button from the test.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web && npm run typecheck && npx playwright test smoke`
Expected: unit test passes; typecheck clean; Playwright smoke opens `/` and sees the search pill.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold PWA with router, query client and test harness"
```

---

### Task 2: Design tokens, app shell, bottom sheet

**Files:**
- Create: `apps/web/src/theme/tokens.css`, `apps/web/src/components/sheet/BottomSheet.tsx`, `BottomSheet.test.tsx`
- Create: `apps/web/src/components/layout/AppShell.tsx`, `MapSlot.tsx`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**
- Produces: `BottomSheet({ detents: [96, 'half', 'expanded'], initial: 'peek', onDetentChange, children })` with `data-detent` attribute, `aria-expanded` on the handle, keyboard/button alternative for dragging; `AppShell({ map, sheet })` laying out a full-bleed map with the sheet overlay; CSS tokens `--surface`, `--surface-container`, `--primary`, `--on-primary`, `--on-surface`, `--on-surface-variant`, `--outline`, `--fare-bg`, sprites for elevation.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/sheet/BottomSheet.test.tsx
it('starts at peek and expands via the accessible control', async () => {
  render(<BottomSheet detents={[96, 'half', 'expanded']} initial="peek"><p>content</p></BottomSheet>);
  const sheet = screen.getByTestId('sheet');
  expect(sheet).toHaveAttribute('data-detent', 'peek');
  await userEvent.click(screen.getByRole('button', { name: /expand sheet/i }));
  expect(sheet).toHaveAttribute('data-detent', 'half');
});
it('has no axe violations', async () => {
  const { container } = render(<BottomSheet ...><p>content</p></BottomSheet>);
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- BottomSheet`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement tokens, shell and sheet**

Tokens: M3-style tonal roles on an 8 dp grid, 48 dp targets, one brand accent; transit colours are *not* tokenised. Sheet: pointer-drag with detent snapping, `prefers-reduced-motion` disables animation, back gesture collapses one detent before route pop, map padding callback via context so consumers can offset controls. `AppShell` renders `MapSlot` (empty placeholder until Task 3) and the sheet.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass, axe clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme apps/web/src/components
git commit -m "feat(web): add design tokens, app shell and accessible bottom sheet"
```

---

### Task 3: Map canvas, route polylines, L1 attribution credit

**Files:**
- Create: `apps/web/src/components/map/MapCanvas.tsx`, `apps/web/src/components/map/RoutePolylines.tsx`, `apps/web/src/components/map/MapCredit.tsx`
- Create: `apps/web/src/components/map/map.test.tsx`, `apps/web/src/test/mocks/maplibre.ts`

**Interfaces:**
- Consumes: `sources[]` shape from the API; `LegDto`/`ItineraryDto` from `@biyahey/shared`.
- Produces: `<MapCanvas>{children}</MapCanvas>` mounting MapLibre with the OpenFreeMap Liberty style; `<RoutePolylines itineraries selectedId onSelect />` (selected leg geometry emphasised, others 60 % opacity); `<MapCredit sources={DataSource[]} />` rendering `© OpenStreetMap contributors · OpenFreeMap` and collapsing to an ⓘ button after first interaction while staying reachable.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/map/map.test.tsx
vi.mock('maplibre-gl', () => mockMapLibre); // from test/mocks/maplibre.ts
it('renders the required map credit computed from sources', () => {
  render(<MapCredit sources={[osmSource, openFreeMapSource]} />);
  expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
  expect(screen.getByText(/OpenFreeMap/)).toBeInTheDocument();
});
it('draws one GeoJSON source per itinerary and dims unselected ones', () => {
  render(<RoutePolylines itineraries={[itinA, itinB]} selectedId="a" />);
  expect(mockMapLibre.addSource).toHaveBeenCalledTimes(2);
  expect(mockMapLibre.setPaintProperty).toHaveBeenCalledWith('route-b', 'line-opacity', 0.6);
});
it('opens the attribution detail from the collapsed credit', async () => {
  render(<MapCredit sources={[osmSource]} />);
  await userEvent.click(screen.getByRole('button', { name: /data sources/i }));
  expect(screen.getByRole('link', { name: /openstreetmap copyright/i })).toHaveAttribute('href',
    'https://www.openstreetmap.org/copyright');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- map.test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the map layer**

`MapCanvas`: maplibre `Map` with style `https://tiles.openfreemap.org/styles/liberty`, `attributionControl: false` (we render our own credit), locate FAB wired to `navigator.geolocation` with a manual pin-drop fallback when permission is denied. `RoutePolylines`: decode MOTIS polylines (Google polyline, precision from `legGeometry`/API) into GeoJSON `LineString`s, one source+layer per itinerary, colour from `route_color` when present, else mode colour, always paired with a text label chip in the sheet. `MapCredit`: derives the string from `sources` ids `osm`/`openfreemap`; collapses after 5 s or first map interaction per OSMF rules; always available via a labelled ⓘ button.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web && npx playwright test smoke`
Expected: tests pass; smoke still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/map apps/web/src/test/mocks
git commit -m "feat(web): add MapLibre canvas, route polylines and map attribution credit"
```

---

### Task 4: Typed API client and search screen

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts` (re-export from `@biyahey/shared`)
- Create: `apps/web/src/features/search/SearchScreen.tsx`, `useSearch.ts`, `SearchResults.tsx`
- Create: `apps/web/src/test/handlers.ts` (MSW), `SearchScreen.test.tsx`
- Modify: `apps/web/src/routes.tsx` (wire `/` and `/search`)

**Interfaces:**
- Consumes: `GET /search?q=`, `POST /plan` (data-spine Task 10 contract).
- Produces: `searchPlaces(q: string): Promise<SearchResponse>`; `planTrip(req: PlanRequest): Promise<PlanResponse>`; `useSearch(q)` (250 ms debounce, in-flight cancel via `AbortController`, 20-query localStorage cache, offline fallback returning saved places with `offline: true`); `<SearchScreen />` with grouped results **Stops · Landmarks · Routes · Saved**, each row showing type icon, locality and distance.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/search/SearchScreen.test.tsx (MSW handlers in src/test/handlers.ts)
it('debounces and groups results', async () => {
  render(<SearchScreen />);
  await userEvent.type(screen.getByRole('searchbox'), 'ayala');
  await vi.advanceTimersByTimeAsync(249);
  expect(fetchSpy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await screen.findByRole('heading', { name: /landmarks/i })).toBeInTheDocument();
  expect(screen.getByText('Ayala Triangle Gardens')).toBeInTheDocument();
});
it('shows the offline empty state instead of a blank screen', async () => {
  server.use(http.get('*/search', () => HttpResponse.error()));
  render(<SearchScreen />);
  expect(await screen.findByText(/walang signal/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /saved places/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- SearchScreen`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement client + search**

`api.ts`: `fetch` wrapper with 5 s timeout, `AbortSignal`, error type `ApiError{code,message}`, base URL `import.meta.env.VITE_API_URL ?? 'http://localhost:8787'`. `useSearch`: TanStack Query with `enabled: q.length >= 2`, 250 ms debounce, `placeholderData` from the 20-entry cache, offline mode from `navigator.onLine` + service worker cache. `SearchScreen`: search pill focus state, grouped sections, empty/error/offline states, distance formatting in metres/km, PSGC locality in the row subtitle.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/features/search apps/web/src/test/handlers.ts apps/web/src/routes.tsx
git commit -m "feat(web): add typed API client and debounced grouped search"
```

---

### Task 5: Route options screen — fare-forward Google-like cards

**Files:**
- Create: `apps/web/src/features/routes/RouteOptionsScreen.tsx`, `RouteCard.tsx`, `FilterChips.tsx`, `ModeChips.tsx`, `RouteOptionsScreen.test.tsx`
- Create: `apps/web/src/features/routes/usePlan.ts`
- Create: `apps/web/src/test/fixtures/plan-cubao-ayala.json`
- Modify: `apps/web/src/routes.tsx` (wire `/plan`)

**Interfaces:**
- Consumes: `planTrip`, `ItineraryDto` (with `fare`, `sources`, `legs`).
- Produces: `<RouteOptionsScreen origin destination />`; `<RouteCard itinerary selected onSelect />` showing ETA (largest), arrival time, **₱ fare**, transfers ("direct"/"1 sakay"), walk total, mode chips, provenance chip, and one badge (`BEST` / `CHEAPEST` / `FEWEST TRANSFERS`); `<FilterChips options value onChange />` re-ranking locally without refetching.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/routes/RouteOptionsScreen.test.tsx
it('shows 3 fare-forward cards sorted by ETA with provenance chips', async () => {
  render(<RouteOptionsScreen origin={cubao} destination={ayala} />);
  const cards = await screen.findAllByTestId('route-card');
  expect(cards).toHaveLength(3);
  expect(cards[0]).toHaveTextContent('31 min');
  expect(cards[0]).toHaveTextContent('₱20');
  expect(cards[0]).toHaveTextContent(/fare:/i);
  expect(screen.getByTestId('fare-date')).toHaveTextContent('2026-09-28');
});
it('re-ranks by cheapest without refetching', async () => {
  render(<RouteOptionsScreen ... />);
  await screen.findAllByTestId('route-card');
  await userEvent.click(screen.getByRole('button', { name: /cheapest/i }));
  const fares = screen.getAllByTestId('fare-amount').map(n => Number(n.textContent!.replace('₱', '')));
  expect(fares).toEqual([...fares].sort((a, b) => a - b));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
it('renders an unknown mode with a generic sakay chip', async () => {
  server.use(http.post('*/plan', () => HttpResponse.json(planWithUnknownMode)));
  render(<RouteOptionsScreen ... />);
  expect(await screen.findByText(/sakay \(hovercraft\)/i)).toBeInTheDocument();
});
it('shows skeleton cards after 300ms, never a spinner', async () => { /* fake timers */ });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- RouteOptions`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the screen**

Card anatomy exactly as spec §11 screen 3: ETA `titleLarge`, arrival secondary, fare in its own token with `effective_from` line (`Fares: LTFRB matrix effective 2026-09-28`), transfer wording in Taglish ("direct" / "2 sakay"), walk total, mode chips with icons (walk, jeepney, bus, rail with line colour, ferry, uv, p2p; unknown → generic "sakay (mode)"), one provenance chip generated by `attributionFor(itinerary.sources.slice(0,2)) + ' · Data sources ⓘ'`. One card emphasised (selected first), siblings at surface-container elevation. Skeletons after 300 ms; empty state "Walang ruta — try a nearby landmark"; error state with retry. Chip filters: Recommended / Cheapest / Fewest transfers / Less walking (client-side re-rank of the same array, no refetch).

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/routes apps/web/src/test/fixtures apps/web/src/routes.tsx
git commit -m "feat(web): add fare-forward route options with filters and provenance chips"
```

---

### Task 6: Trip detail — step-by-step sakay timeline and fare breakdown

**Files:**
- Create: `apps/web/src/features/trip/TripDetailScreen.tsx`, `LegTimeline.tsx`, `FareBreakdown.tsx`, `StopsList.tsx`, `TripDetailScreen.test.tsx`
- Modify: `apps/web/src/routes.tsx` (wire `/trip/:id`)

**Interfaces:**
- Consumes: itinerary from the plan response cache (keyed by itinerary id; falls back to refetch by `?planId=`).
- Produces: `<TripDetailScreen itinerary />` with header (total time · fare · Start/Save CTAs), `<LegTimeline legs />` (icon rail + instruction + **landmark line**; ride legs expand to `<StopsList>` with alight stop pinned and stop counter), `<FareBreakdown fare />` (per-leg lines + effective date + source link).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/trip/TripDetailScreen.test.tsx
it('renders leg instructions with signage to look for and landmark hints', async () => {
  render(<TripDetailScreen itinerary={cubaoAyalaItinerary} />);
  expect(screen.getByText(/look for: MRT-3 \/ Ayala/i)).toBeInTheDocument();
  expect(screen.getByText(/landmark: Farmers Plaza/i)).toBeInTheDocument();
});
it('expands a ride leg to its stop list with the alight stop pinned', async () => {
  render(<TripDetailScreen itinerary={cubaoAyalaItinerary} />);
  await userEvent.click(screen.getByRole('button', { name: /show 3 stops/i }));
  const stops = screen.getAllByTestId('stop-row');
  expect(stops).toHaveLength(4);
  expect(stops.at(-1)).toHaveAttribute('data-alight', 'true');
  expect(stops.at(-1)).toHaveTextContent('Ayala');
});
it('renders the fare breakdown with its source and effective date', () => {
  render(<TripDetailScreen itinerary={cubaoAyalaItinerary} />);
  expect(screen.getByText(/mrt-3 fare/i)).toBeInTheDocument();
  expect(screen.getByText(/effective 2026-03-23/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /lrta/i })).toHaveAttribute('href', 'https://www.lrta.gov.ph/tickets-and-fares/');
});
it('does not clip a 15-leg, 60-character-stop itinerary', async () => {
  render(<TripDetailScreen itinerary={longItinerary} />);
  expect(screen.getByTestId('fare-total')).toBeVisible();
  expect(screen.getByRole('button', { name: /start trip/i })).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- TripDetail`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement trip detail**

Header: `X min · arrive HH:mm · ₱NN`; Start trip → `/trip/:id/live` placeholder screen (v1: static step tracking with a "no live data — expected wait" banner). Timeline: one row per leg; walk legs show distance and instruction; ride legs show route/signage (`Look for: …`), stop counter and expandable stop list (virtualised if > 30 stops); transfer legs show buffer ("Allow 5 min transfer") and `informal_transfer` label. Landmark line under every instruction (falls back to "walang landmark — use the stop name"). Fare footer from `fare.breakdown`, each line with source link; `confidence: estimated` adds "estimate" text. Save button writes to saved-trips store (Task 8); CTA stays pinned above the safe area while the timeline scrolls.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/trip apps/web/src/routes.tsx
git commit -m "feat(web): add step-by-step trip detail with fare breakdown and landmarks"
```

---

### Task 7: Provenance L2/L3 — About data screen

**Files:**
- Create: `apps/web/src/features/provenance/AboutDataScreen.tsx`, `DatasetCard.tsx`, `LicenceSheet.tsx`, `useSources.ts`, `AboutDataScreen.test.tsx`
- Modify: `apps/web/src/routes.tsx` (wire `/sources` and the global ⓘ)

**Interfaces:**
- Consumes: `GET /sources → DataSource[]`; every itinerary's `sources[]`.
- Produces: `<AboutDataScreen />` listing one `<DatasetCard>` per dataset (name, publisher, SPDX licence, last updated, coverage, confidence) and `<LicenceSheet dataset />` (full licence text/link, source URL, "report an issue" link). Reachable from Settings and from every ⓘ in ≤ 2 taps.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/provenance/AboutDataScreen.test.tsx
it('lists every dataset with publisher, licence and last-checked date', async () => {
  render(<AboutDataScreen />);
  const cards = await screen.findAllByTestId('dataset-card');
  expect(cards).toHaveLength(10);
  const osm = cards.find(c => c.textContent!.includes('OpenStreetMap'))!;
  expect(osm).toHaveTextContent('OpenStreetMap contributors');
  expect(osm).toHaveTextContent('ODbL-1.0');
  expect(osm).toHaveTextContent('2026-11-01');
});
it('opens the licence sheet with the full licence link', async () => {
  render(<AboutDataScreen />);
  await userEvent.click((await screen.findAllByTestId('dataset-card'))[0]);
  expect(screen.getByRole('link', { name: /open database license/i })).toBeInTheDocument();
});
it('shows "source unavailable" when an itinerary references a missing dataset', () => {
  render(<ProvenanceChip sourcesFromItinerary={['made-up']} knownSources={[]} />);
  expect(screen.getByText(/source unavailable/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- AboutData`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement provenance UI**

Cards limited to L2 fields; L3 sheet for licence detail; strings come from API fields only (no duplicated literals). Add the global `/` shortcut and Settings entry. Implement `ProvenanceChip` shared component (also used by route cards) with the missing-source fallback.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/provenance apps/web/src/routes.tsx
git commit -m "feat(web): add About-data provenance screens with licence detail"
```

---

### Task 8: Saved trips, recents and offline behaviour

**Files:**
- Create: `apps/web/src/features/saved/SavedScreen.tsx`, `useSavedTrips.ts`, `offlineCache.ts`, `SavedScreen.test.tsx`
- Create: `apps/web/src/lib/deviceStore.ts` (localStorage wrapper with versioned schema)
- Modify: `apps/web/vite.config.ts` (vite-plugin-pwa Workbox config)

**Interfaces:**
- Produces: `saveTrip(itinerary: ItineraryDto): void` (stores fare snapshot + dataset version + `savedAt`), `getSavedTrips(): SavedTrip[]`, `isStale(trip): boolean` (fare `effective_from` ≠ current matrix or `savedAt` > 30 days), `useSavedTrips()`; `<SavedScreen />` with Saved/Recent tabs, offline badge, "fare changed since you saved this" state, swipe-to-delete with undo, rename.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/saved/SavedScreen.test.tsx
it('keeps saved trips fully readable offline with a staleness stamp', async () => {
  seedSavedTrip({ fareSnapshot: 20, currentFare: 26, savedAt: '2026-09-01' });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  render(<SavedScreen />);
  expect(await screen.findByText(/saved route \(no live data\)/i)).toBeInTheDocument();
  expect(screen.getByText(/fare may have changed/i)).toBeInTheDocument();
  expect(screen.getByText(/last updated/i)).toBeInTheDocument();
});
it('deletes with undo and expires recents after 30 days', async () => { /* ... */ });
it('does not clear the screen when the network is silent', async () => {
  vi.useFakeTimers();
  render(<SavedScreen />);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(screen.getByTestId('saved-list')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/web -- SavedScreen`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement saved/offline**

`deviceStore`: namespaced key `biyahey:v1:*`, migration guard, quota-safe try/catch. Saved trip stores the full itinerary DTO + its `sources[]` so provenance works offline. Workbox: precache app shell; `NetworkFirst` for `/plan`/`/search` with 3 s timeout; `CacheFirst` for OpenFreeMap tiles with 7-day expiry and a 40-tile-per-viewport cap; `StaleWhileRevalidate` for `/sources` with 24 h expiry. Recent list auto-expires at 30 days. UI never renders a stale ETA unlabelled.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/saved apps/web/src/lib apps/web/vite.config.ts
git commit -m "feat(web): add saved trips, recents and offline caching"
```

---

### Task 9: Taglish strings and accessibility pass

**Files:**
- Create: `apps/web/src/i18n/strings.ts`, `apps/web/src/i18n/useT.ts`, `apps/web/src/i18n/strings.test.ts`
- Modify: every screen to use `t('key')`; add `apps/web/src/a11y.test.tsx` (vitest-axe over key screens)

**Interfaces:**
- Produces: `type Locale = 'tl' | 'en'`; `STRINGS: Record<Locale, Record<string,string>>` with the top-60 Taglish strings (e.g. `search.placeholder: "Saan ka pupunta?"`, `routes.sakay: "sakay"`, `trip.baba: "Baba"`, `trip.lipat: "Lipat"`, `trip.bayad: "Bayad"`, `common.fare: "Pamasahe"`); `useT()` returning `t(key)` and `locale`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/i18n/strings.test.ts
it('covers every key in every locale', () => {
  for (const locale of ['tl','en']) expect(Object.keys(STRINGS[locale])).toEqual(expect.arrayContaining(Object.keys(STRINGS.tl)));
});
it('does not machine-translate brand or unit tokens', () => {
  expect(STRINGS.tl['common.fare']).not.toMatch(/fare/i);
  expect(STRINGS.tl['routes.sakay']).toMatch(/sakay/i);
});
```
```tsx
// apps/web/src/a11y.test.tsx
it('has no axe violations on the route options screen', async () => {
  const { container } = render(<RouteOptionsScreen ... />);
  expect(await axe(container)).toHaveNoViolations();
});
it('survives 200% text zoom at 320px width', async () => {
  document.documentElement.style.fontSize = '200%';
  window.innerWidth = 320; // via matchMedia mock
  render(<RouteOptionsScreen ... />);
  expect(screen.getByTestId('fare-amount')).toBeVisible();
  expect(screen.getByRole('button', { name: /start trip/i })).toBeVisible();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @biyahey/web`
Expected: FAIL — missing i18n module.

- [ ] **Step 3: Implement i18n + a11y fixes**

Add the string module with Taglish defaults and English overrides; replace literals in screens; set `<html lang>` per locale and `lang` attributes on mixed-language spans. Fix anything axe reports: focus order, labels, sheet drag alternative, reduced-motion support, contrast tokens, 48 dp targets.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/web`
Expected: all tests pass including axe and zoom checks.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n apps/web/src/a11y.test.tsx apps/web/src
git commit -m "feat(web): add Taglish strings and WCAG 2.2 accessibility pass"
```

---

### Task 10: Performance budgets, E2E flow

**Files:**
- Create: `apps/web/lighthouserc.json`, `apps/web/e2e/plan-a-trip.spec.ts`
- Modify: `apps/web/src/routes.tsx` (lazy-load non-home routes), `package.json` scripts `test:e2e`, `perf:web`
- Create: `.github/workflows/web.yml` (unit + a11y + build-budget job; Playwright job against compose stack)

**Interfaces:**
- Produces: bundle-budget test in `apps/web/src/perf/bundle.test.ts` asserting the initial route chunk ≤ 250 KB gzip via a build-size script; Lighthouse CI assertions for the performance budget; E2E covering search → options → trip detail → save → About-data.

- [ ] **Step 1: Write the failing budget test**

```ts
// apps/web/src/perf/bundle.test.ts — reads dist/ manifest after `npm run build`
it('keeps the first route screen under 250 KB gzip', () => {
  const budget = readGzipBudget('dist/manifest.json', ['index.*.js', 'index.*.css']);
  expect(budget).toBeLessThanOrEqual(250 * 1024);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @biyahey/web && npm test --workspace @biyahey/web -- bundle`
Expected: FAIL — budget script missing / initial chunk over budget.

- [ ] **Step 3: Implement splitting + E2E**

Lazy-load `/trip`, `/saved`, `/sources` routes; preload the map style; defer lucide icon tree-shaking; add Lighthouse CI config with mobile throttling (`cpuSlowdownMultiplier: 4`) and assertions on LCP ≤ 3 s, TBT, and total transfer size. E2E: `search "Cubao"` → select suggestion → `plan` shows 3 cards with ₱ → open first card → trip detail shows signage → tap Save → `/saved` shows the trip → `/sources` lists OSM. Run against `docker compose up` stack with `API_URL` pinned.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run perf:web && npm run test:e2e`
Expected: bundle under budget; Lighthouse assertions pass; E2E green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lighthouserc.json apps/web/e2e apps/web/src/perf .github/workflows/web.yml
git commit -m "perf(web): enforce bundle/tile budgets and add end-to-end trip flow"
```

---

### Task 11: Phase-2 acceptance and docs

**Files:**
- Create: `docs/runbooks/phase2-acceptance.md`, `docs/runbooks/local-dev.md`
- Modify: `README.md` (quick start, screenshots from mockup), `CONTRIBUTING.md` (UI conventions), `package.json` script `verify:phase2`

**Interfaces:**
- Produces: `npm run verify:phase2` running unit tests, a11y tests, build budget, Playwright E2E, and Lighthouse against the local compose stack.

- [ ] **Step 1: Write the failing acceptance script**

```js
// scripts/verify-phase2.mjs — exits non-zero unless every spec §3 criterion passes
const steps = ['npm test --workspace @biyahey/web', 'npm run build --workspace @biyahey/web',
  'npm test --workspace @biyahey/web -- bundle', 'npm run test:e2e'];
for (const cmd of steps) runOrThrow(cmd);
```

- [ ] **Step 2: Run it to verify it fails initially**

Run: `npm run verify:phase2`
Expected: FAIL — script missing (before Step 3).

- [ ] **Step 3: Implement the script and runbooks**

`local-dev.md`: prerequisites (Docker Desktop, Node 22), `npm run data:build`, `docker compose up`, `npm run dev`, Windows notes; `phase2-acceptance.md` maps each spec §3 criterion 2–6 to the command that proves it and the expected output. CONTRIBUTING gains the UI conventions (Option A container, fare-first cards, provenance rules, Taglish strings, a11y checklist).

- [ ] **Step 4: Run the acceptance**

Run: `npm run verify:phase2`
Expected: all checks pass; documented outputs match.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-phase2.mjs docs/runbooks README.md CONTRIBUTING.md
git commit -m "docs: add phase-2 acceptance runbook and verify script"
```

---

## Self-review notes (author)

- Spec coverage: §11 screens 1–6 → Tasks 3–8; provenance rules → Tasks 3, 5, 7; accessibility/performance/localisation → Tasks 9, 10; §3 criteria 2–6 → Task 11; §13 testing → per-task test steps + Task 10 E2E.
- Type consistency: components consume `ItineraryDto`, `LegDto`, `FareQuote`, `DataSource` from `@biyahey/shared`; no component redefines these.
- Spec gaps consciously handled here: the "Start trip" live screen is explicitly a static step tracker with a "no live data" banner (spec §11 phase-2 scope, no real-time) — noted in Task 6.
