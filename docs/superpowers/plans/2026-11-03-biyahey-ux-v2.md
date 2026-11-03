# BiyaHey! UX v2 (Kalsada identity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the BiyaHey! PWA screens on the approved "Kalsada" visual identity, with Moovit-style path visualisation (every alternative drawn as its own path, the chosen itinerary drawn leg-by-leg and synced to the trip steps), a leg-by-leg live walkthrough, and Playwright-verified behaviour.

**Architecture:** Frontend-only change inside `apps/web`. A new `RoutePathLayer` owns every MapLibre overlay (selected leg-by-leg path, alternatives, markers, camera fit, map→UI selection callbacks); new shared transit primitives (`LegStrip`, `modeMeta`, `lib/format`, `lib/itinerary`) make the cards, timeline and live screen share one vocabulary; screen components are restyled in place. No API/data changes.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind 3, MapLibre GL 6, React Router 7, TanStack Query 5, Vitest 5 + Testing Library + vitest-axe, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-11-03-biyahey-ux-v2-design.md` (read it before starting any task).

## Global Constraints

- Node ≥ 22 (`engines.node`), npm 10+; do **not** add runtime dependencies.
- Copy is Taglish (`tl`), English fallback (`en`); keys live only in `apps/web/src/i18n/strings.ts`. Mandated sentences (offline, saved-snapshot, no-live-data, "Last updated") stay byte-identical — `strings.test.ts` pins them.
- `R45`: fares, attribution and licence identifiers are API data; never recompute a fare or hardcode a matrix label.
- No real-time / live-tracking claims anywhere. No new data fetching or URL-contract changes.
- First-screen JS payload ≤ 250 KB gzip (`src/perf/bundle.test.ts`); MapLibre stays behind the existing lazy chunk.
- Touch targets ≥ 48 dp (24 px absolute min), focus rings visible, body contrast ≥ 4.5:1, non-text/map-line contrast ≥ 3:1, colour never the only channel.
- `prefers-reduced-motion`: no camera animation, no media transitions.
- Only the Lead commits / runs git state changes, full `npm run typecheck`, full `npm test`, builds and E2E.
- Writers must not touch files outside their task's scope; ask the Lead for i18n keys, shared helpers or test doubles.

## Test selector contract (Playwright depends on these)

Keep existing ids: `route-card`, `route-eta`, `route-badge`, `fare-amount`, `fare-date`, `trip-open`,
`trip-header`, `trip-summary`, `start-trip`, `save-trip`, `leg-row`, `leg-instruction`, `landmark-line`,
`stop-counter`, `fare-breakdown`, `fare-line`, `fare-breakdown-total`, `fare-estimate`, `saved-row`,
`saved-fare`, `dataset-card`, `live-banner`, `sheet`, `map-slot`, `search-group-stops`.
New ids to add: `leg-strip`, `leg-strip-segment` (+ `data-mode`, `data-minutes`, `data-index`),
`trip-map`, `leg-focus`, `route-detail-action`, `home-recents`, `recent-trip`, `saved-title`,
`live-progress`, `live-current-leg`, `live-next`, `live-prev`, `live-finish`, `live-map`.
Map assertions use `window.__biyaheyMap` (DEV only) with `getLayer`/`getSource`/`getPaintProperty`.

## Review Focus (failure modes the tests must cover)

1. **Legacy/cached payloads**: legs without `geometry` or `stops` (old cached plan / saved snapshot) must still render on the map (straight `from → to` fallback), in the strip, and in the timeline.
2. **Many legs** (the 15-leg fixture `plan-long-15-legs.json`): strip must stay legible (no overflow/zero-width segments), map fit must stay bounded, timeline must not overflow.
3. **Walk-only itinerary**: selected path has no ride leg; card/strip/legend/trip-detail/live must all render without a mode colour assumption.
4. **Keyboard + reduced motion**: card selection, leg focus and walkthrough controls reachable and operable by keyboard; reduced motion disables camera animation (assert `duration: 0`).
5. **Cold/offline trip detail**: saved snapshot (no in-memory plan cache) still renders the map path and timeline; a snapshot without geometry falls back to straight segments and never crashes.

---

## Tasks

### Task 1: Identity foundation — tokens, type scale, i18n, shared transit primitives

**Files (Lead owns, must land before any writer starts):**
- Modify: `apps/web/src/theme/tokens.css`, `apps/web/tailwind.config.js`, `apps/web/src/theme/tokens.test.ts`, `apps/web/index.html`, `apps/web/vite.config.ts` (PWA theme/background colours), `apps/web/src/i18n/strings.ts`
- Create: `apps/web/src/components/transit/modeMeta.tsx`, `apps/web/src/components/transit/LegStrip.tsx`, `apps/web/src/components/transit/LegStrip.test.tsx`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/itinerary.ts`, `apps/web/src/lib/itinerary.test.ts`
- Modify (imports only): `features/routes/ModeChips.tsx`, `features/routes/RouteCard.tsx`, `features/routes/RouteOptionsScreen.tsx`, `features/trip/LegTimeline.tsx`, `features/trip/FareBreakdown.tsx` — replace `RoutePolylines`/local formatters with the new modules so the tree keeps compiling while Task 2 replaces the map component.

