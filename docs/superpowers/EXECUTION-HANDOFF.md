# BiyaHey! — Execution Handoff (durable state)

> Read this first if the session was compacted, forked, or handed to a fresh agent.
> It is the short, authoritative state of the project. The spec is the authority; the plans are its executable argument.

## Intent (human-approved)

Open-source, community-built commuter route planner for the Philippines, intended as a BetterGov.ph-aligned civic-tech project. Mobile-first PWA, Google-Maps-faithful UI (approved mockup: `.superpowers/mockups/option-a-maps-faithful.html`), Metro Manila + commuter belt for v1, local-first Docker development, every route/fare must state where its data comes from.

## Approved artifacts

| Artifact | Path |
|---|---|
| Design spec (approved by user) | `docs/superpowers/specs/2026-11-01-biyahey-design.md` |
| Research — PH transit datasets & licensing | `docs/research/ph-transit-datasets.md` |
| Research — routing & map stack | `docs/research/routing-and-map-stack.md` |
| Research — UI & competitors | `docs/research/ui-and-competitors.md` |
| Plan 1 — data spine + router (Phase 0–1) | `docs/superpowers/plans/2026-11-01-biyahey-data-spine.md` |
| Plan 2 — PWA MVP (Phase 2) | `docs/superpowers/plans/2026-11-01-biyahey-pwa-mvp.md` |
| Trip planner (R89) approved UI — Option A directions form | `.superpowers/mockups/option-1-directions-form.html` |
| UI mockups (Option A chosen) | `.superpowers/mockups/` |

## Non-negotiable facts from research (do not re-litigate)

- **No official PH GTFS or GTFS-RT exists.** All circulating feeds are 2013–2020 artifacts with unclear licences. Do not ship or cite `sakay-gtfs`, `ptac-2014`, `busmaps`.
- **OSM is the only current licensed backbone**: Geofabrik PH PBF, ODbL 1.0, data to 2026-10-31. Jeepney route relations are thin (76 `route=share_taxi` nationwide) — the curated inventory is mandatory.
- **Fares**: LTFRB matrix effective 2026-09-28 (jeepney ₱14/4 km + ₱2.00/km; modern jeepney ₱17 + ₱2.40; city bus ordinary ₱15/5 km + ₱2.49; aircon ₱18 + ₱2.98; provincial ordinary ₱12 + ₱2.20; UV Express ₱2.60/₱3.00 per km; P2P +15 %). LRT-2/MRT-3 50 % discount since 2026-03-23; **LRT-1 excluded** (₱16.25 + ₱1.47/km since 2025-04-02). Pasig River Ferry free. Free-ride service-contracting routes need `override: 0` flags (status unverified).
- **PNR suspended** until ~2028; **tricycles have no data**; **no live tracking exists** — never claim real-time.
- **Google Maps Platform is contractually incompatible** with this design; use MapLibre + OpenFreeMap.
- MOTIS v2.11.4 (MIT): release assets `motis-linux-amd64.tar.bz2` (sha256 `b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc`), `motis-windows.zip`; API `/api/v6/plan`, `/api/v1/geocode`, port 8080. State the exact payload mapping is verified against `openapi.yaml` at implementation.

## Environment as verified 2026-11-01

- Node **v24.19.0**, npm **11.17.0** (plan floor is Node 22/npm 10 — satisfied).
- Python **3.10.11** (plan text said 3.12 → ruling: target **≥3.10**, syntax compatible).
- Docker **29.0.1** + Compose **v2.40.3** available.
- git **2.50.1.windows.1**; global identity `andrewhmir <andrew.alangcao@gmail.com>`.
- Shell: Windows PowerShell 5.1. Plans/scripts must not depend on bash; use `npm run` / PowerShell-safe commands. Git Bash exists at `C:\Program Files\Git\bin\bash.exe` for the superpowers helper scripts when useful.
- Repo root: `C:\Users\Andrew\Desktop\BiyaHey!`.

## Rulings made before execution (ledgered in `.superpowers/sdd/data-spine/progress.md`)

