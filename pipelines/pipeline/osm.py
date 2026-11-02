"""OSM stage: download the Geofabrik PH extract, clip it to the NCR bbox, report coverage.

Why the bbox clipping is Python and not ``osmium extract --bbox``
-----------------------------------------------------------------
Verified on this machine (2026-11-01) before implementing:

* ``pip install -r pipelines/requirements.txt`` installs **pyosmium 4.0.2**, which
  ships no ``osmium`` console script at all — only ``pyosmium-get-changes`` and
  ``pyosmium-up-to-date`` appear in ``pipelines/.venv/Scripts/``.
* ``osmium`` is not on ``PATH`` (``where.exe osmium`` finds nothing) and no
  ``osmium-tool`` binary is installed (no Chocolatey/Scoop package).
* Therefore ``osmium extract --bbox ...`` cannot execute here, and asserting it
  would be asserting an unexecuted command.

The clipping below uses pyosmium's ``FileProcessor`` + ``SimpleWriter`` and is
what ``tests/test_osm.py`` actually runs against a committed fixture. If
``osmium-tool`` becomes available, it is a drop-in replacement: the equivalent
command is ``osmium extract --bbox <bbox_text> -o <out> <pbf>`` with
``bbox_text()`` (lon,lat,lon,lat — controller ruling R5).

Algorithm — three streaming passes over the source file
-------------------------------------------------------
1. nodes: keep the ids whose location is inside the bbox;
2. ways + relations: keep ways with at least one kept node and every node they
   reference (complete ways); keep relations with at least one kept node or way
   member. This pass relies on the canonical OSM sort (nodes, ways, relations)
   that every Geofabrik extract has, so relation decisions see the final way set;
3. write the kept objects, copying the source file header (which carries
   ``osmosis_replication_timestamp``, i.e. the snapshot date).

Known limitations, deliberately accepted for v1: relation members outside the
bbox are written as dangling references (a partial extract), and a way that
crosses the boundary keeps all its nodes. A boundary-crossing route therefore
keeps only its in-bbox geometry; NCR v1 routes are inside the bbox, and the
curated jeepney inventory (Task 7) supplies what OSM lacks.

The download is a separate, explicit CLI action (``python -m pipeline.cli
download``). Importing this module never touches the network, and no test
downloads anything.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Set, Tuple

import osmium

from .schema import validate_coverage

#: Geofabrik's always-latest Philippines extract (ODbL 1.0). Pinned by URL only:
#: the file itself is refreshed ~daily, so the *snapshot* is recorded separately.
GEOFABRIK_PH_URL = "https://download.geofabrik.de/asia/philippines-latest.osm.pbf"

#: Snapshot the research note verified: Geofabrik PH data to 2026-10-31T21:23Z
#: (docs/research/ph-transit-datasets.md §1 row 1.1). Re-check before an
#: acceptance run; the runbook records the date of every build.
GEOFABRIK_SNAPSHOT_DATE = "2026-10-31"
GEOFABRIK_SNAPSHOT_TIMESTAMP = "2026-10-31T21:23:00Z"

#: Metro Manila bbox researched in docs/research/ph-transit-datasets.md §1 row 1.5.
#: Order is (min_lat, min_lon, max_lat, max_lon) — NOT osmium's text order;
#: use :func:`bbox_text` when an osmium/GeoJSON string is needed (ruling R5).
NCR_BBOX: Tuple[float, float, float, float] = (14.35, 120.90, 14.80, 121.15)

BBox = Tuple[float, float, float, float]

_DOWNLOAD_CHUNK_SIZE = 1 << 20  # 1 MiB


class CoverageError(ValueError):
    """The taginfo snapshot does not have the shape the coverage parser needs."""


@dataclass(frozen=True)
class ExtractStats:
    """Number of objects written to the clipped extract."""

    nodes: int
    ways: int
    relations: int


def ncr_bbox() -> BBox:
    """Return the researched Metro Manila bbox as (min_lat, min_lon, max_lat, max_lon)."""
    return NCR_BBOX


def bbox_text(bbox: BBox) -> str:
    """Render a bbox in osmium/GeoJSON order: minLon,minLat,maxLon,maxLat (ruling R5).

    >>> bbox_text(ncr_bbox())
    '120.90,14.35,121.15,14.80'
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    return f"{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}"


