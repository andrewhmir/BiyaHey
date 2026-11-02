# Data build runbook

How to build the BiyaHey! routing inputs from licensed public data. Every artifact
described here is **generated**: it lands under `data/build/` (gitignored) and must
never be committed. The build is deterministic given the pinned snapshot dates
recorded below.

**Platform:** Windows 10/11, PowerShell 5.1, Python **3.10.11** (controller ruling R2 —
the plan's "Python 3.12" is aspirational; this machine and the future data CI job run
3.10.11). All paths are relative to the repository root unless stated otherwise.

**Ownership:** every pipeline stage is documented here: OSM clip (§1), GTFS publish
and fares (§2), landmark aliases (§3), coverage (§4), licence gate (§5). The
phase-1 acceptance run lives in [`phase1-acceptance.md`](phase1-acceptance.md).

**Measured durations (real NCR build, 2026-11-01; ruling R33):**

| Stage | Measured | Note |
|---|---|---|
| Download (612,430,134 B) | **12 m 07 s** | network-bound; Geofabrik link |
| NCR clip → `osm/ncr.osm.pbf` | **4,290 s ≈ 71.5 min** | Python-level (pyosmium) streaming scan |
| Publish → `gtfs/gtfs.zip` + manifest + report | **383.9 s ≈ 6 min 24 s** | includes the alias-aware landmark scan and the GTFS build |

The clip is a **one-time local build step**, not a per-request cost: MOTIS imports the
clip and GTFS once per container start and serves the preprocessed graph. Nothing in
the API or the acceptance path re-scans the 612 MB extract.

**One command from the repository root** (final-review item 2):

```powershell
npm run data:build                       # download → osm → publish, with the R34 aliases
npm run data:build -- --skip-download    # reuse the PH extract, re-clip + publish
npm run data:build -- --publish-only     # reuse the NCR clip, rebuild the feed
```

`scripts/data-build.mjs` resolves `pipelines/.venv`, prints each stage with absolute
paths, and always passes `--aliases data/routes/landmark-aliases.yaml`. It never runs
in tests or CI; the download is an explicit network action.

---

## 0. One-time setup — the pipeline virtualenv

The JS/TS toolchain lives at the repository root; the Python pipeline lives in
`pipelines/` with its own virtualenv. Do not install Python packages globally.

```powershell
python -m venv pipelines\.venv
pipelines\.venv\Scripts\python.exe -m pip install --upgrade pip
pipelines\.venv\Scripts\python.exe -m pip install -r pipelines\requirements.txt
```

Pins (see `pipelines/requirements.txt`): `osmium==4.0.2` (pyosmium), `PyYAML==6.0.2`,
`jsonschema==4.23.0`, `pytest==8.3.3`, `requests==2.32.3`.

Run the pipeline tests — **offline**, against committed fixtures only:

```powershell
cd pipelines
..\pipelines\.venv\Scripts\python.exe -m pytest
```

Expected: `146 passed`. Alternatively from the repository root:
`pipelines\.venv\Scripts\python.exe -m pytest pipelines` (also `146 passed`).

> Tests never download the OSM extract and never call taginfo. The download step below
> is an explicit, separate action, and the coverage test reads a committed snapshot.

---

## 1. OSM extract — stage 01

### Snapshot provenance (record this in every build)

| Item | Value |
|---|---|
| Publisher | Geofabrik (OpenStreetMap contributors) |
| URL | <https://download.geofabrik.de/asia/philippines.html> (file: `philippines-latest.osm.pbf`) |
| Licence | **ODbL 1.0** — attribution `© OpenStreetMap contributors` |
| Pinned snapshot | **data to 2026-10-31T21:23Z** (research note `docs/research/ph-transit-datasets.md` §1 row 1.1, verified 2026-11-01) |
| Why a date matters | `philippines-latest` is refreshed ~daily, so the file is not content-addressed. A build is reproducible only with the date written down |

After a download, record the timestamp actually carried by the file:

```powershell
pipelines\.venv\Scripts\python.exe -c "import osmium,sys; r=osmium.io.Reader(r'data/build/philippines-latest.osm.pbf'); print(r.header().get('osmosis_replication_timestamp')); r.close()"
```

The same header timestamp is copied into `data/build/osm/ncr.osm.pbf`, so the extract
stays auditable.

### 1.1 Download the Philippines extract (network — explicit action)

```powershell
$env:PYTHONPATH = "pipelines"
pipelines\.venv\Scripts\python.exe -m pipeline.cli download --dest data\build\philippines-latest.osm.pbf
```

Expected: prints the URL, the pinned snapshot date and the written byte count. The
2026-11-01 build took **12 m 07 s** for **612,430,134 B** (~584 MiB) — it is a large
download, not "a few minutes" on a typical link. The file goes to `data/build/`, which
is gitignored.

> Not part of any test or `npm run ci`: CI must stay green without network access.
> If the download 404s, the Geofabrik path moved — update `GEOFABRIK_PH_URL` in
> `pipelines/pipeline/osm.py` and the table above.

### 1.2 Clip to the NCR bbox (offline)

```powershell
$env:PYTHONPATH = "pipelines"
pipelines\.venv\Scripts\python.exe -m pipeline.cli osm `
    --pbf data\build\philippines-latest.osm.pbf `
    --out data\build `
    --taginfo pipelines\tests\fixtures\taginfo_philippines.json
