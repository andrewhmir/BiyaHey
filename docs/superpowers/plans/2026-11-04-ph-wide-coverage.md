# PH-Wide Coverage, Walk Bridging and Tricycle Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make origin→destination routing work anywhere in the Philippines — a real transit itinerary where the data supports one, a clearly-labelled walk estimate where it does not, and tricycle legs where and only where real tricycle data exists.

**Architecture:** One nationwide OSM extract feeds a nationwide GTFS feed (`pipelines/`), which one MOTIS graph serves (`services/routing/`). The BFF (`services/api/`) adds an app-level walk fallback only after the router exhausts real itineraries, and maps a new `trike-` route family to a `tricycle` leg. The PWA (`apps/web/`) renders walk-fallback and tricycle legs distinctly, and never presents either as a served transit route.

**Tech Stack:** Python 3.10 + pyosmium (data pipeline), MOTIS 2.11.4 / Docker (routing), Fastify + TypeScript (BFF), React + MapLibre PWA, Vitest + Playwright, PowerShell 5.1 on Windows.

**Spec:** `docs/superpowers/specs/2026-11-01-biyahey-design.md` (product contract, licensing §8.1, coverage criterion §3) plus the session prompt `docs/prompts/2026-11-04-ph-wide-coverage-prompt.md` (decisions D1–D7). The recon evidence is `docs/research/2026-11-04-ph-wide-coverage-recon.md`.

## Global Constraints

- **No invented data, ever.** Every route, stop, fare and geometry states a source. Tricycle routes/stops/schedules/fares may only come from a citable source (OSM ODbL, LGU LPTRP with URL, LTFRB matrix). A fabricated corridor or fare is a lie even when it looks helpful.
- **Licence rules do not relax:** no realtime claims, no PNR as available, no Google Maps Platform, no sakay/PTAC/BusMaps-derived feeds, no fare matrix from blog posts. `sakay-gtfs`, `ptac-2014`, `busmaps` must not appear as sources.
- **Walk fallback is last resort:** it may only be emitted when MOTIS returned zero usable itineraries after every attempt. It must never be presented as a transit route, and beyond 25 km the UI must say plainly that walking is not a realistic alternative while still showing the estimate.
- **Walk geometry follows roads when any walking path exists.** Straight-line geometry is permitted only when the walking graph has no path at all, and must be labelled approximate (dashed `route-approximate` styling, `data-approximate-legs`).
- **Contract discipline:** `/plan` stays `v: 1`. Every DTO change is additive and optional; old cached payloads and older clients must keep rendering. Removing or retyping an existing field is a defect.
- **Existing NCR reproducibility:** `npm run data:build` (no arguments) and `verify:phase1` / `verify:phase2` must keep meaning what their runbooks say. National artifacts go beside NCR ones; the pinned NCR feed sha256 `0dff35d264dd24a19ce93ac61c5f4b4972d243c4b66283a82b19c0ee073a5fdd` is changed only by a deliberate re-pin with the build report that justifies it.
- **Never commit** `data/build/**` (git-ignored) or any PBF/zip artifact. Never delete `data/build/philippines-latest.osm.pbf` (612 MB).
- **One MOTIS graph rebuild at a time.** No parallel `motis import`. Do not delete or rewrite the 612 MB national PBF.
- **Windows/PowerShell 5.1:** no bash dependency in product scripts; `Invoke-WebRequest -UseBasicParsing`; all file writes UTF-8 **without BOM** (never `Add-Content` for ledgers/reports).
- **Two writers share one checkout.** Write scope is advisory but binding: Lane A owns `pipelines/**`, `scripts/data-build.mjs`, `services/routing/**`, `data/fares/**`; Lane B owns `services/api/**`, `packages/shared/**`, `data/provenance/**`; Lane C owns `apps/web/**`. Only the Lead runs `git add`/`git commit`/`git checkout`. Do not edit `docs/**` in a task — docs are Lead-owned.
- **Root commands:** `pipelines\.venv\Scripts\python.exe -m pytest pipelines/tests -q`; `npm run lint`; `npm run typecheck`; `npm test`; `npm run test:e2e`; `npm run validate:data`; `npm run check:fares`; `npm run smoke:routing`.

## Review Focus

1. **Fallback leaks onto served trips.** A pair that has transit (e.g. Cubao→Ayala) must never return the walk fallback, and a fallback must never be counted as evidence of coverage.
2. **A fallback or tricycle leg reads as a served service.** No transit fare, no route short name/headsign, no "Look for:" signage, no transit-coloured line, no implied schedule on either.
3. **National ingestion silently loses regions.** A build that accepts relations but drops Malaya/Luzon/Visayas/Mindanao coverage (or invents headways) is worse than a small honest feed. Counters must explain every skip.
4. **The graph gets unusable.** D3 footpath settings can multiply transfer tables; an import over 45 min / 8 GB RSS or a `/plan` p50 that regresses past ~2 s must be recorded and reverted, not shipped silently.
5. **Old payloads and empty responses.** A cached v1 itinerary without `fallback`/`geometry`/`stops`, or a MOTIS 200 with `itineraries: []`, must render/handle without a crash.

---

### Task 1: Region-aware data build and national OSM artifact