**Interfaces:**
- `modeMeta.tsx` exports `MODE_COLORS: Record<LegMode, string>`, `MODE_ICONS: Record<LegMode, LucideIcon>`, `KNOWN_MODES: ReadonlySet<string>`, `isKnownMode(mode: string): mode is LegMode`, `primaryMode(itinerary: ItineraryDto): LegMode`, `routeColor(itinerary: ItineraryDto): string`, `modeLabel(mode: string, t: Translate): string`.
- `lib/format.ts` exports `formatFare(amount: number): string`, `legDistanceLabel(distanceM: number): string` (metres < 1 km, one decimal km ≥ 1 km), `transfersLabel(transfers: number, t?: Translate): string`, `walkLabel(distanceM: number, t?: Translate): string`.
- `lib/itinerary.ts` exports `itineraryEndpoints(itinerary: ItineraryDto): { from: string; to: string }` (first leg `from.name` → last leg `to.name`, trimmed; `from` falls back to `to` and vice versa when empty), `rideLegCount(itinerary): number`, `legsTotalMinutes(legs): number`.
- `LegStrip` props: `{ legs: readonly LegDto[]; selectedLegIndex?: number | null; onSelectLeg?: (index: number) => void; size?: 'sm' | 'md'; label?: string }`. Renders `<ol data-testid="leg-strip" aria-label={label} data-leg-count>` with one `<li data-testid="leg-strip-segment" data-mode data-minutes data-index>` per leg, visually-hidden text per segment, and — when `onSelectLeg` is given — each segment is a `<button aria-pressed aria-label>` with 48 dp target; segments flex-grow by leg minutes (min 1) and use `MODE_COLORS` background (walk = dashed `surface-container` pattern + ink text; ride = mode colour + white text); icons from `MODE_ICONS`.