```

Outputs:

| Artifact | Contents |
|---|---|
| `data/build/osm/ncr.osm.pbf` | Metro Manila clip, complete ways, source header preserved (ODbL); 69,735,980 B |
| `data/build/osm/coverage.json` | schema-validated coverage report (`pipelines/pipeline/schema.py`) |

Expected console output:

```
route_relations: 2851  by_mode: {'bus': 1425, 'ferry': 1243, 'share_taxi': 76, 'train': 14, 'light_rail': 6, 'subway': 2, 'jeepney': 1}
ptv2_share: 0.9948  data_until: 2026-10-31T21:22:57Z (synthesized taginfo snapshot - NOT a live query)
coverage report: data\build\osm\coverage.json
```

Measured clip time: **4,290 s (≈ 71.5 min)** for the 612 MB input on this machine. That
is a Python-level streaming scan (`pyosmium.FileProcessor` + `SimpleWriter`), run once
per data build — not a per-request cost and not part of `npm run ci`.

A missing or invalid input — absent `--pbf`/`--taginfo`, malformed taginfo JSON, a snapshot
that does not match the expected shape or the coverage schema — returns exit code `2` with a
one-line error and no traceback. The taginfo snapshot is validated **before** the clip starts,
so a bad snapshot fails in milliseconds and creates nothing under `--out`. Run from
`pipelines/` instead and drop the `$env:PYTHONPATH` line if you prefer — then use
`..\data\build` and `tests\fixtures\...` paths.

**Bounding box.** `ncr_bbox()` = `(14.35, 120.90, 14.80, 121.15)` in
`(min_lat, min_lon, max_lat, max_lon)` order (researched bbox, research note §1 row 1.5).
osmium and GeoJSON take `minLon,minLat,maxLon,maxLat`, so the text form is
**`120.90,14.35,121.15,14.80`** (controller ruling R5). `bbox_text()` produces it and
`coverage.json` records both forms; test `test_bbox_text_is_lon_lat_order_for_osmium_convention`
pins the string.

### 1.3 Why the clipping is Python, not `osmium extract --bbox`

Verified on 2026-11-01 before writing the stage:

- `pip install -r pipelines/requirements.txt` installs **pyosmium 4.0.2**. It installs
  **no `osmium` console script** — `pipelines/.venv/Scripts/` contains only
  `pyosmium-get-changes` and `pyosmium-up-to-date`.
- `where.exe osmium` finds nothing; no `osmium-tool` binary is installed (no
  Chocolatey/Scoop package).
- Therefore `osmium extract --bbox …` **cannot run** on this machine, and a test
  asserting that command would assert something that never executes.

`pipeline/osm.py` implements the clip with pyosmium's `FileProcessor` +
`SimpleWriter` in three streaming passes:

1. nodes — keep ids whose location is inside the bbox;
2. ways + relations — keep ways with ≥1 kept node **and every node they reference**
   (complete ways); keep relations with ≥1 kept node/way member. Assumes the canonical
   OSM sort (nodes, ways, relations) that every Geofabrik extract has;
3. write the kept objects and copy the source header.

If `osmium-tool` is installed later, it is a drop-in replacement for step 1.2:

```powershell
osmium extract --bbox 120.90,14.35,121.15,14.80 -o data\build\osm\ncr.osm.pbf data\build\philippines-latest.osm.pbf
```

**Known limitations (accepted for v1):** relation members outside the bbox stay as
dangling references (a partial extract), and boundary-crossing ways keep all their
nodes. A route crossing the NCR border therefore keeps only its in-bbox geometry; v1
routes are inside the bbox and the curated jeepney inventory (§2/§3) supplies what OSM
lacks. Measured peak resident memory is roughly **1–3 GB** (the extractor holds the
in-bbox node-id sets in memory); leave free disk space for both the 612 MB download and
the clip. If the machine is tight on RAM, raise the bbox precision later or split the
clip per LGU — do not lower the bbox, it is researched (ruling R5).

### 1.4 Block/filter decision

Stage 01 keeps the **whole NCR bbox extract** — every node, way and relation
intersecting the bbox — and applies **no tag block filter** at this step. Reasons:

- MOTIS needs the full street/walking graph around stops, not only public-transport
  objects (`route=*`, `public_transport=*`).
- The GTFS builder (Task 6) needs the route relations **and** the way geometry they
  reference; a tag filter would strip exactly that geometry.
- One self-contained artifact serves both consumers, and downstream stages select what
  they need. A block filter would also require `osmium-tool`, which is unavailable.

Consequence: the extract is larger than a tags-filtered one; `data/build/` is
gitignored so this costs disk, not repository size.

### 1.5 Coverage report — what is exact and what is derived

Source for now: `pipelines/tests/fixtures/taginfo_philippines.json`, a **synthesized
snapshot** that mirrors the researched taginfo figures (2,851 route relations; bus
1,425; `share_taxi` 76; ferry 1,243; PTv2 99.5%; `data_until` 2026-10-31T21:22:57Z).
It is labelled in-file (`_snapshot`) and its `coverage_source` string is copied into
`coverage.json`. It is **not** a live query. The OSM-stage counters are exact; the
taginfo figures that describe OSM *as a whole* are a snapshot of research, and a live
refresh needs three taginfo API calls (below). The phase-1 acceptance runbook repeats
this honesty note because the same caveat applies to any coverage claim built on it.

| Field | Kind | Value |
|---|---|---|
| `route_relations` | exact | 2,851 (`type=route` relations) |
| `by_mode` | exact, **partial** | bus 1,425 · ferry 1,243 · share_taxi 76 · train 14 · light_rail 6 · subway 2 · jeepney 1. The residual 84 relations carry other `route=*` values the research note did not list, so the sum (2,767) is below `route_relations` **by design** |
| `ptv2_relations` / `ptv2_tagged_relations` | exact | 1,930 / 1,940 |
| `ptv2_share` | **derived** | 1930 ÷ 1940 = 0.9948 (rounded to 4 dp) |
| `data_until` | exact | `2026-10-31T21:22:57Z` |
| `bbox`, `bbox_text`, `output`, `extract` | context | added by the stage |

To refresh the snapshot later (needs network; never in tests), query the taginfo PH
instance and rewrite the fixture, keeping `_snapshot` truthful about the query date:

- `https://taginfo.geofabrik.de/asia:philippines/api/4/tag/stats?key=type&value=route`
- `https://taginfo.geofabrik.de/asia:philippines/api/4/key/values?key=route`
- `https://taginfo.geofabrik.de/asia:philippines/api/4/tag/stats?key=public_transport:version&value=2`