**Files:**
- Modify: `pipelines/pipeline/osm.py` (region presets, no-clip national path)
- Modify: `pipelines/pipeline/cli.py` (`osm` stage `--region`)
- Modify: `scripts/data-build.mjs` (`--region ncr|ph`, national output paths)
- Create: `services/routing/config/config.ph.yml`
- Modify: `services/routing/Dockerfile`, `docker-compose.yml` (config selection via `MOTIS_CONFIG`)
- Test: `pipelines/tests/test_osm.py`, `pipelines/tests/test_cli.py`

**Interfaces:**
- Produces: `resolve_region(region: str) -> tuple[str, BBox | None]` returning `(slug, bbox)`; `ph` returns `("ph", None)` meaning "use the downloaded national PBF, do not clip". `run_stage_osm(pbf, out_dir, taginfo_path, region="ncr")` writes `<out_dir>/osm/<slug>.osm.pbf`. `scripts/data-build.mjs` accepts `--region ph` and selects `data/build/osm/ph.osm.pbf` + `data/build/gtfs/ph` (NCR default remains `data/build/osm/ncr.osm.pbf` + `data/build/gtfs`).
- Consumes: existing `ncr_bbox()`, `extract_bbox()`, `bbox_text()`, `run_stage_osm()` and the `download`/`publish` stage CLIs.

- [ ] **Step 1: Write the failing tests** — `pytest pipelines/tests/test_osm.py -k region` must fail:
  - `resolve_region("ncr") == ("ncr", NCR_BBOX)`, `resolve_region("ph") == ("ph", None)`, `resolve_region("bbox:14.0,120.5,15.0,121.5")` returns the parsed tuple in `(min_lat, min_lon, max_lat, max_lon)` order, and an unknown region raises `ValueError` naming the accepted forms.
  - `run_stage_osm(..., region="ph")` on a fixture writes `osm/ph.osm.pbf` containing the input objects unchanged (no bbox filtering) and its coverage report records `"region": "ph"` and `"clip": false`.
  - A default call (`region` omitted) writes `osm/ncr.osm.pbf` exactly as before: assert the existing test expectations are untouched.
- [ ] **Step 2: Run the tests and confirm they fail for the missing API.**
- [ ] **Step 3: Implement** the region resolver and the no-clip path (copy the source PBF once when `ph`; skip if the destination already has the same size and mtime, so repeated `data:build` runs do not re-copy 612 MB). Add `--region` to the `osm` argparse subparser with `default="ncr"`; pass it through `data-build.mjs`.
- [ ] **Step 4: Create `services/routing/config/config.ph.yml`** as a copy of `config.yml` with `osm: /data/osm/ph.osm.pbf`, GTFS `path: /data/gtfs/ph/gtfs.zip`, and the same `server.port: 8080`; update `services/routing/Dockerfile` to copy the whole `config/` directory and `docker-compose.yml` to set `MOTIS_CONFIG: ${BIYAHEY_ROUTING_CONFIG:-/etc/motis/config.yml}` on `routing`. Do **not** change the default config's values in this task (Task 4 owns D3).
- [ ] **Step 5: Run the tests and post-fix checks:** `pipelines\.venv\Scripts\python.exe -m pytest pipelines/tests -q` (all green) and `npm run lint` (green). Record wall-clock of the national OSM stage in the report.
- [ ] **Step 6: Commit** — Lead commits with `feat(data): make the OSM build region-aware with a national artifact` (implementer does not run git; single-committer rule).

**Acceptance:** `python -m pipeline.cli osm --region ph --pbf data/build/philippines-latest.osm.pbf --out data/build` creates `data/build/osm/ph.osm.pbf` and a coverage report naming region `ph`; the NCR command path is unchanged and its tests still pass.

---

### Task 2: National-scale OSM route ingestion

**Files:**
- Modify: `pipelines/pipeline/osm_routes.py` (deterministic route-id collisions, globally deduped OSM stops, national counters)
- Modify: `pipelines/pipeline/gtfs.py` (only if stop identity needs the shared stop id; keep headway constants untouched)
- Test: `pipelines/tests/test_osm_routes.py`

**Interfaces:**
- Consumes: `iter_route_relations(path: Path) -> Iterator[RouteRelation]`, `RouteRelation(osm_id, osm_route, skipped_members, ...)`, `ROUTE_TYPE_BY_OSM_ROUTE`.
- Produces: route ids remain `<family>-<slug>` where family ∈ {rail, bus, jeep, uv, ferry}; when two relations would collide, the first (lowest OSM id in file order) keeps the bare slug and later ones get `<slug>-osm<osm_id>`. Served stop ids become globally stable across routes: `node:<osm_id>`, `way:<osm_id>` (route-scoped stop ids remain only for synthesized landmark stops). `RouteRelation` gains a `skipped_members` breakdown the build report can aggregate.