**Steps:**
- [ ] 1. Update `tokens.css` to the Kalsada light + dark palettes, shape (`--shape-medium: 20px`, `--shape-large: 28px`), card/sheet elevation values from spec §3; keep every existing role name (components depend on them) and keep `on-tertiary-container` mapped.
- [ ] 2. Update `tailwind.config.js` only where a role gains a new utility (no renames); verify `tokens.test.ts` couples every CSS token with its Tailwind colour map.
- [ ] 3. Write failing `tokens.test.ts` additions: new values pinned; contrast of `on-fare-bg`/`fare-bg`, `on-primary`/`primary`, `on-surface`/`surface` ≥ 4.5:1 computed from hex values.
- [ ] 4. Add all new i18n keys needed by Tasks 3–7 in one pass (routes card/strip/actions, trip map/legs/fare, live walkthrough, home recents, saved titles, search polish). No screen code writes keys later.
- [ ] 5. Write failing tests: `LegStrip.test.tsx` (3 legs render 3 segments in order with mode/minutes; interactive mode exposes buttons with `aria-pressed`; min-width for a 1-minute leg; walk-only itinerary renders one walk segment; 15-leg fixture renders 15 segments without throwing); `lib/format.test.ts` (fare integer/2-dp, distance boundary 999 m/1000 m); `lib/itinerary.test.ts` (endpoints from fixture, empty-name fallback, single-leg fallback); `modeMeta` test (all 9 modes have a colour + icon, mode colours ≥ 3:1 against `#FFFFFF` map casing).
- [ ] 6. Implement the modules; migrate imports; run `npx vitest run --project web apps/web/src/components/transit apps/web/src/lib apps/web/src/theme` → PASS.
- [ ] 7. Commit `feat(web): Kalsada identity tokens, i18n and shared transit primitives`.

**Verification:** targeted Vitest green; `apps/web` compiles under the Lead's later typecheck; no visual regressions required yet.

---

### Task 2: Map engine — `RoutePathLayer`

**Files:**
- Create: `apps/web/src/components/map/RoutePathLayer.tsx`, `apps/web/src/components/map/RoutePathLayer.test.tsx`
- Modify: `apps/web/src/components/map/MapCanvas.tsx` (DEV `window.__biyaheyMap` handle), `apps/web/src/test/mocks/maplibre.ts` (add `Marker` double), `apps/web/src/components/map/map.test.tsx`, `apps/web/src/features/routes/ModeChips.tsx` (import path only, then delete when unused)
- Delete: `apps/web/src/components/map/RoutePolylines.tsx`

**Interfaces (frozen for all other tasks):**
```ts
interface RoutePathLayerProps {
  itineraries: readonly ItineraryDto[];
  variant?: 'shortlist' | 'detail';        // default 'shortlist'
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  activeLegIndex?: number | null;          // detail variant only
  onSelectLeg?: (index: number) => void;   // detail variant only
  fit?: 'all' | 'selected' | 'active-leg' | 'none';
  animated?: boolean;                      // default true, reduced-motion aware
}
```
- Renders `null` (map overlays only), owns every source/layer/marker it adds and removes them on unmount/style reload.
- Source ids: `route-<itineraryId>` (FeatureCollection of per-leg LineStrings with `properties: { legIndex, mode, colour, dash }`), `route-alternatives` (one LineString per non-selected itinerary), `route-transfers` (Points at leg joins).
- Layer ids: `route-casing`, `route-ride`, `route-walk`, `route-alt`, `route-transfers`, `route-hit` (transparent 18 px line for taps).
- `window.__biyaheyMap` set only when `import.meta.env.DEV` in `MapCanvas`; tests use `mapInstances` mock instead.

**Steps:**
- [ ] 1. Extend the MapLibre double with `Marker` (`constructor({element})`, `setLngLat().addTo()`, `remove()`, `getElement()`) and `LngLat`-free support; keep `resetMapLibreMock()`.
- [ ] 2. Write failing tests: selected itinerary produces per-leg features with the mode colour and a walk feature with `dash`; alternatives source has one feature per non-selected itinerary; a payload without `geometry` produces straight from→to coordinates; 15-leg fixture produces 15 features and a bounded fit; `onSelect` fires when the alt layer handler is emitted; `onSelectLeg` fires with the leg index from the hit-feature; `fit: 'active-leg'` calls `fitBounds` with that leg's bounds; `animated: false` and reduced-motion both call `fitBounds` with `duration: 0`; unmount removes every added source/layer/marker.
- [ ] 3. Implement `RoutePathLayer`; decode geometry with the shared `decodePolyline` (lon/lat order), join per leg without assuming the API returns geometry.
- [ ] 4. Add the DEV map handle in `MapCanvas` and a test that it is absent when `import.meta.env.DEV` is false (mock env).
- [ ] 5. Delete `RoutePolylines`; migrate remaining imports (`LegTimeline`, `map.test.tsx`); run `npx vitest run --project web apps/web/src/components/map` → PASS.
- [ ] 6. Commit `feat(web): add leg-coloured RoutePathLayer map engine`.