### 1.6 Verify the OSM stage

```powershell
pipelines\.venv\Scripts\python.exe -m pytest pipelines
```

Expected `146 passed`, offline. Then confirm the artifacts:

```powershell
Get-ChildItem data\build\osm
pipelines\.venv\Scripts\python.exe -c "import json;d=json.load(open(r'data/build/osm/coverage.json'));print(d['route_relations'], d['ptv2_share'], d['bbox_text'])"
```

---

## 2. Publish — GTFS feed, fares, manifest, build report (stage 02)

```powershell
$env:PYTHONPATH = "pipelines"
pipelines\.venv\Scripts\python.exe -m pipeline.cli publish `
    --pbf data\build\osm\ncr.osm.pbf `
    --out data\build `
    --inventory data\routes\jeepney-inventory.yaml `
    --fares data\fares\fares-2026-09-28.yaml `
    --sources data\provenance\sources.yaml `
    --aliases data\routes\landmark-aliases.yaml
```

The stage (all offline, reads local files only):

1. reads named stop features from the NCR extract and resolves every curated
   terminal by exact normalised name, consulting the documented aliases (§3) when the
   exact name is not an OSM stop name;
2. lowercases curated ids and merges them with the OSM routes case-insensitively
   (R29). OSM wins a collision **only when the GTFS builder actually writes that OSM
   route**: an OSM relation with no usable geometry or fewer than two stops has no
   measured geometry to win with, so it must not shadow a usable curated route (this
   is how the curated `uv-m01` fills the gap left by an OSM `uv-m01` share_taxi that
   the builder drops for having one stop);
3. builds the merged feed and attaches the fare tables from `data/fares/`
   (LTFRB PUV matrix 2026-09-28; LRT-2/MRT-3 50 % discount; LRT-1 excluded; PRFS ferry free);
4. **excludes route families v1 cannot price** before the feed is built
   (final-review item 7): `rail-ss`/`rail-mnc` (PNR) and `rail-mrt9` (proposed Metro
   Manila Subway), plus every ferry that is not the free MMDA PRFS service
   (`ferry-manilacoron`, `ferry-iloilopuertoprincesa`, `ferry-liminangcongelnido`,
   `ferry-maniladavaocitygeneralsantosiloilomanila`). The exclusion list is written to
   `build-report.json` under `excluded_routes` (deduplicated by route id) with a reason
   per family. The API also drops and counts such a leg at request time
   (`x-biyahey-unsupported-dropped`) as defence in depth: pricing a non-PRFS ferry as
   the free Pasig River Ferry would be false;
5. writes `gtfs/gtfs.zip` (deterministic bytes, with the ODbL notice and the CC BY-SA
   2.0 inventory attribution inside), `manifest.json` (sha256 + datasets + attributions)
   and `build-report.json` (the curated coverage/alias report);
6. refuses to publish if the provenance registry names a blocked dataset, or if the
   manifest/artifact loses the ODbL notice or the CC BY-SA 2.0 inventory attribution
   (spec 8.1/8.2; rulings R22, R32).

Measured on 2026-11-01 (final fix wave, after the mode gate): the publish stage remains
**≈ 6 min** (first measured 383.9 s; the fix-wave republish is the same order of
magnitude). Expected console output:

```
publish: 489 routes, 160392 trips, 4562 stops
curated: 12/16 modelled, 4 skipped, 4 unresolved landmarks
coverage: 12/16 curated routes in the feed (75.0%)
aliases: 8 used, 0 invalid (data\routes\landmark-aliases.yaml)
fare tables: 6 fares, 469 route rules, 3 unrepresentable
gtfs: data\build\gtfs\gtfs.zip
manifest: data\build\manifest.json (sha256 1c8df31ecbcb8b40e4e2f0a0a5267c8e27eba9fd17a3488ac8264fec81c94296)
report: data\build\build-report.json
licence gate: ok (blocked datasets checked, ODbL-1.0 and CC BY-SA 2.0 notices present in artifact)
```

