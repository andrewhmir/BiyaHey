# PH-wide coverage recon — measured state before the national build

Date: 2026-11-04 (Asia/Manila). Branch: `feature/ph-wide-coverage` from `main` @ `3bd0684`.
Purpose: establish the measured facts the PH-wide coverage / walk-bridging / tricycle work depends on,
before any production change. Every number below names the command or artifact that produced it;
numbers without a command are marked `UNVERIFIED` and are not relied on.

Inputs:
- National OSM: `data/build/philippines-latest.osm.pbf`, 612,430,134 bytes, Geofabrik PH (ODbL 1.0).
- Running stack (pre-change): MOTIS 2.11.4 + NCR clip + NCR GTFS (489 routes), `routing` :8080 and `api` :8787 healthy.
- Scratch artifacts (git-ignored): `data/build/recon/`.

## 1. National OSM transit inventory (full-PBF relation pass)

Command: `pipelines\.venv\Scripts\python.exe data/build/recon/scan-osm.py`
Artifact: `data/build/recon/route-tags.json`. The pass is relations-only and took **13.4 s**
(`partial_pass1: false`), so it is a complete count, not a sample.

| Metric | Value |
|---|---|
| `type=route` relations, all values | 2,851 |
| `route=bus` | 1,424 |
| `route=ferry` | 107 |
| `route=share_taxi` | 76 |
| `route=train` | 14 |
| `route=light_rail` | 6 |
| `route=subway` | 2 |
| `route=jeepney` | 2 |
| `route=tricycle` | 2 |
| non-transit route values (road 579, bicycle 184, power 135, hiking 90, …) | not ingested |

"**Ingestible**" = in a pipeline-ingest family, with ≥2 stop-ish members, ≥1 way member and a name
(the pipeline's mode table is `pipelines/pipeline/osm_routes.py`; `route=coach`, `minibus`,
`monorail`, `trolleybus`, `aerialway` are absent from the national extract, so keeping them out of
the mode table is justified by data, not preference):

| Family | Total | Ingestible | Coverage ratio |
|---|---|---|---|
| bus | 1,424 | **965** | 67.8 % |
| ferry | 107 | **85** | 79.4 % |
| share_taxi | 76 | **19** | 25.0 % |
| train | 14 | **14** | 100 % |
| light_rail | 6 | **6** | 100 % |
| subway | 2 | **2** | 100 % |
| jeepney | 2 | **0** | 0 % |

Top bus networks (from `mode_stats.bus.top_networks`, verbatim): `LTFRB National Capital Region`
441, `LTFRB Interregional Bus` 229, `LTFRB Region IV-A` 100, `LTFRB Region VII` 96,
`PH:CAR:Baguio` 70, `P2P` 59, `LTFRB PUJ` 42, `LTFRB Region VI` 25, `LTFRB Region III` 23,
`LTFRB PUB` 23, `PH:CAR:Benguet` 19, `LTFRB Negros Island Region` 19. Network tags already carry
region names, so national ingestion is mapping work that existed before this pass, not something
invented for it.

Reading: the OSM bus layer is **~2–7× richer than the inherited "jeepney route relations are thin"
picture** suggested. That picture was about jeepneys (2 relations nationally, 0 ingestible) — jeepney
coverage still depends on the curated NCR inventory. Ferry and rail ingestion already exist in the
pipeline; long-distance ferries stay excluded by the publish-stage rule until they get their own
sourced fares and a mode decision.

## 2. Tricycle evidence — negative finding

Command: same pass; artifact keys `transit_tag_relations`, `mode_stats.tricycle`.
The whole Philippines extract carries **2** `route=tricycle` relations:

| OSM id | Tags | Why it is not usable as a served route |
|---|---|---|
| 3317216 | `name=Tuguegarao to Callao Cave`, `source=Schadow1 Expeditions` | A tourist excursion whose only stated source is a blog; no stop members, no schedule, no operator. |
| 15970228 | `operator=PVTODA`, no name, no from/to | No name, no from/to, no date/schedule; a single association tag. |

