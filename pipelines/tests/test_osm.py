"""Tests for pipeline stage 01: OSM bbox extraction and taginfo coverage.

Everything here is offline: inputs are the committed fixtures in
``tests/fixtures/`` (a hand-written mini ``sample_ph.osm`` converted to PBF in
``tmp_path``, and a synthesized ``taginfo_philippines.json`` snapshot). No test
may download the Geofabrik extract or query taginfo; the download path is
covered with an injected fake session.

The brief's original assertion ``cmd[:3] == ["osmium", "extract", "--bbox"]``
is deliberately *not* tested: pyosmium 4.0.2 ships no ``osmium`` executable and
this machine has no ``osmium-tool`` binary, so ``osmium extract --bbox`` cannot
run at all (see ``docs/runbooks/data-build.md`` and the task report). The test
below asserts the interface that actually executes: ``extract_bbox``.
"""

from __future__ import annotations

import json
from pathlib import Path

import osmium
import pytest
from jsonschema import ValidationError

from pipeline.cli import main as cli_main
from pipeline.osm import (
    GEOFABRIK_PH_URL,
    GEOFABRIK_SNAPSHOT_DATE,
    bbox_text,
    download_geofabrik,
    extract_bbox,
    ncr_bbox,
    parse_coverage,
    run_stage_osm,
)
from pipeline.schema import validate_coverage

FIXTURES = Path(__file__).parent / "fixtures"
TAGINFO_FIXTURE = FIXTURES / "taginfo_philippines.json"
# The research note quotes the Geofabrik PH extract as "data to 2026-10-31T21:23Z".
SNAPSHOT_TIMESTAMP = "2026-10-31T21:23:00Z"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _sample_pbf(tmp_path: Path) -> Path:
    """Convert the committed XML fixture to PBF so the extractor is tested on PBF."""
    source = FIXTURES / "sample_ph.osm"
    destination = tmp_path / "sample_ph.osm.pbf"
    header = osmium.io.Header()
    header.set("osmosis_replication_timestamp", SNAPSHOT_TIMESTAMP)
    with osmium.SimpleWriter(str(destination), header=header) as writer:
        for obj in osmium.FileProcessor(str(source)):
            if obj.is_node():
                writer.add_node(obj)
            elif obj.is_way():
                writer.add_way(obj)
            else:
                writer.add_relation(obj)
    return destination


def _read_ids(path: Path) -> tuple[set[int], dict[int, list[int]], dict[int, dict]]:
    nodes: set[int] = set()
    ways: dict[int, list[int]] = {}
    relations: dict[int, dict] = {}
    for obj in osmium.FileProcessor(str(path)):
        if obj.is_node():
            nodes.add(obj.id)
        elif obj.is_way():
            ways[obj.id] = [node.ref for node in obj.nodes]
        else:
            relations[obj.id] = dict(obj.tags)
    return nodes, ways, relations


# --------------------------------------------------------------------------
# bbox (controller rulings R3/R5)
# --------------------------------------------------------------------------


def test_ncr_bbox_is_the_researched_metro_manila_bbox():
    bbox = ncr_bbox()
    assert bbox == (14.35, 120.90, 14.80, 121.15)
    assert isinstance(bbox, tuple) and len(bbox) == 4
    # documented order: (min_lat, min_lon, max_lat, max_lon)
    min_lat, min_lon, max_lat, max_lon = bbox
    assert min_lat < max_lat and min_lon < max_lon


def test_bbox_text_is_lon_lat_order_for_osmium_convention():
    # osmium/GeoJSON use minLon,minLat,maxLon,maxLat; keep the trailing zeros.
    assert bbox_text(ncr_bbox()) == "120.90,14.35,121.15,14.80"


# --------------------------------------------------------------------------
# real, executed BBox extraction (replaces the unrunnable `osmium extract` cmd)
# --------------------------------------------------------------------------


def test_extract_bbox_keeps_inside_objects_and_complete_ways(tmp_path):
    source = _sample_pbf(tmp_path)
    destination = tmp_path / "ncr.osm.pbf"

    stats = extract_bbox(source, ncr_bbox(), destination)

    nodes, ways, relations = _read_ids(destination)

    # nodes 1,2,3 are inside; node 5 is outside but needed by crossing way 11.
    assert nodes == {1, 2, 3, 5}
    # way 10 is fully inside, way 11 crosses the boundary; way 12 is far outside.
    assert ways == {10: [1, 2], 11: [2, 5]}
    # only the relation with an included member survives, tags intact.
    assert set(relations) == {100}
    assert relations[100]["route"] == "bus"
    assert relations[100]["type"] == "route"

    assert (stats.nodes, stats.ways, stats.relations) == (4, 2, 1)


def test_extract_bbox_preserves_the_source_snapshot_timestamp(tmp_path):
    source = _sample_pbf(tmp_path)
    destination = tmp_path / "ncr.osm.pbf"
    extract_bbox(source, ncr_bbox(), destination)

    reader = osmium.io.Reader(str(destination))
    try:
        assert reader.header().get("osmosis_replication_timestamp") == SNAPSHOT_TIMESTAMP
    finally:
        reader.close()


# --------------------------------------------------------------------------
# coverage report from the synthesized taginfo snapshot
# --------------------------------------------------------------------------