The five fewer routes than the pre-gate 494 are the excluded families (7 unique route
ids; the extract carries duplicate relations for `rail-ss`/`rail-mnc`/`rail-mrt9`). The
zip sha256 is byte-identical across rebuilds of the same inputs (deterministic).

Artifacts:

| Path | Contents | Commit? |
|---|---|---|
| `data/build/gtfs/gtfs.zip` | merged GTFS feed + fare tables + `LICENSE-DATA.txt` | **never** (gitignored) |
| `data/build/manifest.json` | sha256, dataset register rows, attributions | **never** |
| `data/build/build-report.json` | per-route records, skipped reasons, unresolved landmarks, alias usage, `coverage` block | **never** |

`build-report.json` carries, among others:

```
curated_routes_total / curated_routes_modelled / curated_routes_skipped
coverage: {total, modelled, pct, missing: [{code, reason}]}
landmark_unresolved: [{route_code, landmark}]
landmark_aliases: {path, total, used: [...], invalid: [...]}
osm_routes_total / osm_routes_skipped / blocked_datasets_checked
excluded_routes_total / excluded_routes: [{route_id, reason}]
```

`curated_routes_modelled` counts curated entries that entered the feed themselves;
`coverage.modelled` counts inventory rows whose route id the feed carries (case-insensitive,
R29) — equal in the current build, but the distinction is kept because an OSM-written
duplicate can cover a row the curated layer had to skip.

If the published feed changes, MOTIS must re-import before it serves it:

```powershell
docker compose up -d --force-recreate --wait routing
```

The entrypoint runs `motis import` on every start and re-runs only tasks whose input
hashes changed (fresh import ≈ 20 s on this machine; the healthcheck allows 600 s).

### 2.1 GTFS validation — stage 04 (ruling R46)

Pinned tool: MobilityData **`gtfs-validator` v8.0.1** CLI jar, 40,256,884 B, sha256
`19293ddd9b6f954f216d4f12054bd8a3232921751c4484339e339764a91000e2`
(`https://github.com/MobilityData/gtfs-validator/releases/download/v8.0.1/gtfs-validator-8.0.1-cli.jar`).
Java 21 is installed on this host; the jar was downloaded to `data/build/tools/`
(gitignored) and its digest verified.

**Local attempt, 2026-11-01: no valid validation result could be produced.** The
validator starts but this host's JVM cannot resolve the jar's own classpath resources:
it registers **zero GTFS tables**, reports every file (`agency.txt`, `routes.txt`, …) as
`unknown_file`, all counts are 0, and HTML report generation fails with
`ClassLoader resource "report.html" could not be resolved`. The same failure occurs on
the canonical GTFS sample feed (`google/transit` `sample-feed-1.zip`), so it is an
environment/JVM problem, not a verdict on our feed. `gtfs-validator` v5.0.0 fails the
same way (`NoSuchElementException` when loading the agency table). The JSON it wrote is
therefore **not** recorded as a pass; see the phase-1 runbook's known-gap entry.

CI job: `.github/workflows/data.yml` (`Data (GTFS validator)`, weekly + manual dispatch)
builds the published feed on a standard runner with the same pipeline commands, runs the
same pinned jar, and fails on any error notice **and** on a zero-route parse (so the
broken-loader failure mode cannot pass vacuously). It uploads the report, build report
and feed as artifacts. On a host with a working JDK, the local command is:

```powershell
java -jar data\build\tools\gtfs-validator-8.0.1-cli.jar `
    -i data\build\gtfs\gtfs.zip -o data\build\validator-report `
    -c ph -d 2026-11-01 -t 4
```

