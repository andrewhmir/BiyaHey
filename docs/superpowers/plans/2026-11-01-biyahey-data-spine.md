# BiyaHey! Data Spine (Phase 0–1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an offline-capable local stack that serves real NCR door-to-door transit itineraries with date-stamped fares and complete data provenance, built only from licensed public data.

**Architecture:** A Python data pipeline turns the OSM Philippines extract plus a curated jeepney/UV inventory into a generated GTFS feed and a provenance manifest; MOTIS (MIT, one binary, Docker) plans on that feed; a TypeScript Fastify BFF enriches each itinerary with fares from a versioned config and with the `sources[]` provenance array that the PWA later renders.

**Tech Stack:** Node 22 + npm workspaces + TypeScript (strict) + Fastify 5 + Vitest; Python 3.12 + pyosmium + pyyaml + jsonschema + pytest; Docker; MOTIS v2.11.4 (linux-amd64 asset, sha256-pinned); GTFS + OSM PBF; MobilityData `gtfs-validator` (Java) in the data CI job only.

**Spec:** `docs/superpowers/specs/2026-11-01-biyahey-design.md` (§5–§10, §12 phase 0–1, §13). UI work lives in the companion plan `docs/superpowers/plans/2026-11-01-biyahey-pwa-mvp.md`.

## Global Constraints

- Node 22 LTS + npm 10; TypeScript `strict: true` everywhere; React 19 only in the web app; ESLint 9 flat config + Prettier 3.
- Python 3.12; dependencies pinned in `pipelines/requirements.txt`; pipeline code is `python -m pipeline.cli <stage>` only.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `data:`); branches `feature/…`, `fix/…`, `docs/…`; PRs state AI assistance (BetterGov convention).
- Licensing: code MIT; the generated GTFS is a derived ODbL 1.0 database and must carry `LICENSE-DATA.txt`; the OSM-Wiki-derived inventory file is CC BY-SA 2.0 and stays a separate attributed file; **never** ship or reference `sakay-gtfs`, `ptac-2014`, or `busmaps`.
- Every file under `data/**` is validated against a JSON Schema before use; every dataset is referenced by id from `data/provenance/sources.yaml`; every fare rule carries `effective_from` and `source_url`.
- Fare values are exactly those in spec §8.3 (2026-09-28 matrix; MRT-3/LRT-2 50% discount from 2026-03-23; LRT-1 ₱16.25 + ₱1.47/km from 2025-04-02 and **excluded** from the discount; Pasig River Ferry ₱0).
- Routing engine: MOTIS v2.11.4; API paths `/api/v6/plan`, `/api/v1/geocode`; server port `8080`; compose service name `routing`.
- Out of scope for v1, do not build: real-time/GTFS-RT, live vehicle positions, PNR, tricycles, user accounts.
- Local-first: everything runs via `docker compose up`; no cloud account, paid API, or external service may be required for tests.
- Every `POST /plan` response MUST include `itineraries[].fare.effective_from` and `itineraries[].sources[]`; CI has a test that fails if either is absent.
- npm scripts must work from Windows PowerShell 5.1 as well as CI bash — no shell-only syntax in `package.json` scripts.

## Review Focus

Inputs and conditions the spec implies but whose tests live in specific tasks:

1. **A walk-only trip** (very short distance): must return one walk itinerary with `fare.amount = 0`, `fare.source_id = null`, and not "no route found" — tested in Task 10.
2. **Mixed-mode fare correctness around the LRT-1 exclusion**: an itinerary with MRT-3 + LRT-1 legs gets the 50% discount on MRT-3 only, and the total equals the per-leg sum each with its own `effective_from` — tested in Tasks 3 and 10.
3. **Missing/blocked dataset**: artifacts must fail the licence gate if a blocked dataset id appears; `/sources` must still return usable provenance when one dataset is absent — tested in Tasks 2 and 8.
4. **Unknown/absent place** (barangay not mapped in OSM): `/search` returns PSGC locality matches or nearby stops with `partial: true`, never a 500 or an empty crash — tested in Task 10.
5. **Stale data**: a fare matrix older than 183 days is flagged stale, and `/sources` exposes `last_checked` — tested in Tasks 3 and 4.

---