**Review-focus tests:** fixtures `plan-long-15-legs.json` (15 legs), a walk-only itinerary, a geometry-less itinerary — all in `RoutePathLayer.test.tsx`.

---

### Task 3: Route options v2 — cards, strip, filters, sheet

**Files:**
- Modify: `apps/web/src/features/routes/RouteCard.tsx`, `RouteOptionsScreen.tsx`, `FilterChips.tsx`, `RouteCard.test.tsx`, `RouteOptionsScreen.test.tsx`
- Delete: `apps/web/src/features/routes/ModeChips.tsx` (its vocabulary now lives in the strip)
- **Write scope:** `apps/web/src/features/routes/**` only.

**Interfaces:**
- Consumes Task 1 `LegStrip`, `lib/format`, `lib/itinerary`, `modeMeta`; existing `ItineraryDto`, `PlanOutcome`, `rankItineraries`, filter values.
- Produces for `pages/plan.tsx` (Task 8): `RouteOptionsScreen` keeps its controlled props (`plan, filter, onFilterChange, selectedId, onSelect, onOpenDetail, originLabel, stopLabels, destinationLabel, onBack, onEditTrip`) and the existing self-loading variant. `onOpenDetail` is now rendered as **one** `route-detail-action` button under the selected card (`data-testid="route-detail-action"`, also keeps `data-testid="trip-open"` for compatibility? No — use `route-detail-action`; E2E will be updated in Task 9 to use it).

**Steps:**
- [ ] 1. Write failing tests: card shows `route-eta` ("38 min"-style), arrival, `route-badge` only on the lead, `fare-amount`, `fare-date` with `effective <date>`, `leg-strip` with segment count = legs length, walk/ride `data-mode` values, selected state `aria-pressed` + ring class; card press calls `onSelect`; exactly one `route-detail-action` button exists and it belongs to the selected card; filter chips use `aria-pressed` and reorder via `rankItineraries`; skeleton/error/empty states keep their accessible text.
- [ ] 2. Implement card v2 per spec §3/§4.1 and the Kalsada mockup (`option-a-kalsada.html`): big ETA row, badge + fare right, strip, meta line, provenance line; selected surface + ring; detail action below the selected card only.
- [ ] 3. Restyle `FilterChips` (selected = `inverse-surface` fill/`inverse-on-surface` text, 48 dp, scroll row with edge padding) and `RouteOptionsScreen` header (eyebrow, `From → To` with arrow icon, departure sub-line, count line) while keeping live regions (`role="status"` etc.) and skeleton delay behaviour.
- [ ] 4. Run `npx vitest run --project web apps/web/src/features/routes` → PASS.
- [ ] 5. Commit `feat(web): rebuild route options on Kalsada with leg-strip cards`.

---

### Task 4: Trip detail v2 — map header, synced timeline, fare card

**Files:**
- Modify: `apps/web/src/features/trip/TripDetailScreen.tsx`, `LegTimeline.tsx`, `FareBreakdown.tsx`, `StopsList.tsx`, `TripDetailScreen.test.tsx`, `apps/web/src/pages/trip.tsx`
- **Write scope:** `apps/web/src/features/trip/**` + `apps/web/src/pages/trip.tsx` only.