The spec's bar is **0 errors** (warnings/infos are reviewed, not silently ignored).

---

## 3. Landmark aliases (ruling R34)

`data/routes/landmark-aliases.yaml` — schema `data/routes/schema/landmark-aliases.schema.json`,
validated by `npm run validate:data` and again by `pipeline.landmarks.load_landmark_aliases`
at publish time.

An alias is a hand-checked pointer from a curated landmark string to a **specific OSM
stop feature** (`node/<id>` or `way/<id>`) whose name is `stop_name`. It adds no
coordinates: publish reads that feature's own coordinate from the extract and
re-checks that the feature's name still normalises to `stop_name` (a renamed or
deleted feature appears under `landmark_aliases.invalid`, never silently resolved to
another place). `source` records the `stops.txt` line in the built feed that proves the
stop is in the artifact.

Rules: never alias a road (a road is not a terminal), and never alias a landmark to a
same-named place in another city — those invent corridors.

The 2026-11-01 build uses eight aliases (all valid, all used):

| Curated landmark | OSM stop (feature) | Routes unlocked |
|---|---|---|
| Novaliches | Novaliches Plaza Mall (`node/7535900399`) | T101, T109*, T165, 101 |
| Balintawak Cloverleaf | Balintawak (`node/5191404470`) | T165 |
| SM Fairview | SM City Fairview (`node/1460734524`) | 111, M01 |
| Commonwealth | Commonwealth–Regalado Highway (`node/14047581959`) | 111 |
| Molino | Molino Town Center (`node/12005042518`) | C20 |
| EDSA/Shaw Boulevard | Shaw Boulevard (`node/11328574094`) | C50 |
| Malabon | Malabon Market (Estrella) (`node/14021370276`) | T115* |
| Zapote Kabila Terminal | Zapote Kabila (`node/2525328388`) | T448 |

\* the route still has a second unresolved landmark, so it remains skipped.

**Still unresolved after aliases, with the data reason (R10) — these are not lowered
bars, they are places the feed does not carry:**

| Landmark | Route(s) | Why no alias |
|---|---|---|
| Rizal Avenue | T109 | The wiki names a **road**, not a terminal. The feed's "Rizal Avenue Extension" stops are spread along several kilometres of it; picking one would invent a terminal. |
| Paco (Obando) | T112 | Paco is a barangay of Obando, Bulacan. The extract has no named stop there; the only "Paco" stops in the feed are Manila's Paco district ~10.6 km south. Aliasing would fabricate a cross-Manila corridor. |
| Victory Mall Monumento | T115 | The wiki names a mall; no OSM stop carries that name. The nearest named stops are the Monumento transport terminals, which are different places, so no alias is recorded. |
| Biñan Poblacion | T420 | Biñan city centre lies **south of the NCR bbox** (`min_lat` 14.35, R5), so the clip has no Biñan stops at all. Widening coverage is a bbox/coverage decision, not an alias. |

Result: **12 of the 16 curated routes are modelled (75.0 %)** — up from 4/16 (25.0 %)
before aliases. The metric itself is unchanged (spec §3 criterion 7).

---

## 4. Coverage report (spec §3 criterion 7)

```powershell
$env:PYTHONPATH = "pipelines"
pipelines\.venv\Scripts\python.exe -m pipeline.cli coverage `
    --inventory data\routes\jeepney-inventory.yaml `
    --feed data\build\gtfs\gtfs.zip `
    --threshold 60
