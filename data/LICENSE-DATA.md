# Data licences

This file describes the licences of the **data** BiyaHey! ships. The source code
and documentation licences are in the root [`LICENSE`](../LICENSE) (MIT) and
[`README.md`](../README.md).

The machine-readable source of truth is
[`data/provenance/sources.yaml`](provenance/sources.yaml); the reasoning and the
list of datasets that must never ship are in
[`data/provenance/PROVENANCE_NOTES.md`](provenance/PROVENANCE_NOTES.md).

## The generated GTFS feed — ODbL 1.0

`data/build/gtfs/gtfs.zip` (and any published snapshot of it) is a **derived
database** of OpenStreetMap content:

> © OpenStreetMap contributors — data available under the Open Database License
> (ODbL) 1.0. https://opendatacommons.org/licenses/odbl/1-0/

The publish stage writes this notice into `LICENSE-DATA.txt` **inside the zip**,
and the licence gate fails the build if it is missing. ODbL requires attribution
and share-alike for derived databases; keep the notice with any redistributed
feed.

## Curated jeepney/UV inventory — CC BY-SA 2.0

`data/routes/jeepney-inventory.yaml` is derived from the OpenStreetMap Wiki page
[Metro Manila/Jeepney and UV Express routes](https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes),
licensed **CC BY-SA 2.0**:

> Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)

Any GTFS feed derived from that file must state this attribution. The publish
stage writes it into the feed's `LICENSE-DATA.txt` alongside the ODbL notice, and
the licence gate enforces both (rulings R22/R32). The inventory remains a
separate attributed data file in the repository.

## Fares and other government information

`data/fares/*.yaml` transcribes published fare matrices and service terms from
LTFRB, LRTA, LRMC/DOTr–MRT3 and MMDA. These are treated as government public
information without an explicit redistribution grant; the app always shows the
source and effectivity date, and the provenance registry records the exact URL
and last-checked date. They are not relicensed by BiyaHey!.

The LRT-2 fare band is **provisional** (`needs_verification: true`) because no
authoritative per-station table has been transcribed; it is never presented as
official (ruling R47).

## Documentation — CC BY 4.0

`docs/`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and
`AI_DISCLOSURE.md` are documentation and are offered under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Never shipped

Sakay/PTAC 2014 GTFS, BusMaps, Photon/OpenFreeMap runtime dependencies as data,
and any feed without a stated reuse grant are **not** part of the published
artifacts. They are recorded as internal-only exploration in
`data/provenance/PROVENANCE_NOTES.md`; the licence gate fails on a blocked
dataset id.