- [ ] **Step 1: Write the failing tests** (fixture-based, no network):
  - Two relations with the same `ref` produce `bus-x` and `bus-x-osm<id>` deterministically, and re-running the reader yields the same ids.
  - Two relations sharing a member stop node produce **one** stop row in the built feed, referenced by both trips; assert `stops.txt` has one row for that OSM node and `stop_times.txt` references it from both routes.
  - A relation with no stop members still gets two synthesized landmark stops, and those remain route-scoped (two routes synthesizing the same name do not share a stop).
  - A relation whose stop members are dangling still yields a route and increments `skipped_members` (existing behaviour preserved).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** collision disambiguation, global stop identity and the counters. Keep the reader's three streaming passes and streaming memory profile; do not load relation objects for the whole country into memory beyond the candidate list (the existing candidate list is acceptable; record its size in the report).
- [ ] **Step 4: Measure the national ingestion** — run the OSM→GTFS build over `data/build/osm/ph.osm.pbf` once (this is the expensive measurement; ensure no other heavy job is running) and record: wall-clock, candidate relation count, accepted routes, skipped reasons, stops, trips, stop_times, shapes, output zip size. This step and Task 3's measurement may be the same build; record both in the report.
- [ ] **Step 5: Run** `pipelines\.venv\Scripts\python.exe -m pytest pipelines/tests -q` and record the count.
- [ ] **Step 6: Commit** — Lead commits `feat(data): ingest OSM routes nationwide with stable stop identity`.

**Acceptance:** national build completes in one pass with every skipped relation accounted for by a counter, route ids unique, and no new failure in the existing 153-test pipeline suite.

---

### Task 3: National GTFS publish, regional coverage artifact, provenance

**Files:**
- Create: `pipelines/pipeline/regions.py` (documented approximate region boxes + assignment)
- Modify: `pipelines/pipeline/publish.py` (regional coverage artifact, national manifest)
- Modify: `pipelines/pipeline/cli.py` (only if publish needs a region label)
- Modify: `data/provenance/sources.yaml` (only if recon found a new source; otherwise no change)
- Test: `pipelines/tests/test_regions.py`, `pipelines/tests/test_publish.py`

**Interfaces:**
- Produces: `REGION_ROLLUPS` = the 16 administrative regions + `Luzon`/`Visayas`/`Mindanao`; `region_for_point(lat, lon) -> str` (returns `"unassigned"` outside every box, never raises); `regional_counts(feed) -> dict` with `{region: {routes, stops, trips}}` and the same roll-up. Publish writes `coverage-regional.json` beside the feed (and `manifest.json` unchanged in shape). `compute_coverage()` (curated inventory vs feed) stays as-is and its output is embedded under `curated` in the regional artifact.
- Consumes: existing `run_stage_publish`, `compute_coverage`, `read_feed_route_ids`, `build_gtfs_fare_tables`, licence gate.

- [ ] **Step 1: Write the failing tests:**
  - `region_for_point(14.6760, 121.0437) == "NCR"`, `(16.4023, 120.5960) == "CAR"`, `(10.3157, 123.8854) == "Region VII"`, `(7.1907, 125.4553) == "Region XI"`, `(14.5995, 120.9842) == "NCR"`, an ocean point returns `"unassigned"`.
  - `regional_counts` on a small fixture feed assigns every stop to exactly one region, sums match the feed totals, and the island roll-up equals the sum of its regions.
  - Publish writes `coverage-regional.json` whose `curated` block equals `compute_coverage(inventory, feed)`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** `regions.py` with the boxes documented in `docs/research/2026-11-04-ph-wide-coverage-recon.md` (copy them verbatim, keep the honest `unassigned` bucket and a module docstring saying boxes are approximate), wire it into publish, keep long-distance ferry / PNR / P2P exclusions working nationally.
- [ ] **Step 4: Run the national publish over the Task-2 GTFS** and record: feed sha256, route/stop/trip/stop_time/shape counts, per-region counts, curated coverage (`modelled/total`), and the licence-gate result. Do not change the NCR pinned sha.
- [ ] **Step 5: Run all data gates:** `npm run validate:data`, `npm run check:fares`, `pipelines pytest`, and record exit codes.
- [ ] **Step 6: Commit** — Lead commits `feat(data): publish national feed with a per-region coverage report`.

**Acceptance:** `data/build/gtfs/ph/coverage-regional.json` exists with per-region and island roll-up counts plus the curated missing list; every data gate exits 0.

---

### Task 4: National MOTIS graph, footpath walk bridging, measured gate (Lead-owned)

**Files:**
- Modify: `services/routing/config/config.ph.yml` (D3 settings: `extend_missing_footpaths: true`, `max_footpath_length: 30`)
- Create: `docs/runbooks/data-build.md` national section (Lead-owned docs; see Task 11 for the full edit)
- No application code.

**Interfaces:**
- Consumes: `data/build/osm/ph.osm.pbf`, `data/build/gtfs/ph/gtfs.zip`, `config.ph.yml`, the compose `MOTIS_CONFIG` override from Task 1.
- Produces: a measured D1 verdict (`national` vs `island-sharding`) recorded in the recon doc and runbook, and a running national graph whose raw `/api/v6/plan` returns itineraries for Cebu and Davao pairs.