def _inside(location: "osmium.osm.Location", bbox: BBox) -> bool:
    """True when a node location is inside the bbox (invalid locations are outside)."""
    if not location.valid():
        return False
    min_lat, min_lon, max_lat, max_lon = bbox
    return (
        min_lat <= location.lat <= max_lat
        and min_lon <= location.lon <= max_lon
    )


def extract_bbox(source: Path, bbox: BBox, destination: Path) -> ExtractStats:
    """Clip an OSM file to ``bbox``, keeping complete ways.

    Args:
        source: ``.osm.pbf`` (or any osmium-readable OSM file) to clip.
        bbox: ``(min_lat, min_lon, max_lat, max_lon)``.
        destination: output path; its parent directories are created. The format
            follows the suffix (``.osm.pbf`` recommended).

    Returns:
        Counts of the nodes, ways and relations written.

    Raises:
        FileNotFoundError: if ``source`` does not exist.
    """
    source = Path(source)
    destination = Path(destination)
    if not source.is_file():
        raise FileNotFoundError(f"OSM extract not found: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)

    # Pass 1 — node ids inside the bbox.
    inside: Set[int] = set()
    for node in osmium.FileProcessor(str(source), osmium.osm.NODE):
        if _inside(node.location, bbox):
            inside.add(node.id)

    # Pass 2 — ways touching those nodes (complete ways) and relations touching either.
    needed_nodes: Set[int] = set(inside)
    way_ids: Set[int] = set()
    relation_ids: Set[int] = set()
    for obj in osmium.FileProcessor(str(source), osmium.osm.WAY | osmium.osm.RELATION):
        if obj.is_way():
            refs = [nd.ref for nd in obj.nodes]
            if any(ref in inside for ref in refs):
                way_ids.add(obj.id)
                needed_nodes.update(refs)
            continue
        for member in obj.members:
            if (member.type == "n" and member.ref in needed_nodes) or (
                member.type == "w" and member.ref in way_ids
            ):
                relation_ids.add(obj.id)
                break

    # Pass 3 — copy the kept objects, preserving the source header.
    stats = {"nodes": 0, "ways": 0, "relations": 0}
    header = osmium.FileProcessor(str(source)).header
    with osmium.SimpleWriter(str(destination), header=header) as writer:
        for obj in osmium.FileProcessor(str(source)):
            if obj.is_node():
                if obj.id in needed_nodes:
                    writer.add_node(obj)
                    stats["nodes"] += 1
            elif obj.is_way():
                if obj.id in way_ids:
                    writer.add_way(obj)
                    stats["ways"] += 1
            elif obj.id in relation_ids:
                writer.add_relation(obj)
                stats["relations"] += 1

    return ExtractStats(**stats)


def parse_coverage(taginfo: Mapping[str, Any]) -> Dict[str, Any]:
    """Turn a taginfo snapshot into the coverage report consumed by the pipeline.

    The snapshot shape is documented in ``tests/fixtures/taginfo_philippines.json``:
    ``type_route.count`` (type=route relations), ``route_values[]`` (route=* value
    counts) and ``ptv2`` (public_transport:version=2 relations out of relations
    carrying the tag at all). ``ptv2_share`` is derived from those counts and
    rounded to 4 decimal places; every other count is exact.

    Raises:
        CoverageError: if a required field is missing or inconsistent.
        jsonschema.ValidationError: if the assembled report fails
            :func:`pipeline.schema.validate_coverage` (validated before returning).
    """
    try:
        data_until = str(taginfo["data_until"])
        route_relations = int(taginfo["type_route"]["count"])
        route_values = list(taginfo["route_values"])
        ptv2 = taginfo["ptv2"]
        ptv2_relations = int(ptv2["relations"])
        ptv2_tagged = int(ptv2["tagged_relations"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CoverageError(
            f"taginfo snapshot is missing a required field: {exc!r}"
        ) from exc

    if route_relations < 0 or ptv2_relations < 0 or ptv2_tagged < 0:
        raise CoverageError("taginfo snapshot contains a negative count")
    if ptv2_relations > ptv2_tagged:
        raise CoverageError(
            f"ptv2 relations ({ptv2_relations}) exceed tagged relations ({ptv2_tagged})"
        )

    by_mode: Dict[str, int] = {}
    for entry in route_values:
        try:
            mode = str(entry["value"])
            count = int(entry["count"])
        except (KeyError, TypeError, ValueError) as exc:
            raise CoverageError(
                f"taginfo route value entry is malformed: {entry!r}"
            ) from exc
        if count < 0:
            raise CoverageError(f"negative count for route={mode}")
        by_mode[mode] = count

    snapshot = taginfo.get("_snapshot") or {}
    coverage_source = str(snapshot.get("kind") or "unspecified taginfo snapshot")

    report: Dict[str, Any] = {
        "route_relations": route_relations,
        "by_mode": by_mode,
        "ptv2_share": round(ptv2_relations / ptv2_tagged, 4) if ptv2_tagged else 0.0,
        "ptv2_relations": ptv2_relations,
        "ptv2_tagged_relations": ptv2_tagged,
        "data_until": data_until,
        "coverage_source": coverage_source,
    }
    # The contract is schema-first: no caller ever receives an invalid report.
    validate_coverage(report)
    return report


def download_geofabrik(
    dest: Path,
    *,
    session: Optional[Any] = None,
    chunk_size: int = _DOWNLOAD_CHUNK_SIZE,
) -> Path:
    """Download the pinned Philippines extract (network — CLI only, never in tests).

    Args:
        dest: destination file; parent directories are created.
        session: optional object with ``requests``-like ``get(url, stream=True)``.
            Injected by the test suite with a fake so tests stay offline.
        chunk_size: streaming chunk size in bytes.

    Returns:
        The destination path.
    """
    import requests  # imported lazily so the offline stage never needs the network stack

    destination = Path(dest)
    destination.parent.mkdir(parents=True, exist_ok=True)
    client = session if session is not None else requests.Session()

    print(f"downloading {GEOFABRIK_PH_URL}")
    print(
        "  snapshot: Geofabrik PH extract with data to "
        f"{GEOFABRIK_SNAPSHOT_DATE} (research note 1.1)"
    )
    with client.get(GEOFABRIK_PH_URL, stream=True, timeout=60) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    handle.write(chunk)

    print(f"  written:  {destination} ({destination.stat().st_size} bytes)")
    return destination


def run_stage_osm(pbf: Path, out_dir: Path, taginfo_path: Path) -> Dict[str, Any]:
    """Run the offline half of the OSM stage: clip to NCR and write the coverage report.

    Writes ``<out_dir>/osm/ncr.osm.pbf`` and ``<out_dir>/osm/coverage.json``
    (schema-validated before it is written) and returns the report.

    The taginfo snapshot is read, parsed and schema-validated **before** the clip
    runs. With the real 584 MB extract the clip costs minutes, so a typo, malformed
    JSON or a stale snapshot shape must fail in milliseconds and before anything is
    written under ``out_dir``.

    Raises:
        FileNotFoundError: if the extract or the taginfo snapshot is missing.
        json.JSONDecodeError: if the snapshot is not valid JSON.
        CoverageError: if the snapshot does not have the expected shape.
        jsonschema.ValidationError: if the snapshot cannot produce a valid report.
    """
    pbf = Path(pbf)
    out_dir = Path(out_dir)
    taginfo_path = Path(taginfo_path)

    if not pbf.is_file():
        raise FileNotFoundError(
            f"OSM extract not found: {pbf} "
            "(download it first: python -m pipeline.cli download --dest <pbf>)"
        )
    if not taginfo_path.is_file():
        raise FileNotFoundError(f"taginfo snapshot not found: {taginfo_path}")

    # Fail fast: the snapshot is cheap to validate, the clip is not. Parse and
    # validate it first so an invalid snapshot never starts the extraction.
    coverage = parse_coverage(json.loads(taginfo_path.read_text(encoding="utf-8")))

    extract_path = out_dir / "osm" / "ncr.osm.pbf"
    stats = extract_bbox(pbf, ncr_bbox(), extract_path)

    report: Dict[str, Any] = {
        **coverage,
        "bbox": list(ncr_bbox()),
        "bbox_text": bbox_text(ncr_bbox()),
        "output": str(extract_path),
        "extract": {
            "nodes": stats.nodes,
            "ways": stats.ways,
            "relations": stats.relations,
        },
    }
    validate_coverage(report)

    coverage_path = extract_path.parent / "coverage.json"
    coverage_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report