```

Expected output:

```
coverage: 12/16 curated routes modelled (75.0%)
missing: T109 (no GTFS route jeep-t109)
missing: T112 (no GTFS route jeep-t112)
missing: T115 (no GTFS route jeep-t115)
missing: T420 (no GTFS route jeep-t420)
threshold: 60.0% -> PASS
```

- **Case-insensitive (R29):** the inventory keeps the published case (`jeep-T109`);
  the feed carries the lowercased id (`jeep-t109`). The report names the lowercased id
  to look for in `routes.txt`.
- **Source of truth:** the built `gtfs.zip`'s `routes.txt`, not the build report — the
  number acceptance measures is the artifact the router reads.
- `--json` prints `{total, modelled, pct, missing}` for scripts; exit code 1 means
  below threshold, 2 means missing/invalid input.
- `compute_coverage` lives in `pipelines/pipeline/coverage.py`; the publish report's
  `coverage` block calls the same function.

---

## 5. Licence gate

```powershell
pipelines\.venv\Scripts\python.exe -m pipeline.cli licence-gate --manifest data\build\manifest.json
```

Expected: `licence-gate: ok (...)` — no blocked dataset (Sakay/BusMaps are refused),
ODbL 1.0 notice present in the feed's `LICENSE-DATA.txt`, and the CC BY-SA 2.0
inventory attribution present because wiki-derived routes are shipped. Without
`--manifest`, the same command gates the committed provenance registry and needs no
`data/build` artifacts; that is the mode the pytest suite exercises. The pytest suite
is run by `npm run verify:phase1` (its pipeline-check step), **not** by `npm run ci`,
which runs lint, typecheck, vitest and `validate:data` only.

---

## 6. Generated artifacts (complete)

| Path | Producer | Commit? | Licence |
|---|---|---|---|
| `data/build/philippines-latest.osm.pbf` | `pipeline.cli download` | **never** (gitignored) | ODbL 1.0 |
| `data/build/osm/ncr.osm.pbf` | `pipeline.cli osm` | **never** (gitignored) | ODbL 1.0 |
| `data/build/osm/coverage.json` | `pipeline.cli osm` | **never** (gitignored) | — (report; derived from ODbL + taginfo stats) |
| `data/build/gtfs/gtfs.zip` | `pipeline.cli publish` | **never** (gitignored) | ODbL 1.0 derived database + CC BY-SA 2.0 inventory attribution inside |
| `data/build/manifest.json` | `pipeline.cli publish` | **never** (gitignored) | — (provenance record) |
| `data/build/build-report.json` | `pipeline.cli publish` | **never** (gitignored) | — (build report) |

`data/build/` is ignored explicitly in `.gitignore`. `*.osm.pbf` is ignored too, as a
second line of defence. Never `git add -f` an extract or a feed.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No module named pipeline` | Run with `$env:PYTHONPATH = "pipelines"` from the repo root, or `cd pipelines` first |
| `error: OSM extract not found` (exit 2) | Run step 1.1, or pass the correct `--pbf` path |
| `error: invalid taginfo JSON` / `error: invalid taginfo snapshot` / `error: taginfo snapshot fails the coverage schema` (exit 2) | The `--taginfo` file is missing, malformed, or does not match the snapshot shape/schema documented in §1.5. The snapshot is validated before the clip, so nothing was written — fix the snapshot and re-run |
| `coverage.json` reports `ptv2_share: 0.9948` | Expected — it is derived from 1930/1940, not quoted from the note |
| Extract is much smaller than expected | Check the bbox and that the input is the Philippines extract, not a small regional one |
| `osmium: command not found` | Expected on this machine — see §1.3 |
| `error: landmark aliases not found` (exit 2) | `--aliases` points at a missing file; omit `--no-aliases` / pass the committed path |
| `error: aliases do not match landmark-aliases.schema.json` | A hand edit broke the alias schema; `npm run validate:data` reports the same problem |
| `landmark_aliases.invalid` is non-empty | The pinned OSM feature vanished or was renamed in the new extract. Re-check the stop in `stops.txt`/the extract and update `osm_stop` + `source`; the affected landmark stays unresolved meanwhile |
| Publish is slow (~6 min) | Expected: the landmark resolver scans the 69 MB NCR extract and the GTFS builder writes ~162k trips |
| `docker compose up -d --wait routing` waits after a republish | The entrypoint is re-importing the changed GTFS; watch `docker compose logs -f routing` |