def test_coverage_parses_the_committed_taginfo_snapshot():
    taginfo = json.loads(TAGINFO_FIXTURE.read_text(encoding="utf-8"))
    report = parse_coverage(taginfo)

    # exact counts quoted by the research note, mirrored by the fixture
    assert report["route_relations"] == 2851
    assert report["by_mode"]["bus"] == 1425
    assert report["by_mode"]["share_taxi"] == 76
    assert report["by_mode"]["ferry"] == 1243
    assert report["by_mode"]["train"] == 14
    assert report["by_mode"]["light_rail"] == 6
    assert report["by_mode"]["subway"] == 2
    assert report["by_mode"]["jeepney"] == 1
    assert report["data_until"] == "2026-10-31T21:22:57Z"

    # derived: 1930 / 1940, rounded to 4 decimal places
    assert report["ptv2_share"] == 0.9948
    assert 0.99 <= report["ptv2_share"] <= 1.0
    assert report["ptv2_relations"] == 1930
    assert report["ptv2_tagged_relations"] == 1940

    # the snapshot omits the 84 residual route=* relations on purpose
    assert sum(report["by_mode"].values()) <= report["route_relations"]
    assert "synthesized" in report["coverage_source"]

    validate_coverage(report)  # raises jsonschema.ValidationError on drift


def test_coverage_fixture_is_labelled_as_a_snapshot():
    raw = json.loads(TAGINFO_FIXTURE.read_text(encoding="utf-8"))
    assert "synthesized" in raw["_snapshot"]["kind"].lower()
    assert "docs/research/ph-transit-datasets.md" in raw["_snapshot"]["mirrored_from"]
    assert raw["_snapshot"]["captured_on"] == "2026-11-01"
    assert raw["data_until"] == "2026-10-31T21:22:57Z"


def test_validate_coverage_rejects_missing_required_fields():
    with pytest.raises(ValidationError):
        validate_coverage({"by_mode": {}, "ptv2_share": 0.5, "data_until": "2026-10-31"})


def test_validate_coverage_rejects_a_share_above_one():
    with pytest.raises(ValidationError):
        validate_coverage(
            {
                "route_relations": 1,
                "by_mode": {"bus": 1},
                "ptv2_share": 1.5,
                "data_until": "2026-10-31T21:22:57Z",
            }
        )


# --------------------------------------------------------------------------
# download (CLI-only, never exercised against the network)
# --------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.closed = False

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        assert chunk_size > 0
        for chunk in self._chunks:
            yield chunk

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        self.closed = True
        return False


class _FakeSession:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.calls: list[tuple[str, dict]] = []

    def get(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((url, dict(kwargs)))
        return _FakeResponse(self.chunks)


def test_download_uses_the_pinned_geofabrik_url_and_streams_to_disk(tmp_path, capsys):
    session = _FakeSession([b"pbf-", b"bytes"])
    destination = tmp_path / "build" / "philippines-latest.osm.pbf"

    result = download_geofabrik(destination, session=session)

    assert result == destination
    assert destination.read_bytes() == b"pbf-bytes"
    assert session.calls[0][0] == GEOFABRIK_PH_URL
    assert session.calls[0][1].get("stream") is True
    out = capsys.readouterr().out
    assert GEOFABRIK_SNAPSHOT_DATE in out
    assert "2026-10-31" in out


def test_geofabrik_pins_are_the_researched_snapshot():
    assert GEOFABRIK_PH_URL == "https://download.geofabrik.de/asia/philippines-latest.osm.pbf"
    assert GEOFABRIK_SNAPSHOT_DATE == "2026-10-31"


# --------------------------------------------------------------------------
# stage orchestration + CLI
# --------------------------------------------------------------------------


def test_run_stage_osm_writes_extract_and_schema_valid_coverage(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    report = run_stage_osm(source, out_dir, TAGINFO_FIXTURE)

    extract_path = out_dir / "osm" / "ncr.osm.pbf"
    coverage_path = out_dir / "osm" / "coverage.json"
    assert extract_path.is_file()
    assert coverage_path.is_file()

    written = json.loads(coverage_path.read_text(encoding="utf-8"))
    validate_coverage(written)
    assert written["route_relations"] == 2851
    assert written["bbox"] == list(ncr_bbox())
    assert written["bbox_text"] == "120.90,14.35,121.15,14.80"
    assert written["extract"] == {"nodes": 4, "ways": 2, "relations": 1}
    assert report["route_relations"] == written["route_relations"]


def test_cli_osm_stage_runs_offline_against_fixtures(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    exit_code = cli_main(
        [
            "osm",
            "--pbf",
            str(source),
            "--out",
            str(out_dir),
            "--taginfo",
            str(TAGINFO_FIXTURE),
        ]
    )

    assert exit_code == 0
    assert (out_dir / "osm" / "ncr.osm.pbf").is_file()
    assert (out_dir / "osm" / "coverage.json").is_file()


def test_cli_osm_reports_a_missing_pbf_without_a_traceback(tmp_path, capsys):
    exit_code = cli_main(
        [
            "osm",
            "--pbf",
            str(tmp_path / "absent.osm.pbf"),
            "--out",
            str(tmp_path / "build"),
            "--taginfo",
            str(TAGINFO_FIXTURE),
        ]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "absent.osm.pbf" in captured.err
    assert not (tmp_path / "build" / "osm" / "ncr.osm.pbf").exists()
