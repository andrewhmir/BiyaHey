# Session prompt — PH-wide coverage, walk bridging, tricycle ingestion

> **Use:** paste this file's content as the first message of a fresh session in this repository
> (`C:\Users\Andrew\Desktop\BiyaHey!`). It is a *prompt*, not a plan. It carries the context a new
> session would otherwise spend 20 steps rediscovering, and the decisions already taken. Verify the
> measured facts before relying on them; then write the plan and execute it with the project's
> existing method (superpowers + subagent-driven development).
>
> Drafted 2026-11-04 against `main` @ `4b4b7fb` (working tree clean, no git remote).

---

## 1. The ask

Three outcomes, in priority order:

1. **Coverage — navigate anywhere in the Philippines.** Today the router only knows a Metro Manila
   (NCR) graph; any origin/destination outside it returns *Walang ruta*. Make an origin→destination
   request anywhere in PH resolve to something useful: a real transit itinerary, or an honest
   fallback (outcome 2). No silent dead ends.
2. **Walk bridging.** Where no known transit route connects the two ends, or where the transit chain
   breaks, show the walk between the ends instead of an empty result — *"put it as walk in between
   for now"*. The walk must be clearly labelled as a walk/estimate, never passed off as a served
   transit route.
3. **Tricycle routes where they actually exist.** Pull tricycle route data where available and feed
   it into routing so tricycle legs replace walk connectors through normal routing. **Never invent**
   a tricycle route, stop, schedule or fare: this repo's rule is that every route and fare states its
   source, and a fabricated corridor is a lie even if it looks helpful.

Scope includes the data pipeline (scrape / ingest more PH transport data), the MOTIS routing graph,
the BFF `/plan` contract, and the PWA's rendering of walk/tricycle legs.

---

## 2. Read these first (in this order)

1. `docs/superpowers/EXECUTION-HANDOFF.md` — durable project state. Read at least the last five
   sections ("Current status" onward) plus "Non-negotiable facts from research" and "Rulings".
2. `docs/superpowers/specs/2026-11-01-biyahey-design.md` — product contract, licensing, provenance
   rules, coverage criterion.