- [ ] **Step 1: Import with limits and measure.** Rebuild the routing image (config only), run the import with `--memory=8g --memory-swap=8g` and `timeout --signal=KILL 2700`, sampling `docker stats` every ~5 s into a log. Record wall-clock, peak RSS, graph size, exit code.
- [ ] **Step 2: Decide the D1 gate.** Pass = ≤45 min AND ≤8 GB RSS AND the import exits 0. If it fails, fall back to island-group sharding (`Luzon`/`Visayas`/`Mindanao` extracts + three configs + BFF coordinate selection) and record the measurement that forced it. Record the ruling in the ledger either way.
- [ ] **Step 3: Footpath measurement.** Compare graph/transfer-table size and `/api/v6/plan` latency p50/p95 before (NCR + old settings) and after (national + D3 settings) on the same 6 probes. If p95 regresses past ~2 s on covered corridors, reduce `max_footpath_length` (30 → 20 → 15) and re-measure; record the chosen value and why.
- [ ] **Step 4: Restart with the national config and verify** raw MOTIS plans for Cebu City→Lapu-Lapu and Davao City→Tagum return ≥1 itinerary when the feed carries those routes; if the feed has no route there, record that the answer is honest-empty and defer to the walk fallback.
- [ ] **Step 5: Commit** the config change (Lead) as `feat(routing): national MOTIS graph with walk-bridging footpaths` once the graph serves.

**Acceptance:** the national graph serves on :8080; the D1 measurement and footpath decision are recorded with the exact commands; the NCR config still builds (re-verified or explicitly recorded as untested-this-session).

---

### Task 5: Shared DTO additions and provenance row for the walk estimate

**Files:**
- Modify: `packages/shared/src/domain.ts` (`LegMode` + new additive fields)
- Modify: `data/provenance/sources.yaml` (`walk-estimate` row; schema only if required)
- Test: the repo's API test directory `services/api/test/` (contract/registry tests live there), plus any shared-package test file that pins the mode vocabulary

**Interfaces:**
- Produces (all additive and optional unless stated):
  - `LegMode` union gains `'tricycle'`.
  - `ItineraryDto.fallback?: 'walk'`.
  - `LegDto.approximate?: true` — geometry is a straight-line estimate, not a routed path.
  - `LegDto.fareNotPublished?: true` — a transit leg whose fare has no published source.
  - `ItineraryDto.fareIncomplete?: true` — the itinerary fare excludes at least one such leg.
  - `LegDto.tricycleHint?: { terminalName: string; distanceM: number }` — walk leg passes within 300 m of a mapped tricycle terminal.
- Consumes: `DataSource`, `SourceId`, `ProvenanceRegistry`, `assertKnownSources`.

- [ ] **Step 1: Write the failing tests** — the provenance registry loads with a `walk-estimate` row and `assertKnownSources(['walk-estimate'], registry)` accepts it; a hand-built `ItineraryDto` with `fallback: 'walk'`, `approximate`, `fareNotPublished`, `fareIncomplete`, `tricycleHint` and a `tricycle` leg type-checks and round-trips through `JSON.parse(JSON.stringify(...))` without loss.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** the DTO fields with doc comments that state each field's additive/optional discipline, and register `walk-estimate` honestly: read `data/provenance/schema/sources.schema.json` first; the row's attribution must say it is a BiyaHey!-computed walking estimate (haversine at 4.5 km/h) and its licence field must not claim a dataset licence it does not have — if the schema cannot express a derived method, extend the schema additively with a `kind: 'derived'` and document it.
- [ ] **Step 4: Run** `npm run typecheck`, the touched tests, and `npm run check:fares` (registry changes can break the licence gate).
- [ ] **Step 5: Commit** — Lead commits `feat(shared): add walk-fallback, tricycle and fare-gap contract fields`.

**Acceptance:** typecheck green; registry loads; no existing DTO field changed type or became required.

---

### Task 6: BFF walk fallback synthesis

**Files:**
- Create: `services/api/src/routing/walk-fallback.ts`
- Modify: `services/api/src/routing/motis-client.ts` (only if a road-following walk request needs a new client method)
- Modify: `services/api/src/routes/plan.ts` (emit fallback only after all attempts return nothing)
- Test: `services/api/test/walk-fallback.test.ts` (new), `services/api/test/plan.test.ts`

**Interfaces:**
- Produces:
  - `buildWalkFallback(input: { origin: PlanPlaceInput; destination: PlanPlaceInput; departAt: string; routedWalk?: MappedWalkGeometry }): ItineraryDto` — exactly one itinerary, `fallback: 'walk'`, one walk leg, `fare` = `walkOnlyFare()`, `sources` containing `'walk-estimate'` (+ `'osm'` when routed OSM geometry was used), `approximate: true` only on straight-line geometry.
  - `services/api/src/routes/plan.ts` response header `x-biyahey-fallback: walk` when a fallback is returned.
  - `routedWalk` is the geometry from a road-following walk request when one can be obtained; otherwise `undefined`.
- Consumes: `PlanRequest`, `ItineraryDto`, `walkOnlyFare()`, `haversineM()`, `decodePolyline()`, `legGeometry`/`direct` payload shapes, `MOTIS_CALLS_HEADER`.