**Interfaces:**
- Consumes Task 1 (`LegStrip`, `modeMeta`, `lib/format`) and Task 2 `RoutePathLayer` (`variant="detail"`, `selectedId={itinerary.id}`, `activeLegIndex`, `onSelectLeg`, `fit="selected" | "active-leg"`).
- Produces for Task 5: `TripDetailScreen` keeps its public props (`itinerary, sources, onStartTrip, onSave, savedSnapshotAt, onBack`) and owns `selectedLegIndex`.
- `pages/trip.tsx`: `/trip/:id` renders `AppShell`-style layout with the map above the content; map lives in a sticky header ~38dvh; content sheet scrolls over it; `MapView` + `RoutePathLayer` wired; `trip-map` test id on the map wrapper.

**Steps:**
- [ ] 1. Write failing tests: map wrapper `trip-map` renders (map mocked) with one `RoutePathLayer`; default emphasis is the whole itinerary (`activeLegIndex` null); clicking `leg-focus` on leg 2 sets `aria-current="step"` on that row and passes `activeLegIndex={1}`; clicking a `leg-strip-segment` (interactive) does the same; `LandmarkLine` renders only when `landmarkHint` is non-null; stops expander still works; fare breakdown keeps totals/date/source links; saved-snapshot note preserved; start/save CTAs unchanged; reduced-motion respected.
- [ ] 2. Implement the layout: sticky map header + rounded content sheet; floating back/save buttons; summary + CTA row; interactive `LegStrip`; leg rows with mode-coloured rail, instruction, time/stops line, signage plate, stops expander, honest landmark line only when present; fare card.
- [ ] 3. Wire `pages/trip.tsx` (map + layer + leg state + scroll-into-view on map leg selection); keep the saved-snapshot fallback path and `recordRecentTrip` effect.
- [ ] 4. Run `npx vitest run --project web apps/web/src/features/trip apps/web/src/pages`-equivalent files → PASS.
- [ ] 5. Commit `feat(web): trip detail map with synced leg-by-leg steps`.

**Review-focus tests:** geometry-less and walk-only itineraries render; 15-leg itinerary still usable.

---

### Task 5: Live walkthrough (`/trip/:id/live`)

**Files:**
- Modify: `apps/web/src/features/trip/TripLiveScreen.tsx`, `TripLiveScreen.test.tsx`, `apps/web/src/pages/trip.tsx` (live route wiring)
- **Write scope:** same as Task 4 (sequential, same owner).

**Interfaces:**
- Consumes `RoutePathLayer` (`variant="detail"`, `activeLegIndex=stepIndex`), `LegStrip`, `lib/format`, cached/saved itinerary lookup.
- Produces: state machine `stepIndex`, `finished`; test ids `live-progress`, `live-current-leg`, `live-next`, `live-prev`, `live-finish`, `live-banner`, `live-map`.

**Steps:**
- [ ] 1. Write failing tests: initial state shows step 1 of N, honest banner, current leg instruction; `live-next` advances and updates `aria-live` announcement; last step shows `live-finish` and "Tapos ang biyahe"; `live-prev` goes back and is disabled on step 1; no geolocation call is made; missing itinerary shows the honest no-cached notice.
- [ ] 2. Implement the walkthrough screen with map + progress rail + current-leg card + controls; no ETA recomputation; Taglish copy from strings.
- [ ] 3. Wire `/trip/:id/live` in `pages/trip.tsx` to pass the cached or saved itinerary.
- [ ] 4. Run targeted Vitest → PASS.
- [ ] 5. Commit `feat(web): leg-by-leg live walkthrough`.

---

### Task 6: Home + directions form v2

**Files:**
- Modify: `apps/web/src/pages/home.tsx`, `apps/web/src/features/search/SearchScreen.tsx`, `SearchResults.tsx`, `SearchScreen.test.tsx`, `SearchResults.test.tsx`
- **Write scope:** `apps/web/src/pages/home.tsx`, `apps/web/src/features/search/**` only.

**Interfaces:**
- Consumes Task 1 primitives + `readRecentTrips()`/`itineraryEndpoints()`; existing search hooks/URL contract untouched.
- Produces `home-recents`/`recent-trip` ids; keeps `Saan ka pupunta?` pill, `search-group-stops`, field labels and CTA names unchanged.

