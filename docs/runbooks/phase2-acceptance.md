# Phase-2 acceptance runbook

How to re-run the Plan 2 (PWA) acceptance check and what the 2026-11-02 run
measured. Phase 2 is the Option A PWA in `apps/web`: the map + bottom-sheet
container, search, fare-forward route options, trip detail, saved/offline trips
and the About-data provenance screen. It consumes the Phase-1 BFF and router
(`docs/runbooks/phase1-acceptance.md`).

**Verdict 2026-11-02 (final task, clean tree `a417900` + these docs): PARTIAL** —
all five spec §3 criteria this plan owns (2–6) pass; **0 fail**. The §11
performance budget is **PARTIAL with measured numbers and is never reported
green** (R87/R88): paint-only payload passes, but TBT fails, the interactive-map
TTI budget is not met, the ≤ 40 tiles/viewport budget is measured but not
enforced, and the `saveData` fallback is not implemented. `npm run verify:phase2`
therefore exits **0** with a `PARTIAL` acceptance line, matching Plan 1's
fail-closed convention (PARTIAL is reported, not hidden; only a recorded
`FAIL` exits non-zero).

This verdict is about the local Windows host. The authoritative performance gate
is the `perf` job in `.github/workflows/web.yml` on `ubuntu-latest`, which has not
been executed yet (see §6).

## 1. Prerequisites

1. **Local stack up and healthy** — do not let the harness start or restart it:

   ```powershell
   docker compose up -d --wait routing api
   ```

   The harness checks `GET http://localhost:8787/health` (the BFF) and
   `GET http://localhost:8080/api/v1/geocode?text=Cubao` (MOTIS). MOTIS 2.11.4
   has **no `/health` route** — `/health` returns 404 even on a healthy server —
   so the compose healthcheck's geocode query is the honest liveness probe. If
   either check fails the harness prints the exact `docker compose` command and
   exits 1 without starting anything.

2. **`data/build/` present** — `manifest.json`, `gtfs/gtfs.zip` and
   `build-report.json` (built once with `npm run data:build`, see
   `docs/runbooks/data-build.md`). The harness never builds data.

3. **Playwright Chromium installed** (`npx playwright install chromium`) —
   needed by E2E and by Lighthouse's `CHROME_PATH` resolution.