- [ ] **Step 1: Use the verified walk-routing mechanism** (Lead finding F1, probed 2026-11-04): road-following walk geometry comes from `GET /api/v6/plan` with **`transitModes=` empty**, **`directModes=WALK`**, and **`maxDirectTime=<seconds>`**; the answer is in `direct[0]`, with `legs[0].legGeometry` (precision 6) and the real `duration`/`distance`. Size `maxDirectTime` from the haversine distance at 1.2 m/s × a 1.6 safety factor, with a floor of 3600 s and a ceiling that keeps one request bounded (e.g. ≤ 6 h of computed walk); never send a walk request when haversine already implies more than the ceiling — the straight-line branch is the honest answer there. `/api/v1/route` is a confirmed 404 on this pinned build; do not use it. Record the mechanism and the chosen ceiling in the report and as a code comment.
- [ ] **Step 2: Write the failing tests:**
  - Empty MOTIS payload (`{itineraries: [], direct: []}`) → exactly one itinerary with `fallback: 'walk'`, zero transit legs, `fare.amount === 0`, `sources` includes `walk-estimate`, `approximate` present, duration = ceil(haversine / 4.5 km/h), and the `x-biyahey-fallback` header equals `walk`.
  - A 300 m pair still returns the fallback (not empty) when the router returns nothing, with duration ≥1 min.
  - A >25 km pair still returns the fallback with the true distance stated (the warning is UI copy, not an API suppression).
  - When MOTIS returns road geometry for the walk, `leg.geometry` is present, `approximate` is absent, and `distanceM` matches the polyline length within 1 %.
  - When MOTIS returns ≥1 usable itinerary, no fallback is added (and the header is absent).
  - A MOTIS transport error with zero itineraries still surfaces the error (fallback does not paper over a 502).
- [ ] **Step 3: Run the tests and confirm they fail.**
- [ ] **Step 4: Implement** `walk-fallback.ts` and wire it into `plan.ts` after `collectItineraries` returns zero, before the empty response is built. Keep total `/plan` latency for a covered pair unchanged (the fallback path must not add MOTIS calls on the happy path).
- [ ] **Step 5: Run** the touched tests plus the full BFF suite, and typecheck.
- [ ] **Step 6: Commit** — Lead commits `feat(api): return a labelled road-following walk fallback when no transit exists`.

**Acceptance:** empty-router pairs return one labelled walk itinerary; covered pairs unchanged; unit tests pin both.

---

### Task 7: PWA rendering of the walk fallback

**Files:**
- Modify: `apps/web/src/components/transit/modeMeta.tsx` and the trip/timeline components that render itinerary leg strips and cards (Locate `RouteCard`, trip detail timeline, `RoutePathLayer.tsx` usage)
- Modify: `apps/web/src/i18n/strings.ts` (new keys, Tagalog + English fallback)
- Test: the owning component tests (`apps/web/src/**/*.test.tsx`)

**Interfaces:**
- Consumes: `ItineraryDto.fallback === 'walk'`, `LegDto.approximate`, existing `route-approximate` dashed styling and `data-approximate-legs` counter.
- Produces: UI copy and structure only; no API changes.

- [ ] **Step 1: Write the failing component tests:**
  - A fallback itinerary renders a `WALK ESTIMATE`/`PAGTATANTIYA NG LAKAD` badge, states the walking distance and duration, and renders **no** transit leg strip, fare chip, route short name or "Look for:" signage.
  - A fallback over 25 km renders the explicit warning sentence (assert the translated key, not a hard-coded English literal).
  - The fallback map path is drawn on the approximate source and increments `data-approximate-legs` when `approximate` is set; a routed walk geometry draws solid.
  - A cached old itinerary with no `fallback` field renders exactly as today (regression pin).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** the badge, the copy block (honest: no known transit route for this trip; this is a walking estimate and may not be a safe or realistic walk), the >25 km warning, and the approximate styling hook-up.
