# Provenance and licensing notes

Spec §8.1 ("the where-it-comes-from requirement") in prose. The machine-readable
source register is [`sources.yaml`](sources.yaml); this file records the decisions
the register cannot express: what is **never shipped**, how the generated GTFS
derives from its sources, and what a reviewer must check before adding a dataset.
It is owned by Task 8 because the licence gate is what enforces it (ruling R22).

Last reviewed: 2026-11-01 (v1 data vintage).

## Never shipped: internal exploration only

The following are **internal exploration material only**. They are not in
`sources.yaml`, they must never be added to a build, and they must never appear
in a published manifest:

| Dataset | Why it is excluded |
|---|---|
| **Sakay / PTAC 2014 GTFS** | No reuse grant. Internal comparison only; the 2014 timetable is also far too old to route on. |
| **BusMaps** | No reuse grant. Internal comparison only. |
| **Any feed without a reuse grant** | The default answer for every unlisted feed. A feed is shippable only once its licence is recorded in `sources.yaml` and permits redistribution. |

Enforcement (not just documentation):

- `pipeline.manifest.BLOCKED_DATASET_IDS` pins the blocked ids
  (`sakay-gtfs`, `ptac-2014`, `busmaps`); ids are compared case- and
  punctuation-insensitively, so `BusMaps`, `bus_maps` and `busmaps` are all
  refused.
- `build_manifest` refuses to build from a blocked source, `publish` runs the
  gate before writing any artifact, and the manifest itself is re-checked before
  it is written.
- `python -m pipeline.cli licence-gate` exits non-zero for a blocked manifest or
  for a registry that names one. CI runs it on every change under `data/` or
  `pipelines/` (`.github/workflows/licence-gate.yml`).
- Tests prove the negative path: a manifest containing `busmaps` raises and the
  CLI exits non-zero (`pipelines/tests/test_manifest.py`).

## Derivation and licence chain

### OpenStreetMap → generated GTFS (ODbL 1.0)

1. `osm` (register id) — the Geofabrik Philippines extract, OpenStreetMap
   contributors, **ODbL 1.0**. The download is explicit (`pipeline.cli download`),
   the NCR extract is clipped locally (`pipeline.cli osm`), and the snapshot date
   is recorded in the runbook.
2. The generated GTFS is a **derived database** of that ODbL content: route
   geometry, stops and stations come from OSM route relations and OSM stop
   features. It is therefore published under **ODbL 1.0**.
3. Every generated `gtfs.zip` carries `LICENSE-DATA.txt` with the exact
   Appendix A attribution:

   > © OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0

4. The manifest records the zip as an `ODbL-1.0` dataset together with its
   sha256 and lists the same attribution in `attributions`. The licence gate
   fails a build that loses either.

### OSM Wiki inventory (CC BY-SA 2.0) — kept as a separate attributed file

`data/routes/jeepney-inventory.yaml` is transcribed by hand from the OSM Wiki
page *Metro Manila/Jeepney and UV Express routes*, which is published under
**CC BY-SA 2.0** (register id `osm-wiki-jeepney`). It stays a separate,
attributed data file in this repository — it is not merged into OSM, and it is
not re-licensed as ODbL.

Routes from that file do enter the generated feed as coarse landmark-only
placeholders when OSM has no measured geometry. Any GTFS derived from the file
therefore **states its CC BY-SA attribution**: `sources.yaml` carries the text
"Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)", the publish
manifest includes it in `attributions`, and the build report lists each curated
route's `source_url` and `needs_verification` flag so no row loses its origin.

The mixing of CC BY-SA inventory with ODbL OSM data in one feed is a known risk
(spec §15). The mitigation is migration: as route relations for these corridors
are surveyed into OSM, the curated placeholder is replaced and the wiki-derived
rows shrink. The CC BY-SA file remains the record of what was transcribed while
any of it is still in use.

### Fares, rail fares, ferry line — government-published information

`ltfrb-fares`, `rail-fares` and `mmda-ferry` are transcribed from government
publications. They are registered as `NOASSERTION`: no redistribution grant is
claimed, and the UI must show the effectivity date and publisher (spec §8.3).
They contribute fare amounts and attribution strings, not geometry.

## What each publish records

`python -m pipeline.cli publish` writes, under the build directory:

- `gtfs/gtfs.zip` — deterministic bytes, ODbL notice inside, fare tables inside;
- `manifest.json` — `{built_at, engine, datasets:[{id, path, sha256,
  licence_spdx}], attributions}` covering the OSM extract, the wiki inventory,
  the fare matrix and the generated zip;
- `build-report.json` — the coverage report: curated routes modelled/skipped,
  unresolved landmarks, OSM routes skipped, curated `source_url` /
  `needs_verification` flags, and `blocked_datasets_checked: true`.

## Reviewer checklist

Before adding or changing a data source:

1. Record it in `sources.yaml` with `licence_spdx`, `licence_url`, attribution
   and coverage; run `npm run validate:data`.
2. If it is not redistributable, **do not register it** — it stays in this file's
   never-shipped list instead.
3. Run `python -m pytest` from `pipelines/` and
   `python -m pipeline.cli licence-gate` (registry mode) from the repository root.
4. For a build, run `publish` and check `build-report.json` plus
   `manifest.json` before distributing the zip.