4. **Free ports**: **5173** (Vite preview for Lighthouse; also the BFF
   CORS-allowed origin) and **4173** (Playwright's preview project), plus
   **:8080** and **:8787** for the stack.

The run measured here took **5.9 minutes** end to end (unit 59.7 s, build
29.7 s, E2E 65.1 s, Lighthouse ~3.5 min including its own build). It is a
deliberately heavy check; do not run it while another browser/Lighthouse run is
pegging the CPU.

## 2. Run it

```powershell
cd C:\Users\Andrew\Desktop\BiyaHey!
npm run verify:phase2

# Optional: also re-run Plan 1's harness (slow; it runs pytest + npm run ci and
# brings routing/api up through compose, which is idempotent while they are up)
npm run verify:phase2 -- --with-phase1
```

`scripts/verify-phase2.mjs` runs, in order:

| # | Step | Command | Purpose |
|---|---|---|---|
| 1 | prerequisites | `/health` :8787 · `/api/v1/geocode?text=Cubao` :8080 · `data/build` | fail fast with the fixing command; never touches Docker |
| 2 | build | `npm run build --workspace @biyahey/web` | fresh `dist/` for the budget + preview; asserts `sw.js` + `manifest.webmanifest` |
| 3 | unit | `npm test` (root) | offline unit + a11y + bundle; `integration`-tagged live suites stay filtered by the root script |
| 4 | bundle | `npm test --workspace @biyahey/web -- bundle` | paint-only first-screen payload ≤ 250 KB gzip (R82) |
| 5 | E2E | `npm run test:e2e` | builds, then Playwright `dev` (live trip flow) + `preview` (offline/SW/worker) |
| 6 | perf | `npm run perf:web` | Lighthouse mobile, 4× CPU, 5-run median; **exit 1 on TBT is expected** |
| 7 | phase1 | `npm run verify:phase1` (only with `--with-phase1`) | re-verification of Plan-1 criteria 2–4/7/8 |

The build runs before `npm test` on purpose: the bundle suite in the root test
run refuses a `dist/` older than its sources (Task 10's stale-build guard), and
acceptance must measure the tree it ships.

Exit code is **0 only when no recorded check failed and no §3 criterion is
FAIL**. PARTIAL and SKIPPED are reported and still exit 0. The performance check
is recorded as **PARTIAL** whenever Lighthouse produced runs; it is **FAIL** only
when no measurement could be collected at all — host contention can never turn a
red performance line green.

## 3. Expected output

The run ends with:

```text
[PASS   ] prerequisites: GET http://localhost:8787/health → 200 {"status":"ok"}; GET http://localhost:8080/api/v1/geocode?text=Cubao → 200 (10 hits); data/build present (manifest, gtfs.zip, build-report.json)
[PASS   ] build: apps/web production build (tsc + Vite) + PWA shell (sw.js, manifest.webmanifest) in 29.7 s
[PASS   ] unit: 380 passed / 4 skipped (384) in 59.7 s; offline unit + a11y + bundle, no integration tag
[PASS   ] bundle: 104.4 KB gzip across 4 file(s), budget 250 KB (paint-only, R82)
[PASS   ] e2e: 4 passed / 0 failed in 34.4 s (dev flow + preview offline/worker); command 65.1 s wall
[PARTIAL] perf: 5 Lighthouse run(s): median LCP 2011 ms (≤3000 PASS on this run only — locally variable, not a stable pass), TBT 3924 ms (FAIL > 2500; Lighthouse "good" is 600 ms), TTI 7673 ms (NOT MET > 3000), transfer 795,655 B (PASS ≤1,000,000), perf score 63/100. perf:web exit 1 (1 = a strict assertion failed; not treated as an acceptance failure per R87). §11 bars recorded separately: interactive map ≤3 s NOT MET; ≤40 tiles/viewport measured 4, not enforced; saveData fallback not implemented.
[SKIPPED] phase1: Plan-1 criteria 2–4 were accepted on 2026-11-01 (docs/runbooks/phase1-acceptance.md); pass --with-phase1 to re-run that slow harness (it also runs npm run ci)

=========== §11 performance budgets recorded, never green (R87/R88) ===========
interactive map ≤ 3 s ................. NOT MET (median TTI 7673 ms)
≤ 40 map tiles per viewport .......... NOT ENFORCED (measured 4 vector tiles for the initial 390×844 Home viewport in Task 10; no assertion)
saveData → raster fallback ............ NOT IMPLEMENTED (feature decision, not waived)
paint-only first payload ≤ 250 KB ..... 104.4 KB gzip PASS
LCP ≤ 3 s ............................ PASS on the recorded run only; locally variable — the CI perf job is authoritative

================ phase-2 acceptance (spec §3 criteria 2–6) ================
2. [PASS] Grouped search results for any NCR query; p95 search ≤ 1.5 s
3. [PASS] Golden NCR trips get ≥ 3 itineraries with time, fare, transfers, walk; p95 plan ≤ 1.5 s
4. [PASS] Fare engine passes ≥ 25 golden fare cases
5. [PASS] Every itinerary carries sources[]; About-data lists every dataset; fares show effective_from
6. [PASS] PWA is installable; saved trips + fare matrix work offline with a staleness stamp
...
phase-2 acceptance: PARTIAL — §3 criteria: 5/5 pass, 0 partial, 0 fail; checks: 5/7 pass, 1 partial, 1 skipped, 0 fail (12 recorded rows, 10 pass overall)
recorded checks partial: perf
PARTIAL is the honest verdict: every §3 criterion passes, but the §11 performance budget is recorded as PARTIAL with measured numbers and may never print green.
```

The exact transcript of the 2026-11-02 run is summarised in §4–§5; the timings
and five-run metric arrays below are the recorded ones. A different machine will
move the timings and Lighthouse numbers; the statuses must not be "fixed" to
match this document.

## 4. Criteria table (spec §3, items 2–6)

| # | Criterion | Status | Proof | Recorded evidence |
|---|---|---|---|---|
| 2 | Search returns grouped results (Stops · Landmarks · Routes · Saved) for any NCR query; p95 search ≤ 1.5 s | **PASS** | `npm test` + `npm run test:e2e` (dev project); p95 from Plan-1 acceptance (`--with-phase1` re-runs it) | Live `/search` for "Cubao" rendered the Stops and Landmarks groups and the real `10 resulta` status; SearchScreen unit + axe tests cover the four groups and idle/offline/partial states (380 root tests green). Server-side p95 search was **30–39 ms** over six NCR queries on 2026-11-01 (limit 1,500 ms). |
| 3 | For 10 golden NCR trips the planner returns ≥ 3 itineraries with total time, fare, transfers and walk distance; p95 plan ≤ 1.5 s | **PASS** | `npm run test:e2e` + Plan-1 golden suite (`--with-phase1`); UI contract in the card tests | The live `/plan` rendered **3 options** in the screenshot capture run (E2E
tolerates 1–5) with a `₱23.69` fare, `43 min` ETA, `direct · 1.7 km lakad`, a
fare effectivity date and the map polyline for the selection. Plan-1 acceptance
measured **10/10 golden trips with 4–5 itineraries** and p95 plan **185–208 ms**
(limit 1,500 ms). |
| 4 | Fare engine passes ≥ 25 golden fare cases | **PASS** | `npm test` (root) | **45** cases in `packages/shared/src/fares.test.ts` ran green inside the 380-test offline suite: 2026-09-28 PUV matrix, 2026-03-23 LRT-2/MRT-3 50 % discount, LRT-1 exclusion, free-ride overrides, guards. Plan-1-owned; re-verified here without the live stack. |
| 5 | Every itinerary carries `sources[]`; About-data lists every dataset with publisher, licence and last-checked date; every fare shows `effective_from` | **PASS** | `npm test` + `npm run test:e2e` (dev) + live `/sources` | `/sources` served **10 datasets**; About data rendered the OSM and OSM-Wiki rows with publisher, `ODbL-1.0` / `CC-BY-SA-2.0`, `Huling tsek 2026-11-01` and "hindi naka-publish" confidence. The E2E flow asserted an `effective YYYY-MM-DD` date on every card, the trip's fare breakdown/source rows, and the OpenStreetMap row on `/sources`. Missing-source fallback is unit-tested. |
| 6 | PWA is installable; saved trips + fare matrix work offline with a staleness stamp | **PASS** | `npm run build --workspace @biyahey/web` + `npm run test:e2e` (preview project) | The built app links a manifest with `name`, `start_url: /`, `display: standalone` and 192/512 icons; `navigator.serviceWorker.ready` resolves, the reload is controlled, `context.setOffline(true)` then a reload of `/saved` renders the saved row, the `offline-badge`, "Saved route (no live data)" and "Fare may have changed since you saved this." — all asserted by Playwright against the production build. Build emits `sw.js` + `manifest.webmanifest`; Workbox rules are unit-tested (R72). |

## 5. Measured evidence

### 5.1 Build and bundle

`npm run build --workspace @biyahey/web`: **exit 0**, 29.7 s in the harness
(tsc + Vite 8.3.5/Rolldown), PWA v2.0.0 `generateSW`, **24 precache entries /
2068.64 KiB**, `dist/sw.js`, `dist/manifest.webmanifest`. Entry
`index-BOcBf7TQ.js` **294.71 kB raw / 92.68 kB gzip**; lazy
`MapCanvas-D2XQwJh1.js` **1,060.18 / 288.55 kB**; worker
`maplibre-gl-worker-CMkqA50c.mjs` 519.37 kB raw.

`npm test --workspace @biyahey/web -- bundle`: **exit 0**, **104.4 KB gzip
across 4 files** (index, lucide runtime, entry CSS, registerSW), budget
**250 KB** — **PASS**. This is the paint-only definition of R82: the entry's
recursive **static** import graph + its CSS + JS/CSS referenced by `index.html`,
with dynamic route/map chunks excluded and `MapCanvas` asserted out of the entry
graph.

The whole first screen is larger: **392.7 KiB gzip -9** map-inclusive
(104.4 + MapCanvas JS/CSS) plus **148.0 kB gzip** for the MapLibre worker asset
it fetches. Do not read the 104.4 KB as the full first-screen cost; the map chunk
is deliberately outside the enforced budget because MapLibre alone is 288.5 kB
gzip and the spec's 250 KB budget could not otherwise coexist with a live map.

### 5.2 Tests and E2E

- Root `npm test`: **exit 0**, 34 passed + 1 skipped files, **380 passed /
  4 skipped (384)**, 59.7 s. No `integration`-tagged suite ran (root
  `test` = `vitest run --tagsFilter=!integration`); the bundle suite was included
  and passed against the fresh build.
- `npm run test:e2e`: **exit 0**, **4 passed / 0 failed in 34.4 s** Playwright
  time; 65.1 s wall including the production build:
  - `[dev]` search → route options → trip detail → save → saved → sources
    (**8.1 s**)
  - `[dev]` home shows the search pill (**1.2 s**)
  - `[preview]` manifest + service worker + offline `/saved` reload (**2.0 s**)
  - `[preview]` emitted MapLibre worker served as JavaScript from the hashed
    `/assets/` URL, with content-type/body assertions (**3.4 s**)

### 5.3 Lighthouse (mobile simulate, 4× CPU, 5 runs, median)

`npm run perf:web` (**exit 1**, as expected on TBT). Medians are computed from
the five `apps/web/.lighthouseci` LHRs of this run.

| Metric | Five runs | Median | Assertion | Verdict |
|---|---|---|---|---|
| LCP | 3746, 1974, 5459, 2011, 1971 ms | **2011 ms** | error ≤ 3000 | **PASS on this run only** — locally variable (Task 10's recorded run 2014 ms, a review run 3776 ms FAIL); not a stable pass |
| TBT | 3924, 4117, 2979, 3900, 4073 ms | **3924 ms** | error ≤ 2500 | **FAIL** (> 2500; Lighthouse "good" is 600 ms and is not met — 2500 is a regression ceiling) |
| TTI | 7770, 7786, 7661, 7547, 7673 ms | **7673 ms** | warn ≤ 3000 | **NOT MET** (visible on every run as a warning, R87) |
| FCP | 2810, 1907, 4412, 1917, 1883 ms | **1917 ms** | — | — |
| Transfer | 795,655 / 795,477 / 541,823 / 795,674 / 795,672 B | **795,655 B** | error ≤ 1,000,000 | **PASS** |
| Perf score | — | **63/100** | — | — |

Lighthouse's own assertion summary for this run: TBT failure
`found 3923.5` (5 values 3923.5, 4073.13, 4116.51, 2978.5, 3900.07) and the TTI
warning `found 7672.93` (7769.99, 7672.93, 7785.94, 7661.28, 7546.72). LCP was
not an assertion failure on this run.

Why TBT/TTI are real, not host noise: the map chunk is 1,060 kB raw / 288.5 kB
gzip and the Task 10 measurement attributed a **2,765 ms long task starting at
4,858 ms** to `MapCanvas-*.js`; the five TBT values are tightly grouped
(2,979–4,117 ms) unlike the bimodal LCP. The map is a real 1 MB WebGL bundle
under a 4× CPU throttle; the budget does not disappear on a quiet host.

### 5.4 PWA, offline and provenance artefacts

- `dist/sw.js` + `dist/manifest.webmanifest` emitted; 24 precache entries
  (2068.64 KiB, includes the MapLibre worker after the `mjs` glob fix).
- The preview Playwright test is the browser-level installability/offline proof:
  manifest fields, `navigator.serviceWorker.ready`, controlled reload, offline
  `/saved` with `offline-badge`, saved snapshot labels and the staleness stamp.
  (Lighthouse 12.6 has no PWA category, so there is no Lighthouse "installable"
  score; the browser assertions are the evidence.)
- About data: **10 datasets**, each with publisher, SPDX licence, last-checked
  date, coverage and confidence; licence sheet opens with the full licence link
  and source URL; missing-source and malformed-row paths are unit-tested.
- Fare/provenance contract: every card and trip footer shows the API's fare, its
  `effective_from` date and a source label derived from `source_id` (R57 —
  mixed/`null` sources never say "LTFRB matrix"). No fare arithmetic exists in
  `apps/web`.

### 5.5 Plan-1 references used by criteria 2–3

These are copied from `docs/runbooks/phase1-acceptance.md` (2026-11-01 run) and
are re-verifiable with `npm run verify:phase2 -- --with-phase1`:

- p95 search **30–39 ms** over six NCR queries (limit 1,500 ms).
- 10/10 golden trips returning **4–5 itineraries** (≥ 3 required, ≤ 5 cap);
  p95 plan **185–208 ms** (limit 1,500 ms); 62 implausible itineraries dropped by
  the guard.
- `/sources` **10 datasets**; licence gate 4 datasets ODbL/CC BY-SA clean;
  coverage 12/16 = 75 %.

## 6. Known gaps and public-beta items (recorded, not hidden)

### Performance — PARTIAL, never green (R87/R88)

1. **Cold start → interactive map ≤ 3 s: NOT MET.** Median TTI **7,623 ms**
   (Task 10 recorded 7,523 ms; a review run 7,884 ms). The MapCanvas chunk is
   1,060 kB raw / 288.5 kB gzip and its main long task is ~2.8 s starting ~4.9 s.
   Candidate fixes are a preloaded map chunk (breaks the 250 KB paint-only
   budget), a lighter/raster first paint, or an explicit re-scope — an open
   phase-2 decision, not waived.
2. **TBT ≤ 2500 ms regression ceiling: FAIL** (median 3,960 ms). Lighthouse's
   "good" TBT of 600 ms is not met. The ceiling was deliberately not raised.
3. **≤ 40 map tiles per viewport: measured but NOT ENFORCED.** Task 10's probe at
   390×844, zoom 11, no pan saw **4 vector tiles** (plus 3 font ranges, 1 style,
   2 sprites). There is no assertion, no per-viewport cap, and pan/zoom/expanded
   sheet are uncovered. The `maxEntries: 40` in the Workbox rule is a cache-entry
   cap, not a viewport guarantee.
4. **`saveData` → raster fallback: NOT IMPLEMENTED.** Needs a degraded map mode
   (detect `navigator.connection.saveData` and swap to raster/low-detail or the
   no-map placeholder). Recorded as a feature decision.
5. **LCP ≤ 3 s is a recorded-run-only pass.** This run's median is 2,046 ms and
   Task 10's recorded run 2,014 ms, but individual runs here reached 3,842 ms
   and a review run's median was 3,776 ms (FAIL). LCP is the required basemap
   credit text in the eager `MapView` fallback (R85), so it measures attribution
   paint, not map readiness. The CI `perf` job is authoritative.
6. **The CI `perf` job is expected red on TBT** until the map cost decision
   above. `npm run perf:web` stays strict; acceptance records PARTIAL.

### UI / product gaps

7. **Home-peek recent rows are unowned (spec §11 screen 1).** The Home sheet has
   the search pill plus links to Saved and About data, but the "recent trips …
   in peek sheet" rows are not implemented by Tasks 8–11. Owner: phase-3 /
   public-beta Home work (Task 8's M8 carry).
8. **English fallback toggle UI absent (spec §11:189).** The `en` string set and
   locale provider are complete and tested, but there is no settings surface to
   switch. R75/R76 record this as a public-beta settings-surface gap, not a
   silently dropped feature.
9. **Mixed-sentence language tagging limitation (R81).** Three mandated mixed
   Taglish/English sentences remain single Taglish-primary text nodes; splitting
   them would change DOM shape and break exact-copy tests. English-only sentences
   carry `lang="en"`; established loanwords and API-origin strings are untagged.
10. **R41 reduced-options honesty note blocked on a contract field (R59).**
    `PlanResponse` carries no dropped/partial signal (the BFF exposes counts only
    as response headers and the client returns bodies), so the screen renders
    1–5 options and the empty state honestly but cannot say "the guard dropped
    some options". Owner: a Plan-1 contract change before public beta.
11. **Saved/Recent row titles can read "START → END".** The row label is derived
    from the stored itinerary's first/last leg endpoint names; MOTIS names the
    device origin `START` and a coordinate-only destination `END`, and the saved
    row has no destination-label field. This is visible in the README's Saved
    screenshot. Owner: carry the searched destination name into `/plan`/the saved
    snapshot (or reverse-geocode) in a later phase; the web app must not invent a
    name. Recorded from the Task 11 screenshot capture, not present in earlier
    task reports.

### CI and carry-over notes

12. **`.github/workflows/web.yml` is unexecuted locally.** No GitHub runner is
    available here. YAML is parsed and Prettier-clean, but the first PR run must
    watch: Node 24 locally vs 22 in `ci.yml`, npm 11 lockfile/`allow-scripts`
    warnings, `docker compose --wait-timeout 900` against routing's 600 s
    `start_period`, the data-cache first-run (~80 min pipeline build on a miss),
    Playwright Chromium install, and the perf job's TBT verdict.
13. **Task 6/7/8 carried notes worth public-beta attention:**
    - **R64** — the stop list exposes feed artifacts: an MRT-3 station appears as
      both a `node:` and a platform `way:` row and raw `Platform <id>` names
      appear. GTFS/curation work, not a mapper defect (Plan-3).
    - **R65** — browser back to `/plan` remounts and refetches `POST /plan`
      (`staleTime: 0`). Accepted; the forward flow still issues exactly one POST.
    - **R68** — dataset confidence shows "hindi naka-publish" because the
      provenance registry has no confidence field yet; honest, not a placeholder
      to fill client-side.
    - **R74** — install icons are generated placeholders (valid 192/512/maskable
      PNGs inside the safe zone); replace with designed brand assets before
      public beta if desired.
    - **searchCache/savedPlaces** still touch `localStorage` directly; new
      saved/recent data goes through `deviceStore`. Namespace retrofit is cleanup.
    - **R78** — MapCredit popover licence links are 24 px (WCAG 2.5.8 minimum),
      deliberately not 48 px; entry-point controls and LicenceSheet links are
      48 dp.
    - **E2E depends on live feed behaviour.** Buendia → Cubao currently returns
      several options; a feed change to zero makes the test fail honestly rather
      than seed a pinned dataset. If that brittleness matters in CI, seed a
      pinned dataset or add a contract fixture.
    - **Plan-1 data gaps still apply:** LRT-2 fare band provisional
      (`needs_verification: true`), PNR/non-PRFS ferries excluded, P2P deferred,
      bad OSM route shapes mitigated by the plausibility guard, coverage 12/16.
      See `docs/runbooks/phase1-acceptance.md` §8.

### What this harness does not prove

- Chrome's install prompt/`beforeinstallprompt` was not exercised; installability
  is proven through the served manifest + registered service worker + controlled
  reload, which are the observable requirements.
- The per-viewport tile budget is a one-off measured probe, not a test.
- Plan-1 p95 plan/search numbers are *referenced* unless `--with-phase1` is
  passed; the local E2E proves the UI renders live responses, not the 10-trip
  golden contract.
- ESLint is not part of this harness (CI's unit job runs `npm run lint`); the
  web build does run `tsc -b`, so the harness type-checks the app.
- Lighthouse numbers are local and host-sensitive; the CI `perf` job is the gate.

## 7. Windows / PowerShell notes

- This machine runs **Windows PowerShell 5.1** (`pwsh` is not installed) and
  Node **24.19.0**, npm **11.17.0**, Python **3.10.11**, Docker **29.0.1** /
  Compose **v2.40.3**.
- To keep a transcript when the console mangles colours, redirect through cmd:

  ```powershell
  cmd /d /s /c "npm run verify:phase2 > verify-phase2-run.log 2>&1"
  Get-Content verify-phase2-run.log -Tail 60
  ```

- The harness spawns `npm` through `cmd.exe` on Windows; that is expected, not a
  test failure. Do not run it from bash/WSL.
- If port **5173** is occupied by a dev server, the Lighthouse/preview step fails
  honestly. Stop the dev server first; Playwright's preview project uses 4173.
- Do not run Lighthouse while Docker Desktop is indexing/another browser is
  busy. The five-run median absorbs noise; the verdict remains PARTIAL either
  way.
- `data/build` is gitignored; a fresh clone must run `npm run data:build` before
  acceptance. The harness only checks presence, not feed freshness.

## 8. Re-run and iterate

```powershell
npm run verify:phase2
npm run verify:phase2 -- --with-phase1      # slow; also runs npm run ci + pytest
```

If a check fails, fix the app/test and re-run. Do **not** relax an assertion,
raise a budget or delete a test to reach exit 0: a red performance line is the
recorded state until the map budget is addressed, and the runbook/README must be
updated with new measured numbers rather than the old ones. The only expected
non-zero command inside the harness is `npm run perf:web` (exit 1 on TBT); the
harness translates that into `PARTIAL` only when it can read five Lighthouse
runs, and into `FAIL` when it cannot measure at all.

## 9. Related documents

- [`local-dev.md`](local-dev.md) — run the whole stack, every command and
  troubleshooting.
- [`phase1-acceptance.md`](phase1-acceptance.md) — data spine, router, BFF
  (criteria 1, 4, 7, 8 and the API halves of 2/3/5).
- [`data-build.md`](data-build.md) — build the feed and every generated artefact.
- `docs/superpowers/specs/2026-11-01-biyahey-design.md` §3 (success criteria),
  §11 (UX/a11y/performance/localisation) and §13 (testing).