- [ ] **Step 4: Run** `npm test --workspace @biyahey/web` (or root `npm test`), `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** — Lead commits `feat(web): render the walk fallback honestly`.

**Acceptance:** component tests green; a browser check (dev server against the live BFF) shows the fallback card and map for a pair with no transit.

---

### Task 8: Tricycle ingestion, fare file and terminal artifact

**Files:**
- Modify: `pipelines/pipeline/osm_routes.py` (`route=tricycle`; tricycle-flavoured `share_taxi` heuristic; `trike-` family)
- Modify: `pipelines/pipeline/osm.py` or the publish stage (terminal point extraction to `tricycle-terminals.json`)
- Create: `data/fares/tricycle-fares.yaml`, `data/fares/schema/tricycle-fares.schema.json`
- Modify: `pipelines/pipeline/fares.py` (load/validate the tricycle file), `scripts/check-fares.mjs` if it enumerates fare files
- Test: `pipelines/tests/test_osm_routes.py`, `pipelines/tests/test_fares.py`

**Interfaces:**
- Produces: `trike-` route ids with GTFS `route_type 3`; `data/build/gtfs/ph/tricycle-terminals.json` (and the NCR build's `data/build/gtfs/tricycle-terminals.json`) as a list of `{osm_id, name, lat, lon, kind, region}`; a validated `data/fares/tricycle-fares.yaml` whose entries require `source_url` and `effective_from`.
- Consumes: `ROUTE_TYPE_BY_OSM_ROUTE`, `iter_route_relations`, publish-stage writers, the fares loader.

- [ ] **Step 1: Write the failing tests:**
  - A fixture `route=tricycle` relation becomes route id `trike-<slug>` with `route_type 3` and appears in the feed.
  - A `route=share_taxi` relation whose name/operator mentions tricycle/traysikel/trike becomes `trike-` (the existing UV Express heuristic keeps priority; a plain share_taxi stays `jeep-`/`uv-`).
  - Terminal extraction finds `amenity=tricycle_station|tricycle_stand|motorcycle_taxi` nodes and writes them with names and coords; absent terminals produce an empty list, not an error.
  - A tricycle fare entry without `source_url` fails schema validation; the committed file may be an empty list (and a test pins that empty is valid).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** the mode family, the terminal artifact and the fare file/loader. Seed the fare file **only** from a source the recon doc cites; if there is none, ship it empty with a comment that no published tricycle fare matrix was found. Never reuse the jeepney matrix.
- [ ] **Step 4: Rebuild the national feed** and record: trike route count (may be 0), terminal counts per region, feed sha256, and the negative/positive finding verbatim for Task 11's docs.
- [ ] **Step 5: Run** `pipelines pytest`, `npm run validate:data`, `npm run check:fares`.
- [ ] **Step 6: Commit** — Lead commits `feat(data): ingest OSM tricycles and mapped tricycle terminals`.

**Acceptance:** ingestion path is proven by tests with fixtures; real national trike route count and terminal counts recorded; fare file empty-or-sourced, never invented.

---

### Task 9: BFF tricycle legs, unpublished fares and terminal hints

**Files:**
- Modify: `services/api/src/routing/map-itinerary.ts` (`trike` route family, `tricycle` leg, `fareNotPublished`, `fareIncomplete`, hint attachment)
- Modify: `services/api/src/domain/curated-data.ts` (load the terminal artifact if present)
- Test: `services/api/tests/map-itinerary.test.ts`, `services/api/tests/plan.route.test.ts`

**Interfaces:**
- Consumes: `ROUTE_ID_PATTERN`, `FARE_MODE_BY_LEG`, `LegDto.fareNotPublished`, `ItineraryDto.fareIncomplete`, `LegDto.tricycleHint`, the published `tricycle-terminals.json`.
- Produces: `modeFromRouteId('gtfs_trike-abc') === 'tricycle'`; a tricycle leg with no published fare carries `fareNotPublished: true` and the itinerary `fareIncomplete: true` (sum excludes it, does not throw); a walk leg whose start/end is within 300 m of a mapped terminal carries `tricycleHint`.

- [ ] **Step 1: Write the failing tests:**
  - `trike-` ids map to `tricycle`; an unknown `trike-` fare mode does not crash mapping — the leg carries `fareNotPublished` and the itinerary `fareIncomplete`, with `fare.amount` equal to the sum of priced legs.
  - Terminal hint: fixture terminals file, a walk leg 120 m from a terminal gets `{terminalName, distanceM}`; 500 m does not; missing file → no hints and no error.
  - Regression: routes without `trike-` ids and old payloads map identically to today.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** in `map-itinerary.ts` + `curated-data.ts`. The hint must only annotate a walk leg — never synthesize a tricycle leg.
- [ ] **Step 4: Run** the full BFF suite + typecheck.
- [ ] **Step 5: Commit** — Lead commits `feat(api): map tricycle legs with honest fare gaps and terminal hints`.

**Acceptance:** if Task 8 found real routes, a live plan uses a `tricycle` leg and the previously-walked connector is recorded before/after; if not, the tests prove the path and the negative finding stands in docs.

---

### Task 10: PWA tricycle mode, fare-gap and terminal-hint UI

**Files:**
- Modify: `apps/web/src/components/transit/modeMeta.tsx` (colour, icon, label for `tricycle`)
- Modify: leg strip / card / timeline components, `apps/web/src/i18n/strings.ts`
- Test: the owning component tests

**Interfaces:**
- Consumes: `LegMode` `'tricycle'`, `fareNotPublished`, `fareIncomplete`, `tricycleHint`.
- Produces: UI only.

- [ ] **Step 1: Write failing tests:** a tricycle leg renders its own colour/icon/label; a leg with `fareNotPublished` renders the "Fare not published" copy instead of a peso amount; an itinerary with `fareIncomplete` labels the total as partial; a walk leg with `tricycleHint` renders the "tricycle likely here — not in the dataset" badge.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement** with the Kalsada vocabulary; colour must be distinguishable from jeep/bus and text must always accompany colour.
- [ ] **Step 4: Run** web tests, typecheck, lint, and `node apps/web/scripts/screenshots.mjs` if any README screenshot changes.
- [ ] **Step 5: Commit** — Lead commits `feat(web): show tricycle legs and honest fare gaps`.

**Acceptance:** component tests green; no invented fare or service wording anywhere in the tricycle UI.

---

### Task 11: Verification, probe matrix, performance record and docs

**Files:**
- Create: `scripts/probe-matrix.mjs` (committed matrix runner)
- Create: `docs/research/2026-11-04-ph-wide-coverage-recon.md` (Lead, from Phase 0)
- Modify: `docs/runbooks/data-build.md`, `docs/runbooks/local-dev.md`, `docs/runbooks/phase1-acceptance.md`/`phase2-acceptance.md` only where a pinned value changes
- Modify: `docs/superpowers/EXECUTION-HANDOFF.md` (new dated section), `README.md` status
- Modify: any doc/test/script that pins the old NCR feed sha256 (grep it deliberately)
- Test: the matrix script itself plus existing gates

**Interfaces:**
- Consumes: the running national stack and every artifact from Tasks 1–10.
- Produces: `scripts/probe-matrix.mjs` writes `data/build/probe-matrix-<date>.json` and prints a markdown table; exits non-zero unless every required pair returns ≥1 itinerary that is either transit-with-cited-sources or a labelled walk fallback.

- [ ] **Step 1: Run the full gate set** and capture exact output: `pipelines pytest`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run validate:data`, `npm run check:fares`, `npm run smoke:routing`, payload budget test, `npm run verify:phase1`, `npm run verify:phase2`.
- [ ] **Step 2: Run the probe matrix** — the 11 pairs from the session prompt's acceptance table (NCR short, NCR long/coverage hole, NCR→Bulacan, NCR→Cavite, NCR→Batangas, NCR→Baguio, Cebu→Lapu-Lapu, Iloilo→Oton, Davao→Tagum, a rural no-transit pair, one cross-island pair). For each: itineraries, fallback present, modes, duration, distance/fare, sources cited.
- [ ] **Step 3: Record performance honestly** — national import time/RSS, `/plan` p50/p95 before/after, payload bytes, footpath choice; state any regression rather than hiding it. The phase-2 Lighthouse verdict stays PARTIAL; do not re-badge it green.
- [ ] **Step 4: Write the docs** — national build recipe, recon doc with every measured number and the command that produced it, coverage artifact reference, handoff section (what shipped, what is still a gap, feed sha and counts), README status without green-washing.
- [ ] **Step 5: Re-pin the NCR sha only if the NCR feed intentionally changed**; otherwise leave it. If the national build changes a shared artifact, grep for the old value and update each site with the build report that justifies it.
- [ ] **Step 6: Commit** — Lead commits `docs: record PH-wide coverage, walk bridging and tricycle results`.