`route=share_taxi` nationally is 76 relations, 19 ingestible; its networks are UV Express / PUJ /
Laguna / Bicol van associations — nothing in the tag set identifies a tricycle service. So the
honest baseline for tricycles is **no citable tricycle route with service evidence exists in OSM
today**, and a synthesized tricycle headway would fabricate a schedule for a demand-responsive
service. What does exist in OSM tricycle-adjacent space, from the full keyword pass (`scan-notes.md` §tricycle):

- **2 NCR `route=share_taxi` relations for the Wilson E-trike System** (Wilson St, San Juan/QC area) —
  both **ingestible** (≥2 stop members, way geometry, name). This is the only mapped tricycle-class
  service with usable corridor data in the country, and it is *e-trike* (electric tricycle) data, not
  the usual gasoline tricycle.
- **10 `route=bus` relations in Bulacan named "Baliwag/Bustos Tricycle"** — TODA routes mistagged as
  bus, **no stop nodes**, so they are not ingestible and must not be relabelled as a bus service.
- `route=tricycle` itself: the 2 unusable relations in the table above.
- Tricycle **terminals**: `amenity=tricycle_station` is the only mapped tricycle amenity and there are
  **3 nationally** (NCR 1, Region IV-A 2; **0** in Quezon City, Cebu City, Iloilo City and Davao
  City; no `tricycle_stand`, `motorcycle_taxi` or `taxi_stand` anywhere).
- Pilot-city context: QC — 0 tricycle terminals / 211 taxi ranks / 58 bus stations / 203 ingestible
  routes in box; Cebu City — 0 / 16 / 13 / 76; Iloilo City — 0 / 7 / 2 / 6; Davao City — 0 / 1 / 0 / 0.

So the honest tricycle deliverable is: ingest the OSM-mapped **e-trike** corridors as real
`trike-` routes with a synthesized headway (the feed-wide documented convention, never presented as
realtime), exclude `route=tricycle` and the mistagged Bulacan relations with reasons, ship an empty
curated route/fare path ("fare not published"), and use the 3 mapped terminals for a rare,
data-driven walk-leg hint. No fabricated corridor, no invented fare.

The plan's Task 8 therefore ships: the tricycle ingestion path + schema (proven with fixtures), an
empty curated `data/fares/tricycle-fares.yaml` (no published fare matrix found — never reuse the
jeepney matrix), a terminal artifact from OSM point features, and this negative finding.

## 3. Regional split

Method (final, `data/build/recon/regional-split.json`, `run-summary.json`): a relations pass
(17.5 s) collects the stop-member node ids, then a **node pass with a C++-level ID filter** resolves
all 6,847 stop nodes (16,596 refs, 0 unresolved) in **109.5 s** — the earlier naive Python-callback
attempt measured ~24k nodes/s and was abandoned. Each relation is assigned to the region whose
documented approximate box contains the median of its stop coordinates; relations with no stop
coordinates (1,637, mostly non-transit route values) and points outside every box are reported as
`no_stop_coords` / `unassigned`, never silently dropped.

Route relations by assigned region (all route values; the pipeline ingest families subset in §1):
NCR 499, Region IV-A 251, CAR 118, Region VII 111, Region VI 44, Region VIII 37, Region III 32,
Region V 32, Region XIII 20, Region X 20, Region II 14, unassigned 13, Region IV-B 12, Region I 4,
Region XII 4, Region IX 2, Region XI 1, **BARMM 0**, no stop coordinates 1,637. Island roll-up:
Luzon 920, Visayas 227, Mindanao 67. Ingestible transit relations by region: NCR 472, IV-A 227,
CAR 114, VII 105, VIII 34, III 29, VI 29, V 28, XIII 20, X 20, IV-B 12, II 7, I 4, XII 2, IX 2,
XI 0, no-stop-coords 16.

Caveats, stated rather than hidden: the boxes are axis-aligned approximations, so boundary-adjacent
relations can be misclassified (e.g. Region XI's single coordinate-bearing relation looks like a
box/median artefact — the national feed's per-stop counts in Task 3 are the displayable number, and
they use the same boxes with the same caveat); BARMM genuinely has no route relations in this
snapshot; 57 % of relations carry no stop coordinates because most `type=route` values are not
transit. The recon numbers that matter for ingestion decisions (§1, §2) need no region assignment.