3. `docs/superpowers/plans/2026-11-01-biyahey-data-spine.md` — how the data pipeline is structured
   (the plan's Tasks map roughly onto `pipelines/pipeline/*.py`).
4. `services/routing/config/config.yml`, `services/api/src/routing/map-itinerary.ts`,
   `services/api/src/routes/plan.ts`, `packages/shared/src/domain.ts`,
   `apps/web/src/components/map/RoutePathLayer.tsx` — the contract edges this work moves.

Then load `using-superpowers` and `dsh-harness` before delegating anything (per AGENTS.md).

---

## 3. Verified state on 2026-11-04 (re-verify anything older than a day)

| Fact | Value |
|---|---|
| Repo | `C:\Users\Andrew\Desktop\BiyaHey!`; `main` @ `4b4b7fb`; working tree clean; **no remote** |
| Stack | `docker compose` brings up `routing` (MOTIS 2.11.4, :8080) and `api` (Fastify BFF, :8787); PWA dev server :5173 via `npm run dev --workspace @biyahey/web` |
| Current graph | **NCR only.** `data/build/osm/ncr.osm.pbf` = 69.7 MB clip of `data/build/philippines-latest.osm.pbf` (612 MB, already downloaded, Geofabrik PH, ODbL) |
| Current feed | 489 routes / 4,562 stops / 160,392 trips / 1,496,336 stop_times; 378,282 shape rows; sha256 `0dff35d264dd24a19ce93ac61c5f4b4972d243c4b66283a82b19c0ee073a5fdd` |
| Pipeline | Python 3.10, `pipelines/.venv` (pyosmium 4.0.2); stages `download | osm | publish | coverage | licence` via `python -m pipeline.cli`; driven by `npm run data:build` |
| OSM → GTFS | Route relations accepted for `route=` `light_rail`, `subway`, `train`, `ferry`, `bus`, `share_taxi`, `jeepney` only (`pipelines/pipeline/osm_routes.py`). Stops come from member roles `stop/platform/stop_position/boarding_position/stop_area`, else synthesized landmarks. Shapes are stitched by shared node. |
| Mode families | GTFS `route_id` prefixes `rail-`, `bus-`, `jeep-`, `uv-`, `ferry-`; the BFF decodes them with `ROUTE_ID_PATTERN` in `services/api/src/routing/map-itinerary.ts`; unknown families are dropped ("unsupported") rather than mispriced |
| MOTIS config | `osm: /data/osm/ncr.osm.pbf`; `link_stop_distance: 100`; `max_footpath_length: 15` (**minutes**); `extend_missing_footpaths: false`; `street_routing: true`; no tiles |
| MOTIS street-routing HTTP | **Not available in this pinned build**: `/api/v1/route` → 404; `/api/v1/one-to-all` exists but rejected naive params (400). The BFF only calls `/api/v6/plan` and `/api/v1/geocode` (`services/api/src/routing/motis-client.ts`). Walk geometry therefore comes from `/api/v6/plan`'s `direct` array, or must be synthesized. |
| Docker from a confined shell | Blocked (`npipe:////./pipe/dockerDesktopLinuxEngine: permission denied`). A step that must rebuild the graph needs an unconfined/user-approved run; otherwise stop and record the blocked step rather than claiming success. |
| Shell | Windows PowerShell 5.1 only (`pwsh` does not exist); `Invoke-WebRequest` needs `-UseBasicParsing`; every file write must be UTF-8 without BOM (never `Add-Content` for ledgers — see handoff "Durable-state hazard"). |

**Live probes 2026-11-04, against the running NCR graph** (re-run before relying on them):

| Probe | Itineraries | Direct |
|---|---|---|
| Cubao → Ayala (served corridor) | 5 | 0 |
| Cubao → Meycauayan, Bulacan | 6 | 0 |
| Fairview → Las Piñas (coverage hole inside NCR) | **0** | **0** |
| Manila → Baguio | 0 | 0 |
| Manila → Tagaytay | 0 | 0 |
| 250 m walk (inside NCR) | 0 | **1** (real walk geometry) |

Interpretation: inside the graph, a short walk-only trip is returned as `direct`; outside/a hole in
coverage, the answer is genuinely empty — the empty state the UI shows as *Walang ruta*. Note
Fairview→Las Piñas is inside the bbox yet empty: that is a corridor gap, not a bbox gap, and it is
exactly what walk bridging + (optionally) new route data has to address.

**Known gaps inherited (do not hide them, do not "fix" by inventing data):** tricycle routes have
no data (earlier research: 1 stray `route=Tricycle` relation nationally, 76 `route=share_taxi`, which
is ambiguous and also used for UV Express); PNR suspended until ~2028; P2P formally deferred; LRT-2
bands provisional; 62 implausible itineraries dropped; curated inventory coverage 12/16.

---

## 4. Decisions already taken (defaults — override only with a written reason in the ledger)

- **D1 — One national MOTIS graph first.** MOTIS is designed to import country-sized extracts
  (NCR's 70 MB imports in the container in minutes). Try the 612 MB PH PBF in one graph. **Gate:**
  if `motis import` exceeds ~45 min wall-clock or ~8 GB RSS on this machine, shard by island group
  (Luzon / Visayas / Mindanao) and select in the BFF by coordinates — record the measurement either
  way so the choice is evidence-based, not a guess.
- **D2 — Region-aware build, not a rewrite.** Add `--region ph|ncr|<bbox>` (or equivalent) to the
  `osm` stage and make the MOTIS config template region-driven. The NCR path must stay reproducible
  so `npm run verify:phase1`/`verify:phase2` still mean what their runbooks say. National artifacts
  go beside the NCR ones (`data/build/osm/ph.osm.pbf`, `data/build/gtfs/gtfs.zip`).
- **D3 — Engine-level walk bridging is the honest mechanism for "walk in between".** Enable MOTIS
  `extend_missing_footpaths: true` and raise `max_footpath_length` (start at 30 min ≈ 2.4 km) so the
  router itself can emit a walk transfer between two otherwise disconnected corridors. Measure the
  footpath-table size and `/plan` latency before/after; do not silently accept a graph that gets 10×
  slower. Never stitch two unrelated itineraries together and present them as one plan.
- **D4 — App-level fallback for genuinely unserved trips.** When `/plan` exhausts its attempts and
  still has zero itineraries, return **one** synthesized walk itinerary:
  - additive DTO flag (e.g. `fallback: 'walk'`, plus a `walk-estimate` source id in the registry),
  - geometry from MOTIS `direct` when the graph covers it, else straight-line geometry marked
    approximate (the map already has a dashed `route-approximate` style and a
    `data-approximate-legs` counter — reuse it),
  - duration from haversine at ~4.5 km/h; distance stated on the card,
  - UI copy says plainly: no transit route is known for this trip; this is a walking estimate and may
    not be a safe/realistic walk. Beyond ~25 km, say so explicitly ("walking is not a real
    alternative for X km") while still returning the estimate — the user asked for a placeholder,
    not for a lie.
  Keep `v: 1` and the additive-contract discipline (old clients and cached payloads must keep working).
- **D5 — Tricycle encoding mirrors the existing families.** `trike-` route-id prefix, GTFS
  `route_type 3` (same numeric family as bus/jeep/uv), BFF maps it to a new `tricycle` leg mode
  (shared `Mode` union, mode meta/colour/icon, leg strips, fare display). Fares only from a curated
  `data/fares/tricycle-*.yaml` with a `source_url` per entry; with no source, show "fare not published"
  (additive nullable in the DTO) — **never** reuse the jeepney matrix as a tricycle fare.
  Data sources to try, in order: OSM `route=tricycle` / tricycle-tagged `route=share_taxi`;
  OSM tricycle terminals (`amenity=tricycle_station`, `tricycle_stand`); LGU LPTRP PDFs (the only
  official per-LGU route lists — research §5.3); OSM Wiki city route lists. If a walk connector
  starts/ends within ~300 m of a mapped tricycle terminal, the honest move is a *badge/hint* on the
  walk leg ("tricycle likely here — not in the dataset"), not a fake tricycle leg.
- **D6 — Honesty and licence rules do not relax.** No realtime claims, no PNR as available, no Google
  Maps Platform, no sakay/PTAC/BusMaps-derived feeds, no fare matrix invented from blog posts. Every
  new route cites a `source_id` in the provenance registry, every fare keeps `effective_from`.
- **D7 — Coverage must be measured, per region.** Publish a coverage report naming every missing
  curated route and the per-region counts (NCR, CAR, Regions I–V, VI–VIII, IX–XIII, BARMM; Luzon /
  Visayas / Mindanao roll-up). A number in a doc without the command that produced it is not evidence.

---

## 5. Suggested work plan (write the real plan doc first, then execute)

Follow the repo's existing method: plan doc under `docs/superpowers/plans/`, ledger under
`.superpowers/sdd/<date>-ph-wide-coverage/progress.md`, one writer per scope, fresh implementer +
reviewer per task, Conventional Commits on `feature/ph-wide-coverage`.

**Phase 0 — Recon and baseline (no production code).**
Scan the full PH PBF and record counts: route relations by `route=` value (`bus`, `jeepney`,
`share_taxi`, `tricycle`, `ferry`, `light_rail`, `subway`, `train`, `minibus`), how many carry stop
members, and the regional split. There is a scratch scanner at `data/build/scan-route-tags.py`
(pyosmium, git-ignored) — reuse or rewrite it; a naive full-PBF node+relation pass took >20 minutes
on this machine, so prefer a relation-only pass (`include_relations`/tags filter) or Overpass for
counts. Also: sample ~50 OD pairs across regions against the live stack, record
`itineraries`/`direct` counts, and measure `motis import` time/RSS on the national PBF in a scratch
container. Deliverable: `docs/research/2026-11-04-ph-wide-coverage-recon.md` with the numbers and the
D1 go/no-go.

**Phase 1 — National data spine.** Region-aware OSM extraction; nationwide OSM route ingestion
(bus/jeepney/UV/ferry/rail + any tricycle); stops and shapes that survive outside NCR; provenance
registry rows for every new source; per-region coverage report; headway/fare defaults that do not
invent data (see `pipelines/pipeline/gtfs.py` constants); feed validation (`npm run validate:data`,
`npm run check:fares`, gtfs-validator attempt recorded as in `docs/runbooks/data-build.md`).

**Phase 2 — Router graph.** National MOTIS config; D3 footpath settings; verify transfers, walk
bridges and route quality on real corridors (NCR, NCR→Bulacan/Cavite/Batangas, Baguio, Cebu,
Iloilo, Davao); record import time/RSS and `/plan` p50/p95.

**Phase 3 — Walk fallback.** BFF synthesis per D4, shared DTO additions, UI labels/badges, unit +
integration tests (empty MOTIS payload → fallback itinerary; fallback never claims transit; cached
old payloads still render).

**Phase 4 — Tricycle ingestion.** Shared `Mode`/meta, `trike-` ingestion, fare file, D5 terminal
hints, UI. Seed only from real sources; if Phase 0 finds none, commit the empty-path ingestion,
the schema, the negative finding, and leave the walk fallback in place.

**Phase 5 — Verification and docs.** Full gates, live probe matrix, screenshots if UI changed,
runbook + `EXECUTION-HANDOFF.md` update, README status without green-washing.

---

## 6. Acceptance criteria (measurable; record the command that produced each)

1. **Probe matrix.** Each of these returns ≥1 itinerary, and every itinerary either has transit legs
   whose sources are cited or carries the walk-fallback label: NCR short (Cubao→Ayala); NCR long
   (Fairview→Las Piñas); NCR→Bulacan; NCR→Cavite; NCR→Batangas; NCR→Baguio; Cebu City→Lapu-Lapu;
   Iloilo City→Oton; Davao City→Tagum; a rural pair with no transit (walk fallback); one cross-island
   pair (ferry or explicit "no transit data" + walk estimate with distance warning).
2. **Walk bridging is observable.** At least one plan shows a walk leg between two transit legs that
   exceeds the previously possible footpath (or the full fallback itinerary), covered by a test and a
   live probe; and the fallback's UI copy/label is present in a browser check.
3. **Tricycle: data or an honest negative.** If ≥1 usable real route is found: a probe plan uses a
   `tricycle` leg, and a previously-walked connector on that corridor is no longer a walk (record
   before/after). If none: scan evidence + negative finding recorded, ingestion path and schema
   committed, and the doc says plainly that the walks could not be replaced for lack of data.
4. **Feed and graph.** `validate:data`, `check:fares`, `pipelines pytest`, `npm run lint`,
   `typecheck`, `test`, `build`, `test:e2e`, payload budget and `smoke:routing` all green; feed
   sha256 and route/stop/trip counts recorded.
5. **Performance honesty.** Import time/RSS, `/plan` p50/p95, and payload size before/after recorded;
   any regression stated, not hidden (phase-2 Lighthouse verdict is already PARTIAL — do not re-badge
   it green).
6. **Docs.** `docs/runbooks/data-build.md` (national build recipe), `docs/runbooks/local-dev.md` if
   needed, `docs/superpowers/EXECUTION-HANDOFF.md` new dated section, `README.md` status, and a
   per-region coverage artifact.

---

## 7. Traps to respect (each cost a previous session real time)

- `data/build/` is git-ignored but large; don't commit PBF/zip artifacts, and don't delete the 612 MB
  national PBF — re-downloading it is minutes.
- The feed sha256 is pinned in docs/tests/scripts (`0dff35d2…`). A national rebuild changes it; grep
  for the old value and re-pin deliberately, with the build report that justifies it.
- MOTIS namespaces feed route ids (`gtfs_bus-…`); the BFF strips the dataset prefix before mode
  decoding. Any new family must survive `ROUTE_ID_PATTERN`.
- Shapes: the pipeline stitches member ways by shared OSM node and drops detached fragments. A
  nationwide extract will surface more boundary-spanning and broken relations; keep the
  `skipped_members`/detached-fragment counters and fail loudly rather than drawing beelines.
- Ferry exclusions are defence-in-depth: long-distance ferries are excluded from the built feed and
  the BFF drops unknown ferries rather than pricing them as the free Pasig River service. If Phase 1
  adds long-distance ferry service, it needs its own fare/source rows and a mode decision.
- Docker is unavailable from the confined file sandbox (npipe denied). Plan the graph rebuild as a
  user-visible step or run unconfined; never claim the import ran if it did not.
- Windows PowerShell 5.1: `-UseBasicParsing` on every `Invoke-WebRequest`; no bash dependency in
  product scripts; `bash` on PATH is WSL (needs `/mnt/c/...`).
- Ledgers/reports: UTF-8 without BOM only. cp1252 dashes previously corrupted both SDD ledgers.
- Parallel writers: keep scopes disjoint (pipelines/data vs services/api vs apps/web vs docs); one
  MOTIS rebuild at a time; record write scopes in the plan and review at the end.

---

## 8. Ask the human once, at the start (batch all questions in one call)

1. Region sequencing — Luzon first (NCR belt → north/south), or all three island groups in this pass?
2. Walk fallback — acceptable to show a straight-line *estimate* when the walking graph has no path
   (labelled as such), or should the app refuse beyond a hard distance cap?
3. Tricycle fares — leave "not published" until an LGU source is curated (recommended), or use a
   documented flat placeholder marked unverified?
4. National graph — is a 612 MB / potentially multi-GB-RAM MOTIS graph acceptable on this machine, or
   is region sharding the required target regardless of the measurement?
5. Pilot LGUs for tricycle/route seeding (e.g. Quezon City, Cebu City, Davao City, Iloilo City) — any
   that must be included?

Do not stop again after these; continue until the acceptance table in §6 is filled, and stop only for
irreversible actions (deleting data, pushing, spending money) or a genuinely unpriced decision.

---

## Appendix A — commands worth having at hand

```powershell
# stack (needs Docker access outside the confined sandbox)
docker compose up -d routing api
docker compose build api; docker compose up -d api   # after BFF changes

# data pipeline
npm run data:build                                   # download -> osm -> publish
pipelines\.venv\Scripts\python.exe -m pipeline.cli --help
pipelines\.venv\Scripts\python.exe -m pipeline.cli coverage --help

# gates
pipelines\.venv\Scripts\python.exe -m pytest pipelines/tests -q
npm run lint; npm run typecheck; npm test; npm run build
npm run validate:data; npm run check:fares
npm run test:e2e
npm run verify:phase1; npm run verify:phase2

# live routing probes
npm run smoke:routing
curl.exe "http://localhost:8080/api/v1/geocode?text=Cebu"
curl.exe "http://localhost:8080/api/v6/plan?fromPlace=14.6194,121.0531&toPlace=14.5547,121.0244&time=2026-11-05T01:00:00Z"

# web
npm run dev --workspace @biyahey/web                 # :5173
node apps/web/scripts/screenshots.mjs                # regenerate README screenshots
```

## Appendix B — contract touchpoints (where the changes land)

| Concern | File |
|---|---|
| OSM download + bbox clip | `pipelines/pipeline/osm.py` (`NCR_BBOX`, `extract_bbox`, `bbox_text`) |
| OSM route relations → GTFS | `pipelines/pipeline/osm_routes.py` (mode table, stop roles, shape stitching) |
| Curated route inventory | `data/routes/jeepney-inventory.yaml`, `pipelines/pipeline/inventory.py`, `data/routes/schema/` |
| Landmarks/aliases | `pipelines/pipeline/landmarks.py`, `data/routes/landmark-aliases.yaml` |
| Feed generation/headways | `pipelines/pipeline/gtfs.py` |
| Publish + provenance + coverage | `pipelines/pipeline/publish.py`, `manifest.py`, `coverage.py` |
| Fare matrix | `data/fares/fares-2026-09-28.yaml`, `pipelines/pipeline/fares.py`, `services/api/src/routes/fares.ts` |
| MOTIS config | `services/routing/config/config.yml`, `services/routing/Dockerfile`, `docker-entrypoint.sh` |
| Router client / mode decode / fares | `services/api/src/routing/motis-client.ts`, `map-itinerary.ts` |
| `/plan` orchestration + fallback | `services/api/src/routes/plan.ts` |
| Shared DTOs + modes | `packages/shared/src/domain.ts`, `packages/shared/src/provenance.ts` |
| Map rendering (walk/approx/trike) | `apps/web/src/components/map/RoutePathLayer.tsx`, `components/transit/modeMeta.tsx` |