1. **Branch isolation, not worktree**: implementation happens on `feature/data-spine` in the main checkout. One sequential writer, so a worktree adds no safety.
2. **Python 3.10**, not 3.12 (see environment).
3. **Node 24** runs the stack; `engines` must be `>=22`.
4. **MRT-3 fare formula** (plan arithmetic slip): `published = round(min + (max − min) × distanceKm/lengthKm)` to whole pesos, then × 0.5 for the 50 % discount. 8.2 km → ₱20 published → **₱10 charged**. Tests must assert 10, not 9.
5. **osmium bbox argument** is lon,lat order: `--bbox 120.90,14.35,121.15,14.80`; the researched tuple `ncr_bbox()` returns `(14.35, 120.90, 14.80, 121.15)`.
6. **`attributionFor` order** follows the canonical registry order in `sources.yaml`, not caller order (test expectation in Task 2 matches registry order).
7. **`buildApp` options** are `{ dataDir?: string; motisFetch?: FetchLike }` from Task 4 onward so Task 10 can inject the MOTIS transport without changing Task 4's signature.
8. **`generate_trips` returns both directions**; expected count is pinned after implementing the documented peak/off-peak windows (the plan's `272` is a placeholder — never ship it unchallenged).
9. **Plan placeholders**: any value marked `needs_verification`/placeholder must be either verified against its cited source or explicitly flagged in code and ledger — never silently accepted.
10. **Golden-route minima** may be adjusted only with a written data reason (e.g. corridor genuinely absent from OSM), recorded in the ledger and runbook.

## Execution protocol

- Method: **subagent-driven development** (superpowers). Fresh implementer per task, task reviewer after each, final whole-branch review at the end.
- Ledger: `.superpowers/sdd/2026-11-01-biyahey-data-spine/progress.md` (git-ignored). It is the recovery map: trust it and `git log` over memory after compaction.
- Per task: record `BASE`, generate the task brief, dispatch a fresh implementer with the brief path (never the whole plan), then review via a review-package diff file.
- Reviews are task-scoped; only Critical/Important or spec failures enter the fix loop (max 5 rounds).
- Commit style: Conventional Commits; branch `feature/data-spine`; PRs disclose AI assistance.
- Do not stop between tasks for check-ins. Stop only for irreversible actions, security-sensitive actions, out-of-scope side effects, or a plan that leaves every path a guess.

## Task order

Plan 1 (current): Tasks 1–11, in order. Plan 2 starts only after Plan 1's phase-1 acceptance passes.
Plan 2: Tasks 1–11, in order. Later phases (3–6 in the spec) get their own plans after phase 2.

The Plan-1 gate is **PARTIAL only because the remaining criteria are owned by Plan 2**
(web service, About-data screen, PWA installability) and are reported DEFERRED, not
failed; Plan 2 may proceed. Do not describe Plan 1 as "phase-1 fully accepted".

## Current status

- Planning complete: research (3 reports), spec (approved), two implementation plans (committed).
- Plan 1 (data spine + router, Tasks 1–11): **complete and reviewed clean**. Final whole-branch
  review 2026-11-01: Ready to merge with fixes; no Critical. **Final fix wave applied** (11
  Important items): CORS for the PWA origin, `api` compose service + root `npm run dev` /
  `npm run data:build`, plan cap 3–5, browser-safe `joinAttributions`, `/search` `near`
  distance, `informalTransfer`, unsupported ferry/rail exclusion (feed 494 → 489 routes),
  LRT-2 R47 known-gap, stale-fare wiring + `check:fares`, repo docs, P2P R48 deferral.
- Phase-1 acceptance re-run **2026-11-01 (final fix wave)**: 5 PASS, 2 PARTIAL (criterion 1's
  web service and criterion 5's About-data screen are Plan 2), 1 DEFERRED (criterion 6 /
  PWA, ruling R38), 0 FAIL. `npm run verify:phase1` exits 0. Re-run with
  `npm run verify:phase1`.
- Evidence: `docs/runbooks/phase1-acceptance.md` (criteria table, golden counts capped at 5,
  coverage 12/16 = 75.0 %, CORS/local-first §9, known gaps §8), `docs/runbooks/data-build.md`
  (measured durations, mode-gate exclusions, validator attempt), task report
  `.superpowers/sdd/2026-11-01-biyahey-data-spine/task-11-report.md` (append-only),
  `.superpowers/sdd/2026-11-01-biyahey-data-spine/final-fix-report.md`.
- **Known gaps before public beta (recorded, not hidden):** `gtfs-validator` did not run
  locally (host JVM resource-loading failure; `.github/workflows/data.yml` added, ruling
  R46); LRT-2 band provisional (R47); **P2P formally deferred** from v1 (R48 — engine code
  kept, `/plan` never emits it, no machine-readable P2P route fare exists); PNR/non-PRFS
  ferries excluded from the feed; 62 implausible itineraries dropped across the golden set
  (R10 feed shapes); coverage 12/16.
- **Plan 2 (PWA MVP) COMPLETE (2026-11-02)** on branch `feature/pwa-mvp` (created from
  Plan-1 head `6fc2b99`; the session's goal forbade merging, so it stayed on the branch
  until the human asked for the local `main` merge on 2026-11-02; 35 commits). Ledger: `.superpowers/sdd/2026-11-01-biyahey-pwa-mvp/progress.md` (rulings
  R39–R88); task reports and review files live in the same directory. The stack is
  runnable: `npm run dev` brings up `routing` + `api` (MOTIS has imported the published
  489-route feed); the PWA runs on `:5173` (CORS-allowed) via
  `npm run dev --workspace @biyahey/web`. Run `npm run data:build` before the first
  `npm run dev` on a fresh checkout.
- **Phase-2 acceptance (2026-11-02): `npm run verify:phase2` exits 0 with verdict
  PARTIAL.** Spec §3 criteria 2–6: **5/5 PASS, 0 FAIL**; recorded checks: 5 pass,
  1 partial (`perf`), 1 skipped (`phase1`, re-runnable with `--with-phase1`), 0 fail.
  Evidence: unit **380 passed / 4 skipped**; paint-only first payload **104.4 KB gzip
  ≤ 250 KB**; Playwright E2E **4 passed** (dev trip flow + preview offline/manifest +
  MapLibre worker guard); PWA installable/offline browser-verified; Lighthouse 5-run
  medians LCP ~2.0 s (recorded-run pass, locally variable), **TBT ~3.9 s FAIL**,
  **TTI ~7.6 s (interactive-map ≤3 s NOT MET)**, transfer ~796 KB PASS, perf score 63.
  Runbooks: `docs/runbooks/phase2-acceptance.md`, `docs/runbooks/local-dev.md`; real
  screenshots in `docs/screenshots/`; `README.md`/`CONTRIBUTING.md` updated.
- **Plan-2 known gaps before public beta (recorded, never green):** performance PARTIAL —
  TBT fails its 2500 ms ceiling (Lighthouse "good" 600 ms unmet), interactive map ≤3 s
  NOT MET, ≤40 tiles/viewport measured (4) but unenforced, `saveData` raster fallback not
  implemented, LCP pass is recorded-run-only; CI `perf` job is authoritative and expected
  red on TBT until the map-cost decision (preload map chunk vs lighter/raster first paint
  vs re-scope) is taken. Other gaps: Home-peek recent-trip rows (spec screen 1) unowned;
  English-fallback toggle UI absent (spec §11 localisation; mechanism complete); mixed
  mandated sentences not split into `lang` spans (R81); R41 reduced-options note blocked
  on a Plan-1 contract field (R59); `.github/workflows/web.yml` unexecuted locally
  (Node 24 vs 22, ~80 min data-cache first run); Task 6/7/8 carry-overs (R64 MRT-3
  duplicate station rows, R65 back-nav plan refetch, R68 confidence field absent, R74
  placeholder icons, raw-localStorage retrofit, R78 24 px popover licence links, E2E
  lifted from live feed, "START → END" saved-row title); Plan-1 gaps unchanged
  (`gtfs-validator` R46, LRT-2 R47, P2P R48, coverage 12/16).
- **Final whole-branch review (2026-11-02):** every task was independently reviewed
  (fix rounds re-reviewed; no Critical/Important findings left open). The final
  whole-branch review of Task 11 + branch integrity reproduced `verify:phase2`
  (exit 0 / PARTIAL, §3 5/5) and returned **documentation-only** fixes: F1 (Important —
  `phase2-acceptance.md` §6 quoted superseded run-1 Lighthouse numbers), F2 (broken
  criterion-3 table row), F3 (README known-gap refs §5→§6), plus non-blocking F4–F7.
  All fixed in **`5b9288c`** (docs only; no code/config/test changed); F4 (screenshot
  script's advisory port guard) and F5 (trip-live summary misses `effective_from`) are
  recorded as known-gap items 14–15. A scoped docs re-review returned **APPROVED — no
  open findings**. Final HEAD `5b9288c`; branch reviewed and ready for the human's
  merge decision (executed later — see "Local integration" below).
- **Post-Plan-2 trip planner (R89, 2026-11-02) — implemented on `feature/trip-planner`**
  (branched from the Plan-2 head `1d98bda`; merged to `main` locally as `aabe6ee` —
  see "Local integration" below). The human reported
  that allowing device location made every destination show *Walang ruta*, and
  asked for a configurable start/end with optional stops. Diagnosis on the live
  stack: routing works (Cubao→Ayala returns 3–5 options), but `/plan` took the
  device fix as the origin with no override, so a start outside the feed's
  coverage (or in a coverage hole such as Fairview, Valenzuela, Las Piñas,
  Antipolo) returned zero itineraries. Human approved **Option A** — `/search`
  becomes a Google-Maps-style directions form.
  - `/search`: explicit From + To, up to two optional transit stops, swap, a
    one-tap device-location shortcut (one bounded read, never automatic), and the
    same debounced/cancelled/cached typeahead with its honest offline, partial,
    error and no-results states. Stop pickers filter to the Stops group because
    the router's `via` accepts stop IDs only.
  - URL contract (`apps/web/src/features/search/tripParams.ts`):
    `/plan?from=lat,lon&fromName=label&dest=lat,lon&name=label[&via=<encodeURIComponent(JSON [{lat,lon,stopId,name}]))>]`;
    `/search` accepts the same params to prefill the form for edit/deep links.
  - `POST /plan` gains additive optional `stops: [{lat,lon,stopId}]` (zod, max 2,
    trimmed ids); the BFF forwards the ids as MOTIS `via` on every fan-out
    attempt. Stopless requests are byte-identical to v1. Legacy `/plan?dest=…`
    links still perform the one bounded device-geolocation read; a link with an
    unreadable `from` reports it instead of guessing.
  - Zero-itinerary state now names the planned trip and offers
    "Palitan ang starting point" (prefilled form), as the announced live region.
  - **Bug found and fixed during browser verification:** the shared typeahead
    kept the previous field's debounced results for the 250 ms debounce window,
    so choosing To and then typing From could pick To's stop into From and submit
    origin === destination. `useSearch` now takes a `resetToken` and clears the
    debounced query during render; a regression test pins it.
  - Verified: lint/typecheck/unit green; paint-only entry payload **105.0 KB
    gzip** ≤ 250 KB; live API via checks (1 stop → 5 options on the MRT-3
    corridor; 2 stops → 3 options; 3 stops → 400 `INVALID_BODY`); Playwright plans
    Guadalupe → Ortigas → Cubao end-to-end against the live stack and the
    preview offline/service-worker project passes.
  - Known limits: optional stops must be served stops (MOTIS stop IDs only) and
    the cap is two (router limit). Existing feed coverage gaps still produce an
    empty set for uncovered corridors — the UI now explains and recovers.
- **Local integration (2026-11-02): `main` merged.** The human asked to merge the work
  into `main`. `main`'s tip was `c2bc41f` (approved spec/research/plans only) and the
  implementation chain is linear (`c2bc41f` → data spine → PWA → trip planner), so the
  merge is a single `--no-ff` commit **`aabe6ee`** (`merge: bring feature/trip-planner
  into main`) carrying 239 files / +53,895 lines. `git diff feature/trip-planner main`
  is empty: `main`'s tree is exactly the verified branch tip (lint/typecheck clean, 417
  unit tests passed, 105.0 KB gzip entry payload, 4/4 Playwright E2E, 4/4 integration
  tests, live MOTIS via checks). The repository has **no remote configured**, so nothing
  is pushed; `feature/data-spine`, `feature/pwa-mvp` and `feature/trip-planner` are
  retained as fully-merged pointers.
- **Next phase (not started):** Phase 3 curation & coverage (route-inventory merge
  workflow, fare-update runbook, staleness CI, community report flow) and the public-beta
  decisions above; the branch is ready for merge/review when the human decides (nothing
  was pushed or merged in this session).
- **Plan-2 contract addendum (R61, 2026-11-02):** MOTIS `leg.intermediateStops` is present
  (verified live: 8 stops on MRT-3 Cubao→Buendia) but the shared `LegDto` exposed no stops,
  so the trip-detail stop list (spec §11 screen 4) was impossible. Task 6 adds an **optional**
  `LegDto.stops` mapped by the BFF — additive and backward compatible, applied on
  `feature/pwa-mvp` only; the Plan-1 branch and its recorded acceptance are unchanged.
- **Durable-state hazard (fixed 2026-11-02):** both SDD `progress.md` ledgers had been
  appended with cp1252-encoded em/en dashes (bytes `0x97`/`0x96` inside UTF-8 files), which
  made them unreadable to UTF-8 readers. Both were byte-repaired (lone cp1252 bytes re-encoded
  to UTF-8) and the whole repo (1171 text files) now scans clean. Append to ledgers/reports
  with UTF-8 tooling only — never `Add-Content`/default-encoding appends.
- **Post-Plan-2 bug fixes (2026-11-02, human-reported; working tree on `main`): route shape on
  the map + Recommended ranking.** Two defects the human reported after using the app:
  - **The map drew a straight chord between itinerary endpoints instead of the route.** The v1
    `LegDto` deliberately carried no geometry, so `RoutePolylines` joined each leg's
    `from` → `to`. MOTIS already sends `legGeometry` (Google-encoded polyline, precision **6**
    on the pinned build) and the BFF decoded it only to measure distance. Fixed additively:
    optional `LegDto.geometry { points, precision }`, one shared browser-safe `decodePolyline`
    (moved from the API into `@biyahey/shared`), the PWA decodes each leg (lat/lon → GeoJSON
    lon/lat), joins legs in travel order with a straight `from → to` fallback for old/cached
    geometry-less payloads, and fits the camera to the plan bounds. **Browser-only defect
    found by live verification (jsdom could not see it):** MapLibre v6 `isStyleLoaded()` is
    false while the style is dirty or tiles load — including immediately after the component's
    own `addSource`/`addLayer` — so the camera-fit and selection-emphasis effects silently
    skipped in Chromium while the mock passed. They now gate only on the `MapContext`
    style-ready contract, and the MapLibre mock models style dirtiness so the regression stays
    covered. The fit passes only the 48 px margin: MapLibre already subtracts the map's own
    sheet padding (`setPadding`), and passing it twice made `cameraForBounds` refuse the fit.
  - **Recommended contradicted the other chips.** `rankItineraries('recommended')` sorted only
    by ETA, so the fastest option always led and wore `BEST` even when Cheapest / Fewest
    transfers / Less walking all led another option. Recommended now ranks by a pure consensus:
    (1) number of the four chip criteria won, (2) sum of per-criterion competition ranks,
    (3) duration → fare → transfers → walk, then stable API order; the less-walking lead badge
    is now `LEAST WALKING` so `BEST` labels only the Recommended lead. Regression tests pin the
    reported 3-option case and the live Cubao → Manila 5-option case where a pure rank-sum
    would lead a different option.
  - Verified 2026-11-02: `npm run lint` / `npm run typecheck` green; full
    `npm test` **428 passed / 4 skipped** (36 files); `npm run test:e2e` **4/4 passed** (dev
    live flow + preview offline/manifest); live `/plan` serves geometry on every leg
    (~14–18 KB per response for 3–4 itineraries); Playwright against the dev stack shows the
    decoded road shape, the fitted camera, no console errors, and the badge/ordering flow.
    `docs/screenshots/route-options.png` regenerated with `node apps/web/scripts/screenshots.mjs`
    (other screenshots left at their previous capture to avoid live-data churn). Committed on
    `fix/map-route-and-recommended` and merged to local `main`; the API image was rebuilt
    (`docker compose build api && docker compose up -d api`) so the local stack serves the new
    field.
- **UX v2 "Kalsada" (2026-11-03) — implemented and verified on `feature/ux-v2`,
  merged to local `main` as a `--no-ff` merge.** The human asked to take the UX
  to production standard with Moovit-style route-path visualisation (approved
  identity: Option A "Kalsada"; spec
  `docs/superpowers/specs/2026-11-03-biyahey-ux-v2-design.md`, plan
  `docs/superpowers/plans/2026-11-03-biyahey-ux-v2.md`; approved visual
  `.superpowers/mockups/option-a-kalsada.html`). Delivered:
  - Kalsada tokens (teal `#0E7C7B` brand, ink navy, pale sage canvas, fare
    amber; light + dark) and a shared transit vocabulary
    (`components/transit/modeMeta.tsx`, `LegStrip.tsx`, `lib/format.ts`,
    `lib/itinerary.ts`; `RoutePolylines` retired).
  - `components/map/RoutePathLayer.tsx`: selected itinerary drawn leg-by-leg in
    mode colours over a white casing (dashed walk legs, transfer dots,
    origin/destination pins), every alternative as its own faded path with a
    numbered marker (duplicate fan-out geometries drawn once), card↔map
    selection, leg focus with dim/zoom, camera fit honouring reduced motion,
    DEV-only `window.__biyaheyMap` for Playwright.
  - Route options rebuilt (Kalsada header, ink filter pills, one
    `route-detail-action` under the selected card, leg-strip cards, "5 ruta ·
    pinakamabilis 37 min" now derives the real minimum); trip detail has a
    sticky 42 dvh map header with map↔timeline leg sync (row / leg strip /
    map line), "Buong ruta" reset, restyled fare card; `/trip/:id/live` is a
    leg-by-leg walkthrough (whole-route map context + active leg, honest
    no-live-data banner); Home shows up to three recent trips with leg strips
    and the fare's effectivity/snapshot dates; directions form, saved list and
    About-data restyled. Clock times are 12-hour Philippine time.
  - Independent correctness review (`review-correctness.md`) found 1 Critical
    (Home fare without `effective_from`) + 4 Important (live screen
    mislabelling a fresh plan as a saved snapshot; leg strip inside a `<button>`
    losing list semantics; "pinakamabilis" using the ranked lead; map overlays
    rebuilt on every parent render) + 13 Minor. **All Critical/Important fixed**,
    most Minors fixed (transfer-dot paint, walk-leg focus dashes, dim opacity,
    stop-count wording, dead `RoutePolylines` removal, `data-map-ready` signal,
    reduced-motion / 15-leg / memo regression tests); accepted Minors: map
    numbered badges follow API order rather than the ranked sheet order, and a
    handful of new i18n keys remain unused. A live-E2E report also found and the
    Lead fixed a pointer-capture bug that made every button inside a saved row
    dead to touch/mouse (`SavedScreen.handlePointerDown` now ignores presses on
    interactive children).
  - **Gates (2026-11-03):** `npm run lint` / `npm run typecheck` green;
    `npm test` **514 passed / 4 skipped** (45 files); `npm run build` green;
    entry payload budget test PASS; `npm run test:e2e` **11 passed** (dev flow +
    map-rendering + ux-v2 + preview offline/service-worker); `node
    apps/web/scripts/screenshots.mjs` regenerated all 7 README screenshots
    (live-trip.png added) from the built app. Lighthouse was **not** re-run in
    this pass — the phase-2 performance verdict remains PARTIAL (TBT known to
    fail), not green-washed.
  - **Known limits:** Home recents opened from a coordinate-only plan show the
    API's synthetic `START → END` endpoint names (search-stop plans show the real
    stop names); the independent UX/a11y reviewer did not return a report, so
    that pass is the Lead's screenshot/source review + the axe suites and the
    Playwright browser checks; no new API/BFF/data behaviour was added.