## 4. National MOTIS import — D1 gate result

Command and evidence: `data/build/recon/motis-national/logs/docker-cmd.txt`,
`logs/import-summary.json`, `logs/import-timing.txt`, `graph-evidence/`.
Runner: `data/build/recon/run-national-import.ps1`. Config: national OSM + the then-current NCR
GTFS (489 routes) — the OSM import dominates, and the timetable took 7.6 s of the 15 m 47 s.

| Metric | Measured | Gate | Verdict |
|---|---|---|---|
| Wall-clock | **1,006.6 s = 16.8 min** (MOTIS `timing.txt` total 15 m 47 s) | ≤ 45 min | **PASS** (37 % of budget) |
| Peak RSS | **3.047 GiB** (135 `docker stats` samples, peak at t+104 s) | ≤ 8 GB | **PASS** (38 % of budget) |
| Exit code / OOM | 0 / false (`timeout --signal=KILL 2700` never reached) | 0 | **PASS** |
| Graph on disk | 890,111,694 B (850 MB): osr 611 MB, adr 176 MB, meta tiny | — | buildable |

**D1 verdict: national graph — GO. No island sharding** (ruling R8). Phase timings: osr 1 m 38 s,
adr 13 m 53 s, tt 7.6 s, adr_extend 1.65 s, platform matches 3.93 s. If import time ever becomes a
problem, `geocoding: false` removes the 14-minute `adr` phase at the cost of the `/geocode` API;
that is recorded, not applied.

Two operational findings that change the write-up of the runbook:

1. **A Windows bind mount cannot hold a MOTIS graph.** Run 1 died after 19 s with
   `unable to import: resize error` at an osr pass: MOTIS ftruncates/mmaps sparse graph files and
   that fails on `C:`-backed bind mounts. Run 2 used a **Docker named volume** (`ext4` inside the
   Docker Desktop VM) and succeeded. The production compose service avoids this by writing to
   container-local `/var/lib/motis/data`, but any future flow that points `MOTIS_DATA_DIR` at a host
   directory will fail the same way.
2. **Docker Desktop exposes 7.611 GiB of RAM to containers on this host** (8,171,765,760 B) even
   though the host has 15.7 GiB and 12 logical processors; the 8 GB cgroup cap is therefore
   effectively the VM ceiling. Peak use was 3.047 GiB, so the gate is met with headroom.

## 5. Live routing baseline (pre-change, NCR graph)

Command: `node data/build/recon/probe.mjs`; artifact `data/build/recon/baseline-probes.md` / `.json`.
Departure for every probe: `2026-11-05T00:00:00Z` (08:00 PHT, Thursday). BFF = `POST /plan`,
raw = MOTIS `GET /api/v6/plan`.

| Pair | BFF itineraries | First duration / modes |
|---|---|---|
| Cubao → Ayala | 4 | 43 min, walk>bus |
| Cubao → Meycauayan (Bulacan) | **0** | — |
| Fairview → Las Piñas | **0** | — |
| Manila → Baguio | 0 | — |
| Manila → Tagaytay | 0 | — |
| 250 m walk (Manila) | 2 | 4 min, walk |
| NCR → Bacoor (Cavite) | 4 | 48 min, walk>bus |
| NCR → Batangas City | 0 | — |
| Cebu City → Lapu-Lapu | 0 | — |
| Iloilo City → Oton | 0 | — |
| Davao City → Tagum | 0 | — |
| Baguio → La Trinidad | 0 | — |
| Banaue → Sagada (rural) | 0 | — |
| Manila → Cebu City (cross-island) | 0 | — |

Latency (sequential, 1 warm-up, N=25, Cubao → Ayala): BFF `POST /plan` **p50 59.1 ms, p95 108.2 ms**
(mean 65.3, max 110.7). Raw MOTIS (N=10): p50 234.3 ms, p95 374.2 ms.

Zeros are **not** all the same — this distinction decides what the national graph can and cannot fix:

- **10 of 11 zeros are genuine MOTIS data gaps.** Raw MOTIS also returns 0 itineraries with
  `x-biyahey-implausible-dropped: 0` and `x-biyahey-unsupported-dropped: 0`: Fairview → Las Piñas
  (930 B), Manila → Baguio (942 B), Manila → Tagaytay (944 B), NCR → Batangas (945 B),
  Manila → Cebu (943 B), and the rest. The national graph is the mechanism to fix these.
- **Cubao → Meycauayan is a BFF-side zero.** Raw MOTIS returns **20 itineraries / 888,017 B**, but
  the BFF's plausibility guard drops **22** across its three attempts, delivering 0. A bigger graph
  will not fix this by itself; it is recorded as an acceptance risk for Task 11's probe matrix.
- **Fairview → Las Piñas** returns nothing from raw MOTIS even though both ends are inside the NCR
  bbox. This is a corridor/walking-graph gap, not a bbox gap — exactly the case the walk fallback
  and D3 walk bridging must address.
- The 250 m walk confirms the `direct` mechanism: raw MOTIS `itineraries: 0, direct: 1`, and the
  BFF's third (direct-only) attempt surfaces it as 2 itineraries.

## 6. Walk-routing mechanism (for the walk fallback)

Probed 2026-11-04 against the pinned build (evidence `data/build/recon/motis-endpoint-probe.txt`):

- `/api/v1/route` → **404**; the versioned endpoint list in the binary is
  geocode/health/map/one-to-all/one-to-many/plan/rentals/reverse-geocode/stoptimes/trip plus
  `/api/v2…v6/{plan,trip,stoptimes}`.
- Road-following walk geometry **is** available: `GET /api/v6/plan` with `transitModes=` (empty),
  `directModes=WALK`, `maxDirectTime=<seconds>` returns the walk in `direct[0]`, with
  `legs[0].legGeometry` (precision 6). Evidence: Cubao → Ayala walk-only request → `direct=1`,
  duration 8,052 s, distance 9,560 m, polyline 1,738 chars.
- `maxDirectTime` is in **seconds**; `maxTravelTime` is in **minutes** (MOTIS v2.11.4
  `openapi.yaml`). Mixing them silently disables the direct result.
- Fairview → Las Piñas returns `direct = []` even with `maxDirectTime = 172,800`: **no walking path
  exists in the graph between those points**, so the honest fallback geometry there is the labelled
  straight-line estimate. This is the case the dashed `route-approximate` style exists for.

## 7. Risks this recon hands to execution

1. **Cubao → Meycauayan BFF-side zero** (§5) threatens the NCR→Bulacan acceptance row even with the
   national graph. Diagnose against the national feed; if the guard is right, the feed shapes are
   wrong; if the guard is wrong, fix it with data evidence.
2. **National GTFS import is not yet measured.** The D1 measurement used the NCR timetable; Phase 2
   must re-measure with the national feed. OSM import dominates, so the expectation is ~17–20 min,
   but it is an expectation, not a measurement.
3. **Disk headroom.** Host `C:` free fell 17.11 → 14.94 GB during the import run; the kept evidence
   graph volume is 850 MB. The national feed and graph rebuilds need room — check before building.
4. **Full-extract node passes are affordable with a C++ ID filter** (~110 s for all 6,847 stop
   nodes, §3) and unaffordable with a per-node Python callback (~24k nodes/s). Any future scan must
   use pyosmium's native filtering.
5. **Tricycles remain a negative finding** (§2). The deliverable is honest UI/labels plus a tested
   ingestion path, not a fabricated corridor.

## 8. Decision

- **D1 = national graph, no sharding** (evidence §4).
- National artifacts: `data/build/osm/ph.osm.pbf`; national build root `data/build/gtfs/ph/`
  (feed at `data/build/gtfs/ph/gtfs/gtfs.zip`, `manifest.json`, `coverage-regional.json`).
- Walk fallback: road-following geometry via the §6 mechanism when the graph has a path;
  straight-line + `approximate: true` only when it does not.
- Tricycle: no invented routes or schedules; curated ingestion path + OSM terminal hints + negative
  finding (§2).