**Steps:**
- [ ] 1. Write failing tests: home renders search pill first in peek, wordmark, up to 3 recents with `recent-trip` + leg strip + endpoints title, empty state when no recents, saved/about doors; recents read failures do not crash.
- [ ] 2. Implement Home sheet v2 (Kalsada) and restyle the directions form + result rows (form card, From/To rows with endpoint dots, swap, via stops, primary CTA, grouped results, offline/error/empty states).
- [ ] 3. Run targeted Vitest → PASS.
- [ ] 4. Commit `feat(web): Kalsada home and directions form`.

---

### Task 7: Saved + About data v2

**Files:**
- Modify: `apps/web/src/features/saved/SavedScreen.tsx`, `SavedScreen.test.tsx`, `apps/web/src/features/provenance/AboutDataScreen.tsx`, `DatasetCard.tsx`, `LicenceSheet.tsx`, `ProvenanceChip.tsx`, tests
- **Write scope:** `apps/web/src/features/saved/**`, `apps/web/src/features/provenance/**`, `apps/web/src/components/provenance/**` only.

**Interfaces:**
- Consumes `itineraryEndpoints`, `LegStrip`, tokens; saved store API unchanged (`readSavedTrips`, `deleteSavedTrip`, `restoreSavedTrip`).
- Produces `saved-title` test id (endpoints title; nickname wins when set); keeps `saved-row`, `saved-fare`, `dataset-card` ids.

**Steps:**
- [ ] 1. Write failing tests: saved row title uses `Cubao → Ayala` (nickname overrides), leg strip rendered, staleness banner and undo still work; about-data dataset cards carry name/publisher/licence/last-updated and licence sheet still opens.
- [ ] 2. Implement both screens on Kalsada; keep every provenance fact and honesty sentence.
- [ ] 3. Run targeted Vitest → PASS.
- [ ] 4. Commit `feat(web): Kalsada saved trips and data provenance`.

---

### Task 8: Wire route-options map + integration polish (Lead)

**Files:**
- Modify: `apps/web/src/pages/plan.tsx` (RoutePathLayer shortlist wiring, selection sync, map padding), `apps/web/src/app.tsx` if provider/theme needs it, `apps/web/src/theme/tokens.test.ts` final values.
- **Write scope:** `apps/web/src/pages/plan.tsx`, `apps/web/src/app.tsx`, `apps/web/src/theme/**`.

**Steps:**
- [ ] 1. Replace `RoutePolylines` usage in `plan.tsx` with `RoutePathLayer` (`variant="shortlist"`, `selectedId`, `onSelect`, `fit` switching `all → selected` after explicit selection).
- [ ] 2. Confirm sheet padding + camera fit do not double-count (the R53 regression): fit padding is margin-only; `setPadding` comes from `MapSlot`.
- [ ] 3. Run `npm run lint && npm run typecheck && npm test`; fix integration fallout across tasks (this is the single committer integration point).
- [ ] 4. Commit `feat(web): wire Kalsada route paths into the plan screen`.

---

### Task 9: Playwright E2E + screenshots

**Files:**
- Create: `apps/web/e2e/ux-v2.spec.ts`, `apps/web/e2e/map-rendering.spec.ts`
- Modify: `apps/web/e2e/plan-a-trip.spec.ts`, `apps/web/scripts/screenshots.mjs`
- **Write scope:** `apps/web/e2e/**`, `apps/web/scripts/screenshots.mjs`.
- Runs against the live stack (`docker compose ps` healthy; dev server on :5173, API :8787).