**Acceptance:** every row of the session prompt's §6 table has a recorded result and the command that produced it; no gate is red without being recorded red-and-known.

---

## Dependency order

- Task 1 → Task 2 → Task 3 → Task 4 (data → feed → graph; Task 4 is Lead-owned ops).
- Task 5 → Task 6 → Task 7 (fallback contract → API → UI).
- Task 8 depends on recon + Task 2 (same lane, after Task 3); Task 9 depends on 5 + 8; Task 10 depends on 5 + 9.
- Task 11 last.
- Parallelism: Lane A (1→2→3, then 8) ∥ Lane B (5→6) after Task 1 starts; Lane C (7) after 5; Lane C (10) after 9. Only one MOTIS rebuild at a time (Task 4).

## Write-scope lanes

| Lane | Owner | Paths |
|---|---|---|
| A | pipelines implementer | `pipelines/**`, `scripts/data-build.mjs`, `services/routing/**`, `data/fares/**` |
| B | api/shared implementer | `services/api/**`, `packages/shared/**`, `data/provenance/**` |
| C | web implementer | `apps/web/**` |
| Lead | Lead only | `docs/**`, `scripts/probe-matrix.mjs`, git commits, graph rebuilds, recon doc |

## Execution rulings (pre-flight)

- **R1 — Branch isolation, not worktrees.** One checkout on `feature/ph-wide-coverage`; only the Lead runs git (single committer) while writers work disjoint scopes. *Why:* worktrees would lose the shared `node_modules` and workspace symlinks; the project's 2026-11-01 ruling chose branch isolation. *Cost if wrong:* a contaminated commit that is cheap to amend before the final review.
- **R2 — National artifacts.** `data/build/osm/ph.osm.pbf` (copy of the downloaded national PBF), `data/build/gtfs/ph/` for the national feed; the NCR paths and pinned sha are untouched. *Why:* `verify:phase1/2` must keep meaning what their runbooks say.
- **R3 — Walk fallback geometry follows the walking graph whenever it exists** (human answer 2026-11-04); straight-line is a labelled last resort.
- **R4 — No tricycle fare is shown until a sourced fare exists** (human answer 2026-11-04); the DTO carries `fareNotPublished`.
- **R5 — All three island groups in this pass** (human answer 2026-11-04), with island sharding only if the measured D1 gate fails.

## Execution addendum (2026-11-04, after Phase 0 recon — supersedes conflicting task text above)

Recon evidence: `docs/research/2026-11-04-ph-wide-coverage-recon.md` (git-ignored artifacts under `data/build/recon/`).