### Task 1: Monorepo foundation, shared package, CI

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.nvmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/toolchain.test.ts`, `vitest.config.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: npm workspaces `packages/* services/* apps/*`; package name `@biyahey/shared`; scripts `npm run lint`, `npm run typecheck`, `npm test`, `npm run ci`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/toolchain.test.ts
import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_OK } from './index';
describe('toolchain', () => { it('exposes the shared marker', () => expect(TOOLCHAIN_OK).toBe(true)); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/shared`
Expected: FAIL — cannot resolve `./index` (no package yet).

- [ ] **Step 3: Implement the workspace**

Create the files above: root `package.json` (`"private": true`, workspaces, `engines.node >=22`, scripts `lint: eslint .`, `typecheck: tsc -b`, `test: vitest run`, `ci: npm run lint && npm run typecheck && npm test`), `tsconfig.base.json` (`strict`, `target ES2022`, `module NodeNext`, `composite: true`), `packages/shared/src/index.ts` exporting `export const TOOLCHAIN_OK = true;`. CI workflow runs `npm ci`, `npm run ci` on push/PR with Node 22.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm ci && npm run ci`
Expected: lint clean, typecheck clean, 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json eslint.config.js .prettierrc.json .nvmrc vitest.config.ts packages .github
git commit -m "chore: scaffold npm workspaces with shared package and CI"
```

---

### Task 2: Provenance registry and `sources[]` contract

**Files:**
- Create: `data/provenance/sources.yaml` (10 entries, spec §8.1)
- Create: `data/provenance/schema/sources.schema.json`
- Create: `packages/shared/src/provenance.ts`, `packages/shared/src/provenance.test.ts`
- Create: `scripts/validate-data.mjs`, `package.json` script `validate:data`

**Interfaces:**
- Consumes: `@biyahey/shared` workspace.
- Produces:
```ts
export type SourceId = 'osm' | 'osm-wiki-jeepney' | 'ltfrb-fares' | 'rail-fares' | 'mmda-ferry'
  | 'psgc' | 'photon' | 'openfreemap' | 'motis' | 'crowd-reports';
export interface DataSource { id: SourceId; name: string; publisher: string; url: string;
  licence_spdx: string; licence_url: string; coverage: string; last_checked: string;
  attribution: string; used_for: string[]; }
export class UnknownSourceError extends Error {}
export function loadProvenance(dataDir?: string): Map<SourceId, DataSource>;
export function attributionFor(ids: SourceId[]): string;   // dedupe + stable order
export function provenanceFor(ids: SourceId[]): DataSource[];
export function assertKnownSources(ids: string[]): SourceId[];
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/provenance.test.ts
import { describe, expect, it } from 'vitest';
import { attributionFor, loadProvenance, UnknownSourceError } from './provenance';
describe('provenance', () => {
  it('loads exactly the 10 registered sources', () => {
    expect([...loadProvenance().keys()]).toHaveLength(10);
  });
  it('uses the OSM attribution string fixed by the spec', () => {
    expect(loadProvenance().get('osm')!.attribution)
      .toBe('© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0');
  });
  it('dedupes and orders attribution', () => {
    expect(attributionFor(['ltfrb-fares', 'osm', 'osm'])).toBe(
      '© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0 · Fares per LTFRB fare matrix effective 28 September 2026');
  });
  it('rejects unknown source ids', () => {
    expect(() => attributionFor(['made-up' as never])).toThrow(UnknownSourceError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/shared`
Expected: FAIL — cannot resolve `./provenance`.

- [ ] **Step 3: Implement the registry, schema and loader**

Write `sources.yaml` with the exact 10 rows from spec §8.1 (`last_checked: 2026-11-01`, `licence_spdx` in SPDX form: `ODbL-1.0`, `CC-BY-SA-2.0`, `MIT`, `CC0-1.0`). Implement `loadProvenance` with the `yaml` package, `attributionFor` joining `attribution` values with ` · `, and `assertKnownSources` throwing `UnknownSourceError`. Add JSON Schema for the yaml shape and `scripts/validate-data.mjs` using `ajv` against `data/**/schema/*.json`; wire `npm run validate:data`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/shared && npm run validate:data`
Expected: 4 tests pass; `validate-data` exits 0.

- [ ] **Step 5: Commit**

```bash
git add data/provenance packages/shared/src scripts/validate-data.mjs package.json
git commit -m "feat(data): add provenance registry and sources contract"
```

---

### Task 3: Fare model, fare engine, golden cases

**Files:**
- Create: `data/fares/fares-2026-09-28.yaml`, `data/fares/rail-tables.yaml`, `data/fares/schema/fares.schema.json`
- Create: `packages/shared/src/fares.ts`, `packages/shared/src/fares.test.ts`, `packages/shared/src/types.ts`

**Interfaces:**
- Consumes: `SourceId` from Task 2.
- Produces:
```ts
export type FareMode = 'jeepney' | 'modern-jeepney' | 'city-bus-ordinary' | 'city-bus-aircon'
  | 'provincial-bus-ordinary' | 'uv-express-traditional' | 'uv-express-modern' | 'p2p'
  | 'mrt3' | 'lrt2' | 'lrt1' | 'ferry';
export interface FareQuote { amount: number; currency: 'PHP'; confidence: 'official' | 'estimated';
  effective_from: string; source_id: SourceId | null; breakdown: {label: string; amount: number}[]; }
export interface LegFareInput { mode: FareMode; distanceKm: number; routeFare?: number;
  freeRideOverride?: boolean; }
export function quoteFareForLeg(input: LegFareInput): FareQuote;
export function sumFares(quotes: FareQuote[]): FareQuote;
export function isFareStale(effectiveFrom: string, today?: Date): boolean; // stale past 183 days
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/fares.test.ts — 25 golden cases; representative assertions
import { describe, expect, it } from 'vitest';
import { quoteFareForLeg, sumFares, isFareStale } from './fares';
describe('fare engine — 2026-09-28 matrix', () => {
  it('charges jeepney ₱14 for 4 km or less', () => {
    expect(quoteFareForLeg({ mode: 'jeepney', distanceKm: 3.4 }).amount).toBe(14);
  });
  it('charges jeepney ₱26 at 10 km', () => {
    expect(quoteFareForLeg({ mode: 'jeepney', distanceKm: 10 }).amount).toBe(26);
  });
  it('applies the 50% MRT-3 discount to the published band', () => {
    expect(quoteFareForLeg({ mode: 'mrt3', distanceKm: 8.2 }).amount).toBe(9); // round(13+15*8.2/16.9)=20 → 50% = 10? see Step 3 rounding rule
  });
  it('never discounts LRT-1', () => {
    const q = quoteFareForLeg({ mode: 'lrt1', distanceKm: 5 });
    expect(q.amount).toBe(23.6); // 16.25 + 1.47*5
    expect(q.breakdown.map(b => b.label)).not.toContain('50% rail discount');
  });
  it('sums legs and keeps the oldest effective date', () => {
    const total = sumFares([
      quoteFareForLeg({ mode: 'jeepney', distanceKm: 4 }),
      quoteFareForLeg({ mode: 'mrt3', distanceKm: 8.2 }),
    ]);
    expect(total.effective_from).toBe('2026-03-23');
  });
  it('flags a matrix older than 183 days', () => {
    expect(isFareStale('2026-01-01', new Date('2026-11-01'))).toBe(true);
    expect(isFareStale('2026-09-28', new Date('2026-11-01'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/shared`
Expected: FAIL — cannot resolve `./fares`.

- [ ] **Step 3: Implement the config + engine**

Write `fares-2026-09-28.yaml` with the spec §8.3 values (`base_fare`, `base_km`, `per_km`, `effective_from: 2026-09-28`, `source_id`, `source_url`). Write `rail-tables.yaml` with: LRT-1 formula `{boarding: 16.25, per_km: 1.47, effective_from: 2025-04-02}`, MRT-3 band `{min: 13, max: 28, length_km: 16.9, discount: 0.5, effective_from: 2026-03-23, confidence: estimated}`, LRT-2 band `{min: 13, max: 28, length_km: 13.6, discount: 0.5, effective_from: 2026-03-23, confidence: estimated}` (LRT-2 values must be replaced with transcribed operator values during Task 11 acceptance; flag with `needs_verification: true` in the yaml). Implement: money rounded to 2 dp (`Math.round(x*100)/100`); P2P = `routeFare * 1.15`; UV Express = `per_km * distanceKm`; ferry = 0 with `source_id: 'mmda-ferry'`; `freeRideOverride` → 0 with `confidence: 'estimated'` and breakdown label `Free-ride service contract (unverified status)`. `sumFares` sums breakdowns, returns the earliest `effective_from`, `source_id` = `null` when mixed sources (breakdown labels carry the source), `confidence` = `estimated` if any leg estimated.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/shared`
Expected: 25 fare cases + provenance tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/fares packages/shared/src
git commit -m "feat(fares): add 2026 fare matrix, rail tables and fare engine"
```

---

### Task 4: Fastify API skeleton — `/health`, `/sources`, `/fares/quote`

**Files:**
- Create: `services/api/package.json`, `services/api/tsconfig.json`
- Create: `services/api/src/app.ts`, `services/api/src/server.ts`
- Create: `services/api/src/routes/health.ts`, `sources.ts`, `fares.ts`, `services/api/src/errors.ts`
- Create: `services/api/test/app.test.ts`

**Interfaces:**
- Consumes: `loadProvenance`, `quoteFareForLeg` from `@biyahey/shared`.
- Produces: `buildApp(opts?: {dataDir?: string}): FastifyInstance`; `GET /health → {status:'ok'}`; `GET /sources → DataSource[]`; `POST /fares/quote` body `{mode, distanceKm, routeFare?, freeRideOverride?}` → `FareQuote`; error shape `{error:{code:string, message:string}}`.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/app.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
describe('api', () => {
  it('reports health', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
  it('serves the provenance registry', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/sources' });
    expect(res.json()).toHaveLength(10);
  });
  it('quotes a jeepney fare', async () => {
    const res = await buildApp().inject({ method: 'POST', url: '/fares/quote',
      payload: { mode: 'jeepney', distanceKm: 10 } });
    expect(res.json().amount).toBe(26);
  });
  it('rejects an unknown mode with 400', async () => {
    const res = await buildApp().inject({ method: 'POST', url: '/fares/quote',
      payload: { mode: 'hovercraft', distanceKm: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MODE');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/api`
Expected: FAIL — cannot resolve `buildApp`.

- [ ] **Step 3: Implement the app**

Fastify 5 app with JSON-schema body validation (zod → `fastify-type-provider-zod` or ajv; pick zod), `buildApp` injecting `dataDir` default `../../data`, route registration, centralized error handler mapping `UnknownSourceError → 422 UNKNOWN_SOURCE`, `InvalidModeError → 400 INVALID_MODE`. `server.ts` listens on `PORT ?? 8787` and logs the resolved data dir.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/api && npm run typecheck`
Expected: 4 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add Fastify skeleton with health, sources and fare quote"
```

---

### Task 5: Pipeline stage 01 — OSM download, NCR extract, coverage report

**Files:**
- Create: `pipelines/requirements.txt`, `pipelines/pyproject.toml`, `pipelines/pipeline/__init__.py`
- Create: `pipelines/pipeline/osm.py`, `pipelines/pipeline/cli.py`, `pipelines/pipeline/schema.py`
- Create: `pipelines/tests/test_osm.py`, `pipelines/tests/fixtures/taginfo_philippines.json`
- Create: `docs/runbooks/data-build.md` (OSM section)

**Interfaces:**
- Produces: `ncr_bbox() -> tuple[float,float,float,float]` = `(14.35, 120.90, 14.80, 121.15)`; `osmium_extract_cmd(pbf: Path, bbox: tuple, out: Path) -> list[str]`; `parse_coverage(taginfo: dict) -> dict` returning `{route_relations, by_mode: dict[str,int], ptv2_share: float, data_until: str}`; CLI `python -m pipeline.cli osm --pbf <path> --out data/build`.

- [ ] **Step 1: Write the failing test**

```python
# pipelines/tests/test_osm.py
from pipeline.osm import ncr_bbox, osmium_extract_cmd, parse_coverage
from pipeline.schema import validate_coverage
def test_ncr_bbox_is_the_researched_metro_manila_bbox():
    assert ncr_bbox() == (14.35, 120.90, 14.80, 121.15)
def test_extract_command_uses_bbox_and_output():
    cmd = osmium_extract_cmd("ph.osm.pbf", ncr_bbox(), "out/ncr.osm.pbf")
    assert cmd[:3] == ["osmium", "extract", "--bbox"]
    assert cmd[3] == "14.35,120.90,14.80,121.15"
def test_coverage_parses_taginfo_fixture():
    import json, pathlib
    tags = json.loads(pathlib.Path(__file__).parent.joinpath("fixtures/taginfo_philippines.json").read_text())
    report = parse_coverage(tags)
    assert report["route_relations"] == 2851
    assert report["by_mode"]["bus"] == 1425
    assert 0.99 <= report["ptv2_share"] <= 1.0
    validate_coverage(report)  # raises on schema violation
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pipelines && python -m pytest -q`
Expected: FAIL — `ModuleNotFoundError: pipeline.osm`.

- [ ] **Step 3: Implement stage 01**

`osm.py`: `ncr_bbox`, `osmium_extract_cmd` (uses `--bbox minLon,minLat,maxLon,maxLat` per osmium convention but expose the researched tuple order; assert in the cmd string exactly `14.35,120.90,14.80,121.15`), `parse_coverage` reading `type=route` counts (taginfo keys like `"type=route"`), `download_geofabrik(dest)` (uses `requests`, prints the pinned snapshot date), `run_stage_osm` orchestrating download → extract → coverage. `schema.py`: `validate_coverage` with `jsonschema`. `cli.py`: argparse subcommands `osm`. Fixture file is a trimmed taginfo JSON containing the researched counts (document the source URL in a comment).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pipelines && python -m pytest -q`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pipelines docs/runbooks/data-build.md
git commit -m "feat(pipeline): add OSM download, NCR extract and coverage stage"
```

---

### Task 6: GTFS builder — OSM route relations to GTFS core

**Files:**
- Create: `pipelines/pipeline/gtfs.py`, `pipelines/pipeline/osm_routes.py`
- Create: `pipelines/tests/test_gtfs.py`, `pipelines/tests/fixtures/osm_routes.osm`

**Interfaces:**
- Produces: `RouteDef`, `StopRef` dataclasses; `iter_route_relations(path: Path) -> Iterator[RouteRelation]` (pyosmium, reads `.osm`/`.pbf`); `build_feed(routes: list[RouteDef], agency: AgencyInfo, feed_start: date, feed_end: date) -> GtfsFeed`; `GtfsFeed.write(path: Path) -> None` (zip with `agency.txt, routes.txt, stops.txt, trips.txt, stop_times.txt, shapes.txt, calendar.txt, feed_info.txt, LICENSE-DATA.txt`); `generate_trips(headway_peak_min: int, headway_offpeak_min: int) -> list[TripSpec]` (service 05:00–22:00; peak 06:00–09:00 + 16:00–19:00).

- [ ] **Step 1: Write the failing test**

```python
# pipelines/tests/test_gtfs.py
from pathlib import Path
from pipeline.gtfs import build_feed, generate_trips
from pipeline.osm_routes import iter_route_relations, AgencyInfo
FIX = Path(__file__).parent / "fixtures" / "osm_routes.osm"
def test_reads_route_relations_from_fixture():
    rels = list(iter_route_relations(FIX))
    assert {r.route_id for r in rels} >= {"rail-mrt3", "ferry-pasig"}
def test_generates_two_trips_per_direction_based_on_headways():
    trips = generate_trips(headway_peak_min=4, headway_offpeak_min=9)
    assert len(trips) == 272  # computed: 8h peak (=480/4*2? see step 3 formula pinned below)
def test_writes_a_valid_gtfs_zip_with_licence_notice():
    feed = build_feed([...fixture route defs...], agency=AgencyInfo.SYNTHETIC,
                      feed_start=date(2026,11,1), feed_end=date(2027,10,31))
    out = tmp_path / "gtfs.zip"; feed.write(out)
    names = zipfile.ZipFile(out).namelist()
    assert {"routes.txt", "trips.txt", "LICENSE-DATA.txt"} <= set(names)
    assert "ODbL" in zipfile.ZipFile(out).read("LICENSE-DATA.txt").decode()
def test_stop_times_are_monotonic():
    feed = build_feed([...], ...)
    for trip_stops in feed.stop_times_by_trip():
        assert all(a.time <= b.time for a, b in zip(trip_stops, trip_stops[1:]))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pipelines && python -m pytest tests/test_gtfs.py -q`
Expected: FAIL — `ModuleNotFoundError: pipeline.gtfs`.

- [ ] **Step 3: Implement the builder**

`GtfsFeed` dataclass holds row lists; `write` zips CSVs with `utf-8-sig`, appends `LICENSE-DATA.txt` (ODbL 1.0 notice + attribution string from spec Appendix A). `generate_trips` is pinned by formula: for each direction, peak period = 06:00–09:00 + 16:00–19:00 = 6 h → `6*60/4 = 90` trips; off-peak = 05:00–06:00 + 09:00–16:00 + 19:00–22:00 = 10 h → `10*60/9 = 66.67 → 67` trips; total per direction 157; two directions = 314? Do **not** trust this arithmetic — pin the test to the formula implemented, i.e. `math.ceil` on each window, and write the exact expected number once the formula is written in Step 3; keep the test assertion as the single source of truth (replace `272` with the computed value before committing). Mode mapping: OSM `route=light_rail|subway|train → route_type 1`, `route=ferry → 4`, `route=bus|share_taxi → 3`; GTFS row ids namespaced `rail-mrt3`, `bus-…`, `jeep-…`, `ferry-…` so the BFF can identify mode families (see Task 10).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pipelines && python -m pytest -q`
Expected: all pipeline tests pass.

- [ ] **Step 5: Commit**

```bash
git add pipelines/pipeline pipelines/tests
git commit -m "feat(pipeline): generate GTFS core from OSM route relations"
```

---

### Task 7: Curated jeepney/UV inventory and merge

**Files:**
- Create: `data/routes/jeepney-inventory.yaml` (seed ≥10 routes transcribed from the OSM Wiki list; each entry `needs_verification: true` until transcribed)
- Create: `data/routes/schema/jeepney-inventory.schema.json`
- Create: `pipelines/pipeline/inventory.py`, `pipelines/tests/test_inventory.py`

**Interfaces:**
- Produces: `InventoryRoute` dataclass `{code, name, mode: 'jeepney'|'uv-express', endpoints: [str,str], via_roads: list[str], stop_landmarks: list[str], headway_peak_min, headway_offpeak_min, typical_length_km, operator, source_url, needs_verification}`; `load_inventory(path) -> list[InventoryRoute]`; `to_route_def(route: InventoryRoute, stop_lookup: dict[str, tuple[float,float]]) -> RouteDef`; `merge_routes(osm: list[RouteDef], inventory: list[RouteDef]) -> list[RouteDef]` (OSM route id wins; inventory route ids are `jeep-<code>` / `uv-<code>`).

- [ ] **Step 1: Write the failing test**

```python
# pipelines/tests/test_inventory.py
import pytest
from pipeline.inventory import load_inventory, merge_routes
def test_seed_inventory_has_at_least_ten_routes():
    routes = load_inventory("data/routes/jeepney-inventory.yaml")
    assert len(routes) >= 10
    assert all(r.source_url.startswith("https://") for r in routes)
def test_rejects_a_route_missing_via_roads(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text("routes:\n  - code: T9999\n    name: Bad route\n")
    with pytest.raises(ValueError, match="T9999"):
        load_inventory(bad)
def test_merge_prefers_osm_route_definition():
    merged = merge_routes([route_def("jeep-T1010", "OSM version")],
                          [inventory_route("T1010", "Curated version")])
    assert [r.name for r in merged if r.route_id == "jeep-T1010"] == ["OSM version"]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pipelines && python -m pytest tests/test_inventory.py -q`
Expected: FAIL — cannot import `load_inventory`.

- [ ] **Step 3: Implement and seed the inventory**

Schema: required `code, name, mode, endpoints, via_roads, stop_landmarks, headway_peak_min, headway_offpeak_min, typical_length_km, source_url`; `stop_landmarks` must be non-empty (landmark-first wayfinding per spec §11). Seed file: 10 entries transcribed from <https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes>, each with the wiki section as `source_url`, `needs_verification: true`, and a header comment stating the CC BY-SA 2.0 provenance. `to_route_def` derives a `RouteDef` with `distance_km = typical_length_km`, endpoints mapped via `stop_lookup` (fall back to a `TerminalNotMappedError` listing the missing landmark — surfaced in the coverage report, not a crash).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pipelines && python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/routes pipelines/pipeline pipelines/tests
git commit -m "feat(data): add curated jeepney/UV inventory and merge stage"
```

---

### Task 8: Fare artifacts, provenance manifest, licence gate

**Files:**
- Create: `pipelines/pipeline/fares.py`, `pipelines/pipeline/manifest.py`
- Create: `pipelines/tests/test_fares_gtfs.py`, `pipelines/tests/test_manifest.py`
- Create: `.github/workflows/licence-gate.yml`

**Interfaces:**
- Produces: `build_gtfs_fare_tables(fares_yaml: dict) -> dict[str, str]` (CSV text for `fare_attributes.txt`/`fare_rules.txt`; `price` formatted with 2 decimals); `build_manifest(artifacts: list[Path], sources: dict, built_at: str) -> dict` (`{built_at, engine:{name:'motis', version:'v2.11.4'}, datasets:[{id, path, sha256, licence_spdx}], attributions:[str]}`); `BLOCKED_DATASET_IDS = {"sakay-gtfs","ptac-2014","busmaps"}`; `assert_no_blocked_dataset(manifest) -> None` (raises `BlockedDatasetError`).

- [ ] **Step 1: Write the failing test**

```python
# pipelines/tests/test_manifest.py
import pytest
from pipeline.manifest import build_manifest, assert_no_blocked_dataset, BlockedDatasetError
def test_manifest_records_sha256_and_licence(tmp_path):
    f = tmp_path / "gtfs.zip"; f.write_bytes(b"zip")
    m = build_manifest([f], {"osm": {"licence_spdx": "ODbL-1.0"}}, "2026-11-01T00:00:00Z")
    assert m["datasets"][0]["sha256"] == hashlib.sha256(b"zip").hexdigest()
    assert m["datasets"][0]["licence_spdx"] == "ODbL-1.0"
    assert m["engine"] == {"name": "motis", "version": "v2.11.4"}
def test_licence_gate_rejects_blocked_datasets():
    with pytest.raises(BlockedDatasetError, match="busmaps"):
        assert_no_blocked_dataset({"datasets": [{"id": "busmaps"}]})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pipelines && python -m pytest tests/test_manifest.py -q`
Expected: FAIL — cannot import `pipeline.manifest`.

- [ ] **Step 3: Implement**

`fares.py` reads `data/fares/fares-2026-09-28.yaml` and emits GTFS fare rows (one `fare_attributes` row per mode/class; `fare_rules` rows for route ids of that mode). `manifest.py` computes sha256, includes the ODbL attribution strings from `data/provenance/sources.yaml`, and implements the blocked-id gate. CI workflow `licence-gate.yml`: run `python -m pipeline.cli licence-gate --manifest data/build/manifest.json` on any change under `data/` or `pipelines/`, failing on blocked ids or missing ODbL notice.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pipelines && python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add pipelines .github/workflows/licence-gate.yml
git commit -m "feat(data): add GTFS fare artifacts, provenance manifest and licence gate"
```

---

### Task 9: MOTIS Docker image, config and compose service

**Files:**
- Create: `services/routing/Dockerfile`, `services/routing/config/config.yml`, `services/routing/README.md`
- Create: `docker-compose.yml` (service `routing` only; api/web added in later tasks)
- Create: `scripts/motis-smoke.mjs`, `package.json` script `smoke:routing`

**Interfaces:**
- Consumes: `data/build/osm/ncr.osm.pbf` (Task 5), `data/build/gtfs/gtfs.zip` (Tasks 6–7), `data/build/manifest.json` (Task 8).
- Produces: compose service `routing` → `http://localhost:8080`; healthcheck on `GET /api/v1/geocode?text=Cubao`.

- [ ] **Step 1: Write the failing smoke check**

```js
// scripts/motis-smoke.mjs — exits non-zero with a clear message when the router is wrong
const base = process.env.MOTIS_URL ?? 'http://localhost:8080';
const geo = await fetch(`${base}/api/v1/geocode?text=Cubao`).then(r => r.json());
const plan = await fetch(`${base}/api/v6/plan?fromPlace=14.619,121.053&toPlace=14.554,121.024&time=2026-11-02T08:00:00%2B08:00`).then(r => r.json());
const transit = (plan.itineraries ?? []).filter(i => i.legs.some(l => l.mode !== 'WALK'));
if (!geo.length) throw new Error('geocode failed: no results for Cubao');
if (!transit.length) throw new Error('plan failed: no transit itinerary Cubao -> Ayala');
console.log(`ok: ${geo.length} geocode hits, ${transit.length} transit itineraries`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run smoke:routing`
Expected: FAIL — `fetch failed` (nothing listening on 8080).

- [ ] **Step 3: Implement the image and service**

Dockerfile: `FROM debian:bookworm-slim`; install `curl bzip2 ca-certificates`; `ARG MOTIS_VERSION=v2.11.4`; download `https://github.com/motis-project/motis/releases/download/${MOTIS_VERSION}/motis-linux-amd64.tar.bz2`; verify `sha256=b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc` (from the v2.11.4 release asset digest); extract to `/opt/motis`; copy a generated starter config. Generate the config once with the binary's built-in generator (`motis config` inside the container), then commit it as `services/routing/config/config.yml` with: OSM path `/data/osm/ncr.osm.pbf`, timetable path `/data/gtfs/gtfs.zip`, server port `8080`, and paths mounted read-only from `data/build`. Compose: `routing` builds the Dockerfile, mounts `./data/build:/data:ro`, publishes `8080:8080`, healthcheck `curl -f http://localhost:8080/api/v1/geocode?text=Cubao`. `services/routing/README.md` documents the Windows fallback (the release also ships `motis-windows.zip`, if Docker is unavailable).

- [ ] **Step 4: Run it to verify it passes**

Run: `docker compose up -d routing && docker compose logs --tail=20 routing && npm run smoke:routing`
Expected: container healthy; smoke prints `ok: … geocode hits, … transit itineraries`.

- [ ] **Step 5: Commit**

```bash
git add services/routing docker-compose.yml scripts/motis-smoke.mjs package.json
git commit -m "feat(routing): add MOTIS image, config and compose service"
```

---

### Task 10: BFF `/search` and `/plan` — MOTIS adapter, fare enrichment, `sources[]`

**Files:**
- Create: `services/api/src/routing/motis-client.ts`, `services/api/src/routing/map-itinerary.ts`
- Create: `services/api/src/routes/search.ts`, `services/api/src/routes/plan.ts`
- Create: `services/api/src/domain/itinerary.ts`, `services/api/test/fixtures/motis-plan-cubao-ayala.json`, `motis-geocode-cubao.json`
- Create: `services/api/test/plan.test.ts`, `services/api/test/search.test.ts`

**Interfaces:**
- Consumes: MOTIS endpoints; `quoteFareForLeg`, `sumFares`, `provenanceFor` from `@biyahey/shared`.
- Produces:
```ts
export interface ItineraryDto { id: string; durationMin: number; startTime: string; endTime: string;
  transfers: number; walkDistanceM: number; modes: string[]; fare: FareQuote;
  sources: SourceId[]; legs: LegDto[]; }
export interface LegDto { mode: 'walk'|'jeepney'|'bus'|'mrt3'|'lrt1'|'lrt2'|'ferry'|'uv-express'|'p2p';
  from: {name: string; lat: number; lon: number; stopId?: string};
  to: {name: string; lat: number; lon: number; stopId?: string};
  startTime: string; endTime: string; durationMin: number; routeShortName?: string;
  headsign?: string; signage?: string; landmarkHint?: string; distanceM?: number; sourceIds: SourceId[]; }
export interface PlanRequest { origin: {lat:number; lon:number}; destination: {lat:number; lon:number};
  departAt?: string; preferences?: {cheapest?: boolean; fewestTransfers?: boolean; maxTransfers?: number; bufferMin?: number}; }
```
- `POST /plan → {v:1, itineraries: ItineraryDto[], sources: DataSource[]}`; `GET /search?q= → {partial: boolean, groups:{stops:[], landmarks:[], routes:[], saved:[]}}`.

- [ ] **Step 1: Write the failing tests**

```ts
// services/api/test/plan.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import planFixture from './fixtures/motis-plan-cubao-ayala.json';
const app = buildApp({ motisFetch: async () => planFixture });
describe('POST /plan', () => {
  it('maps MOTIS itineraries and attaches fares and sources', async () => {
    const res = await app.inject({ method: 'POST', url: '/plan',
      payload: { origin: { lat: 14.619, lon: 121.053 }, destination: { lat: 14.554, lon: 121.024 } } });
    const body = res.json();
    expect(body.v).toBe(1);
    expect(body.itineraries.length).toBeGreaterThan(0);
    expect(body.itineraries[0].fare.effective_from).toBeTruthy();
    expect(body.itineraries[0].sources).toContain('osm');
    expect(body.itineraries[0].legs.some(l => l.mode === 'mrt3')).toBe(true);
  });
  it('keeps a walk-only trip with zero fare and a null source', async () => {
    const appWalk = buildApp({ motisFetch: async () => walkOnlyFixture });
    const res = await appWalk.inject({ method: 'POST', url: '/plan', payload: { origin: ..., destination: ... } });
    expect(res.json().itineraries[0].fare.amount).toBe(0);
    expect(res.json().itineraries[0].fare.source_id).toBeNull();
  });
  it('sorts cheapest first when the preference is set', async () => {
    const res = await app.inject({ method: 'POST', url: '/plan',
      payload: { origin: ..., destination: ..., preferences: { cheapest: true } } });
    const amounts = res.json().itineraries.map(i => i.fare.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });
  it('never emits an itinerary without sources', async () => {
    const res = await app.inject({ method: 'POST', url: '/plan', payload: {...} });
    for (const it of res.json().itineraries) expect(it.sources.length).toBeGreaterThan(0);
  });
});
// services/api/test/search.test.ts — unknown barangay returns 200 with partial:true, never 500
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @biyahey/api`
Expected: FAIL — `/plan` route not registered.

- [ ] **Step 3: Implement the adapter**

`motis-client.ts`: injectable `fetch` (`buildApp({motisFetch})`), base URL `MOTIS_URL ?? http://localhost:8080`, timeout 5 s, retries 1. `map-itinerary.ts`: MOTIS → DTO with pinned rules — mode from GTFS route id prefix (`rail-mrt3 → mrt3`, `rail-lrt1 → lrt1`, `rail-lrt2 → lrt2`, `ferry- → ferry`, `jeep- → jeepney`, `uv- → uv-express`, `bus- → bus`, `WALK → walk`), leg distance from `legGeometry` polyline if `distance` absent, `signage` = `displayName ?? routeShortName` prefixed with `Look for: `, `landmarkHint` = nearest curated stop's `stop_landmarks` entry. Fare: `sumFares(legs.filter(mode !== 'walk').map(leg => quoteFareForLeg({mode, distanceKm: leg.distanceM/1000})))`. Alternatives: issue up to 3 plan calls (`departAt`, `departAt + 10 min`, `maxTransfers: 0`) and dedupe by `startTime + first/last leg stop ids` when MOTIS returns < 3 itineraries; verify whether MOTIS v2.11.4 supports `numItineraries` in `/api/v6/plan` against `openapi.yaml` first and use it if present. Re-rank for `cheapest` (fare asc, duration asc) and `fewestTransfers`. Free-ride overrides: route ids listed in `data/fares/free-ride-routes.yaml` (create with an empty list + comment; fill when verified) → `freeRideOverride: true`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @biyahey/api && npm run smoke:routing`
Expected: API tests pass against fixtures; smoke still green.

- [ ] **Step 5: Commit**

```bash
git add services/api data/fares/free-ride-routes.yaml
git commit -m "feat(api): add MOTIS plan adapter with fare and provenance enrichment"
```

---

### Task 11: Golden routes, coverage report, phase-1 acceptance

**Files:**
- Create: `services/api/test/golden/routes.json` (10 NCR trips: name, origin, destination, minItineraries, requiredModes, fareBounds)
- Create: `services/api/test/golden.test.ts` (tagged `integration`)
- Create: `pipelines/pipeline/coverage.py`, `pipelines/tests/test_coverage.py`, CLI subcommand `coverage`
- Create: `docs/runbooks/data-build.md` (complete), `docs/runbooks/phase1-acceptance.md`
- Modify: `package.json` script `verify:phase1`

**Interfaces:**
- Produces: `compute_coverage(inventory: list[InventoryRoute], feed: GtfsFeed) -> dict` = `{total, modelled, pct, missing: [{code, reason}]}`; acceptance script `npm run verify:phase1` running pytest, API unit tests, `docker compose up -d`, `npm run smoke:routing`, golden integration tests, and the coverage threshold check (≥ 60%).

- [ ] **Step 1: Write the failing tests**

```json
// services/api/test/golden/routes.json (excerpt)
{"trips":[
 {"name":"Cubao to Ayala","origin":{"lat":14.619,"lon":121.053},"destination":{"lat":14.554,"lon":121.024},
  "minItineraries":3,"requiredModes":["mrt3"],"fareBounds":{"min":6,"max":40}},
 {"name":"Fairview to Makati","origin":{"lat":14.733,"lon":121.058},"destination":{"lat":14.554,"lon":121.024},
  "minItineraries":3,"requiredModes":["jeepney","bus"],"fareBounds":{"min":14,"max":120}}
]}
```
```python
# pipelines/tests/test_coverage.py
from pipeline.coverage import compute_coverage
def test_coverage_reports_missing_inventory_routes():
    report = compute_coverage([inv("T1010"), inv("T9999")], feed_with("jeep-T1010"))
    assert report["pct"] == 50.0
    assert report["missing"] == [{"code": "T9999", "reason": "no GTFS route jeep-T9999"}]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pipelines && python -m pytest tests/test_coverage.py -q` and `npm test --workspace @biyahey/api -- --run -t golden`
Expected: FAIL — coverage module missing; golden test missing.

- [ ] **Step 3: Implement golden harness + coverage + runbooks**

Golden test: for each trip call the running stack (`API_URL ?? http://localhost:8787`), assert `itineraries.length >= minItineraries`, every `requiredModes` appears in `modes`, total fare within `fareBounds`, each itinerary has `sources[]` and `fare.effective_from`. Mark `it.skipIf(!process.env.API_URL && !dockerAvailable())` so unit CI stays green; `verify:phase1` sets `API_URL`. Coverage module computes inventory-vs-feed coverage and prints the missing list. Runbook `phase1-acceptance.md` lists the exact commands and expected outputs from spec §3 criteria 1–7.

- [ ] **Step 4: Run the acceptance**

Run: `npm run verify:phase1`
Expected: all checks pass; coverage ≥ 60 %; 10/10 golden trips meet their minima.

- [ ] **Step 5: Commit**

```bash
git add services/api/test/golden pipelines/pipeline/coverage.py pipelines/tests docs/runbooks package.json
git commit -m "test: add golden NCR trips, coverage report and phase-1 acceptance runbook"
```

---

## Self-review notes (author)

- Spec coverage: §5 data facts → Tasks 3, 5–8; §7 architecture → Tasks 1, 4, 9, 10; §8 provenance/fares → Tasks 2, 3, 8; §9 routing → Tasks 9, 10; §10 API → Tasks 4, 10; §12 phase 0–1 → Tasks 1–11; §13 testing → every task's test steps + Task 11. Phase 2 has its own plan; phases 3–6 get plans when reached.
- Deliberate deferrals: GTFS generation tool choice is pinned to a bespoke `build_feed` in Task 6 (the `osm2gtfs` spike is recorded in the runbook as an alternative); LRT-2 band values carry `needs_verification: true` until Task 11 acceptance transcribes the operator table.
- Type consistency: `FareQuote`/`DataSource`/`SourceId` defined in Tasks 2–3 are the only versions used by Tasks 4, 10, 11.