**Steps:**
- [ ] 1. Update `plan-a-trip.spec.ts` for v2 selectors: leg strips on every card, one detail action, map layers present via `window.__biyaheyMap`, trip detail map + leg focus, stops expander, save → saved title → sources.
- [ ] 2. Write `map-rendering.spec.ts`: after a plan, `__biyaheyMap` has `route-ride`, `route-walk`, `route-casing`, `route-alt` layers and a `route-*` source per itinerary; selecting card 2 changes the emphasised selection (assert via a `data-selected` mirror or paint property on `route-hit`/layer order); trip-detail leg focus changes `activeLegIndex` emphasis (assert paint opacity/width or `route-transfers` data).
- [ ] 3. Write `ux-v2.spec.ts`: home recents after one planned trip; filter chip reorder; live walkthrough next/prev/finish; saved trip actions; no console errors on the main flow (`page.on('console')`/`pageerror` assertion).
- [ ] 4. Run `npx playwright test --project=dev` → PASS; run `npm run test:e2e` (build + dev + preview) → PASS.
- [ ] 5. Update `screenshots.mjs` to the new flow/test ids; regenerate `docs/screenshots/*.png`; visually review route-options + trip-detail + home + live + saved at 390×844.
- [ ] 6. Commit `test(web): Playwright coverage and screenshots for UX v2`.

---

### Task 10: Whole-branch review, acceptance, docs (Lead)

**Files:**
- Modify: `docs/superpowers/EXECUTION-HANDOFF.md`, `docs/runbooks/phase2-acceptance.md` (v2 note), `docs/runbooks/local-dev.md` (new test ids/flow pointer), `README.md` screenshots/description.

**Steps:**
- [ ] 1. Dispatch two fresh read-only reviewers (correctness/regression + UX/a11y) with file:line evidence requirements; fix Critical/Important findings and re-review.
- [ ] 2. Run the full gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build --workspace @biyahey/web`, bundle test, `npm run test:e2e`, `npm run verify:phase2` (record PARTIAL where pre-existing perf ceilings fail, never green-wash).
- [ ] 3. Record measured numbers + screenshots + known gaps in the handoff; update README/runbooks.
- [ ] 4. Commit and merge the feature branch to local `main` as a `--no-ff` merge after `git diff` review; do not push (no remote configured).

---

## Parallelism and ownership (Team Lead dispatch)

| Lane | Owner | Write scope | Depends on |
|---|---|---|---|
| Foundation + map engine | Lead | `theme/**`, `i18n/**`, `components/transit/**`, `components/map/**`, `lib/**`, `pages/plan.tsx`, `routes.tsx` | — |
| Route options | impl-routes | `features/routes/**` | Task 1 |
| Trip detail + live | impl-trip | `features/trip/**`, `pages/trip.tsx` | Tasks 1, 2 |
| Home + search + saved + provenance | impl-app | `pages/home.tsx`, `features/search/**`, `features/saved/**`, `features/provenance/**`, `components/provenance/**`, `components/navigation/**` | Task 1 |
| E2E + screenshots | impl-e2e | `apps/web/e2e/**`, `apps/web/scripts/screenshots.mjs` | Tasks 3–8 |

Rules for every writer: never run `git add/commit/checkout`, `npm install`, full `npm run typecheck` or full `npm test`; run targeted `npx vitest run --project web <paths>`; never edit `strings.ts` (request keys from the Lead); leave the tree compiling; report files changed + commands run + results.

## Self-review notes

- Spec §2 screens each map to Task 3/4/5/6/7; §3 identity to Task 1; §4 interaction to Tasks 3/4/5/8; §5 architecture to Tasks 1/2/8; §6 a11y to Task 1 + per-screen tests + Task 9 console/axe; §7 performance to Task 8 gates; §8 testing to Tasks 9/10; §9 non-goals respected (no API changes).
- Review Focus items each have an owning test: (1) Task 2 + Task 4, (2) Task 2 + Task 3, (3) Task 2 + Task 4 + Task 5, (4) Task 2 + Task 4, (5) Task 4.
- Types are frozen in Tasks 1–2 `Interfaces` blocks and referenced by later tasks without redefinition.
