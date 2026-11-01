# Data build runbook

How to build the BiyaHey! routing inputs from licensed public data. Every artifact
described here is **generated**: it lands under `data/build/` (gitignored) and must
never be committed. The build is deterministic given the pinned snapshot dates
recorded below.

**Platform:** Windows 10/11, PowerShell 5.1, Python **3.10.11** (controller ruling R2 —
the plan's "Python 3.12" is aspirational; this machine and the future data CI job run
3.10.11). All paths are relative to the repository root unless stated otherwise.

**Ownership:** this runbook grows one section per pipeline task. Task 5 documents the
OSM stage; GTFS, fares, manifest and the phase-1 acceptance run are added in later
tasks.

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

Expected: `13 passed`. Alternatively from the repository root:
`pipelines\.venv\Scripts\python.exe -m pytest pipelines` (also `13 passed`).

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

Expected: prints the URL, the pinned snapshot date and the written byte count
(~584 MB, so allow a few minutes on a slow link). The file goes to `data/build/`,
which is gitignored.

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
| `data/build/osm/ncr.osm.pbf` | Metro Manila clip, complete ways, source header preserved (ODbL) |
| `data/build/osm/coverage.json` | schema-validated coverage report (`pipelines/pipeline/schema.py`) |

Expected console output:

```
route_relations: 2851  by_mode: {'bus': 1425, 'ferry': 1243, 'share_taxi': 76, 'train': 14, 'light_rail': 6, 'subway': 2, 'jeepney': 1}
ptv2_share: 0.9948  data_until: 2026-10-31T21:22:57Z (synthesized taginfo snapshot - NOT a live query)
coverage report: data\build\osm\coverage.json
```

A missing input returns exit code `2` with a one-line error (no traceback); run from
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
routes are inside the bbox and the curated jeepney inventory (Task 7) supplies what
OSM lacks. Expect a few minutes of Python-level scanning for the 584 MB file, a peak
resident memory of roughly **1–3 GB** (the extractor holds the in-bbox node-id sets in
memory), and free disk space for both the 584 MB download and the clip. If the machine
is tight on RAM, raise the bbox precision later or split the clip per LGU — do not
lower the bbox, it is researched (ruling R5).

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
`coverage.json`. It is **not** a live query.

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

Expected `13 passed`, offline. Then confirm the artifacts:

```powershell
Get-ChildItem data\build\osm
pipelines\.venv\Scripts\python.exe -c "import json;d=json.load(open(r'data/build/osm/coverage.json'));print(d['route_relations'], d['ptv2_share'], d['bbox_text'])"
```

---

## 2. Generated artifacts (so far)

| Path | Producer | Commit? | Licence |
|---|---|---|---|
| `data/build/philippines-latest.osm.pbf` | `pipeline.cli download` | **never** (gitignored) | ODbL 1.0 |
| `data/build/osm/ncr.osm.pbf` | `pipeline.cli osm` | **never** (gitignored) | ODbL 1.0 |
| `data/build/osm/coverage.json` | `pipeline.cli osm` | **never** (gitignored) | — (report; derived from ODbL + taginfo stats) |

`data/build/` is ignored explicitly in `.gitignore`. `*.osm.pbf` is ignored too, as a
second line of defence. Never `git add -f` an extract.

## 3. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No module named pipeline` | Run with `$env:PYTHONPATH = "pipelines"` from the repo root, or `cd pipelines` first |
| `error: OSM extract not found` (exit 2) | Run step 1.1, or pass the correct `--pbf` path |
| `coverage.json` reports `ptv2_share: 0.9948` | Expected — it is derived from 1930/1940, not quoted from the note |
| Extract is much smaller than expected | Check the bbox and that the input is the Philippines extract, not a small regional one |
| `osmium: command not found` | Expected on this machine — see §1.3 |