- **R6 — National feed path (supersedes Task 1/3/4 text).** The national build root is `data/build/gtfs/ph/`; publish writes `<out>/gtfs/gtfs.zip`, `<out>/manifest.json`, `<out>/build-report.json`. So the national feed is **`data/build/gtfs/ph/gtfs/gtfs.zip`** and `config.ph.yml` must name `/data/gtfs/ph/gtfs/gtfs.zip`. Task 1 fix round corrects the config file; Task 3 adds `coverage-regional.json` to that root.
- **R11 (revised after recon R-A's full keyword pass) — Tricycles: no invented corridors, no invented fare; OSM-mapped e-trike corridors ARE ingestible.** `route=tricycle` has 2 relations nationally and neither has usable service evidence (one is a tourist excursion citing a blog; one has only an operator tag) — Task 8 counts and excludes them with that reason and never auto-ingests them. But OSM does carry **2 ingestible `route=share_taxi` relations for the NCR Wilson E-trike System**, and 10 Bulacan TODA routes mistagged `route=bus` named "Baliwag/Bustos Tricycle" (no stop nodes). Task 8 therefore: (a) classifies `share_taxi` relations whose name/ref/operator names an e-trike/tricycle/traysikel service as `trike-` routes — real mapped corridor + stops, OSM-sourced, with the **feed-wide documented synthesized headway** (the same approximation every OSM route already carries; the UI must never present it as realtime); (b) excludes `route=tricycle` and the mistagged Bulacan relations with documented reasons; (c) also ingests `trike-` routes from the new curated `data/routes/tricycle-routes.yaml` (every entry requires `source_url` + `effective_from`; empty in this pass); (d) ships `data/fares/tricycle-fares.yaml` empty — tricycle legs show "fare not published", never the jeepney matrix; (e) extracts the 3 mapped `amenity=tricycle_station` terminals (NCR 1, IV-A 2) inside a pass the pipeline already makes, for walk-leg hints. Task 9/10 keep the `tricycle` mode, fare-gap and terminal-hint UI. Evidence: recon §2.
- **R16 — Served stop identity is unchanged (supersedes Task 2's global-stop-dedupe text).** Stops keep their existing per-route namespaced ids so the NCR feed stays byte-identical and the pinned sha256 `0dff35d264dd24a19ce93ac61c5f4b4972d243c4b66283a82b19c0ee073a5fdd` still describes a real build. Task 2's scope is route-id collision determinism + skip accounting + scale validation. MOTIS already links stops within `link_stop_distance: 100`.
- **R12 — MOTIS graph storage must be a named volume, never a host bind mount.** Recon §4: a `C:`-backed bind mount fails with `resize error` (sparse/mmap files). Task 4 adds a `routing-data` named volume for `/var/lib/motis/data` in `docker-compose.yml` so the imported graph survives container recreation; the entrypoint's hash-keyed import keeps unchanged graphs at ~1.5 s.
- **R13 — Extra task: `Task 6B: Diagnose the NCR→Bulacan BFF-side zero`.** Baseline: Cubao→Meycauayan returns 0 itineraries from the BFF while raw MOTIS returns 20 (the plausibility guard dropped 22). The national graph does not automatically fix this, and the acceptance matrix requires NCR→Bulacan ≥1 itinerary. Scope: reproduce on the national graph; decide feed-defect vs guard-defect with evidence; fix at the layer the evidence names; never relax `MAX_TRANSIT_SPEED_KMH` to make a corrupt 200 km/h "bus" pass. Files: `services/api/src/routing/map-itinerary.ts` and/or `services/api/src/routes/plan.ts` and/or a Lane A pipeline shape fix (coordinate, one lane at a time). Tests: `services/api/test/map-itinerary.test.ts`, `services/api/test/plan.test.ts`.
- **R14 — Phase 0 recon doc is a deliverable** and is written: `docs/research/2026-11-04-ph-wide-coverage-recon.md`. The regional split in it is deferred to the national feed (`regions.py`, Task 3) because the Python node pass is too slow for a session (recon §3).
- **R28 — Tricycle curated route/fare files are deliberately deferred.** No LGU or other citable source for tricycle routes or fares exists in this pass (recon §2), so `data/routes/tricycle-routes.yaml`, `data/fares/tricycle-fares.yaml` + its schema, the `fares.py` loader and the `check:fares` wiring are **not** shipped: there is nothing to ingest or price, and inventing either would violate D5/D6. The ingestion path for this pass is the OSM-mapped e-trike classification; tricycle legs show "fare not published" by absence.
- **R30/R31/R32 — Route-id keeper rules** (implemented + verified): keeper = lowest-OSM-id **feed-ready** candidate (≥1 non-stop way member AND (stop members ≥2 OR 0)); reverse dedupe compares against **any kept relation of the same base slug**; nameless relations are ingested as `<family>-osm<id>` and counted; the reader's counters reach `build-report.json` under the additive `osm_ingest` key (`route_relations = unsupported_route + tricycle_relations_seen + excluded_mistagged + candidates`).
- **R34 — Mistagged tricycle TODA corridors are excluded, never published or priced.** 10 OSM `route=bus` relations named "Baliwag/Bustos Tricycle" are tricycle corridors mistagged as bus (no stop members, from/to present); with zero stop members they are "feed-ready" as landmark routes and every `bus-` id is priced by the city-bus matrix, so publishing them would present and price a tricycle corridor as a bus service. They are counted (`excluded_mistagged_tricycle_relations`) and excluded. `route=tricycle` detection is case-insensitive so `route=Tricycle` (§2's second relation) is counted and explained rather than falling into `unsupported_route_values`.
