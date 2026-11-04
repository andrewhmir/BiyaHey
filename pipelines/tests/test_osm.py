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
import os
from pathlib import Path

import osmium
import pytest
from jsonschema import ValidationError

from pipeline.cli import main as cli_main
from pipeline.osm import (
    GEOFABRIK_PH_URL,
    GEOFABRIK_SNAPSHOT_DATE,
    NCR_BBOX,
    CoverageError,
    bbox_text,
    download_geofabrik,
    extract_bbox,
    ncr_bbox,
    parse_coverage,
    resolve_region,
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


# --------------------------------------------------------------------------
# CLI contract: an invalid taginfo snapshot fails fast — exit 2, one stderr
# line, no traceback, and no build directory (the clip never starts)
# --------------------------------------------------------------------------


def test_cli_osm_reports_a_missing_taginfo_before_clipping(tmp_path, capsys):
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
            str(tmp_path / "absent-taginfo.json"),
        ]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "absent-taginfo.json" in captured.err
    assert "Traceback" not in captured.err
    assert len(captured.err.strip().splitlines()) == 1
    # fail-fast contract: the clip never starts, so the build dir is not created
    assert not out_dir.exists()


def test_cli_osm_reports_malformed_taginfo_json_before_clipping(tmp_path, capsys):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"
    taginfo = tmp_path / "broken-taginfo.json"
    taginfo.write_text('{"type_route": {"count": 2851},', encoding="utf-8")

    exit_code = cli_main(
        ["osm", "--pbf", str(source), "--out", str(out_dir), "--taginfo", str(taginfo)]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "invalid taginfo JSON" in captured.err
    assert "broken-taginfo.json" in captured.err
    assert "Traceback" not in captured.err
    assert len(captured.err.strip().splitlines()) == 1
    assert not out_dir.exists()


def test_cli_osm_reports_a_taginfo_shape_error_before_clipping(tmp_path, capsys):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"
    taginfo = tmp_path / "shape-taginfo.json"
    taginfo.write_text(
        json.dumps(
            {
                "data_until": "2026-10-31T21:22:57Z",
                "type_route": {"count": 2851},
                "route_values": [{"value": "bus", "count": 1425}],
                # "ptv2" is missing: this must be a one-line error, not a KeyError traceback
            }
        ),
        encoding="utf-8",
    )

    exit_code = cli_main(
        ["osm", "--pbf", str(source), "--out", str(out_dir), "--taginfo", str(taginfo)]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "invalid taginfo snapshot" in captured.err
    assert "Traceback" not in captured.err
    assert len(captured.err.strip().splitlines()) == 1
    assert not out_dir.exists()


def test_cli_osm_reports_a_taginfo_schema_error_before_clipping(tmp_path, capsys):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"
    taginfo = tmp_path / "schema-taginfo.json"
    taginfo.write_text(
        json.dumps(
            {
                # a date-only timestamp violates the coverage schema's ISO-8601 pattern
                "data_until": "2026-10-31",
                "type_route": {"count": 2851},
                "route_values": [{"value": "bus", "count": 1425}],
                "ptv2": {"relations": 1930, "tagged_relations": 1940},
            }
        ),
        encoding="utf-8",
    )

    exit_code = cli_main(
        ["osm", "--pbf", str(source), "--out", str(out_dir), "--taginfo", str(taginfo)]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "fails the coverage schema" in captured.err
    assert "data_until" in captured.err
    assert "Traceback" not in captured.err
    assert len(captured.err.strip().splitlines()) == 1
    assert not out_dir.exists()


def test_parse_coverage_rejects_a_malformed_taginfo_shape():
    taginfo = {
        "data_until": "2026-10-31T21:22:57Z",
        "type_route": {"count": 3},
        "route_values": [{"value": "bus"}],  # every entry needs a "count"
        "ptv2": {"relations": 1, "tagged_relations": 1},
    }
    with pytest.raises(CoverageError, match="malformed"):
        parse_coverage(taginfo)


# --------------------------------------------------------------------------
# region presets (Task 1): ncr (default), ph (national, never clipped) and an
# explicit bbox:min_lat,min_lon,max_lat,max_lon selector. The ph artifact is
# the downloaded national extract itself, so the stage must not re-clip and
# must not re-download it.
# --------------------------------------------------------------------------


def test_resolve_region_ncr_returns_the_ncr_bbox():
    assert resolve_region("ncr") == ("ncr", NCR_BBOX)


def test_resolve_region_ph_means_do_not_clip():
    assert resolve_region("ph") == ("ph", None)


def test_resolve_region_parses_an_explicit_bbox():
    slug, bbox = resolve_region("bbox:14.0,120.5,15.0,121.5")

    assert slug == "bbox"
    # documented interface order: (min_lat, min_lon, max_lat, max_lon)
    assert bbox == (14.0, 120.5, 15.0, 121.5)
    assert bbox[:2] == (14.0, 120.5)  # lat first, then lon


@pytest.mark.parametrize(
    ("selector", "expected"),
    [
        ("NCR", ("ncr", NCR_BBOX)),
        ("  ncr  ", ("ncr", NCR_BBOX)),
        ("PH", ("ph", None)),
        ("\tPh\n", ("ph", None)),
        # surrounding/embedded whitespace around the numbers is ignored too
        ("BBox: 14.0, 120.5, 15.0, 121.5 ", ("bbox", (14.0, 120.5, 15.0, 121.5))),
    ],
)
def test_resolve_region_is_case_and_whitespace_insensitive(selector, expected):
    # osm.py's docstring promises this: selectors are normalised before matching.
    assert resolve_region(selector) == expected


@pytest.mark.parametrize(
    "region",
    [
        # latitudes must stay within -90..90, longitudes within -180..180
        "bbox:90.5,120.5,91.0,121.5",
        "bbox:-91.0,120.5,-90.5,121.5",
        "bbox:14.0,180.5,15.0,181.5",
        "bbox:14.0,-181.5,15.0,-180.5",
    ],
)
def test_resolve_region_rejects_an_out_of_range_bbox(region):
    with pytest.raises(ValueError) as excinfo:
        resolve_region(region)

    assert "out of range" in str(excinfo.value)
    # the error still names the accepted forms, like every resolver error
    assert "bbox:min_lat,min_lon,max_lat,max_lon" in str(excinfo.value)


@pytest.mark.parametrize(
    "region",
    [
        "mars",
        "bbox:14.0,120.5,15.0",
        "bbox:14.0,120.5,15.0,121.5,122.0",
        "bbox:14.0,120.5,15.0,121.5x",
        # max < min on the latitude axis is not a bbox
        "bbox:15.0,120.5,14.0,121.5",
    ],
)
def test_resolve_region_rejects_unknown_forms_naming_the_accepted_ones(region):
    with pytest.raises(ValueError) as excinfo:
        resolve_region(region)

    message = str(excinfo.value)
    assert "ncr" in message
    assert "ph" in message
    assert "bbox:min_lat,min_lon,max_lat,max_lon" in message


def test_run_stage_osm_region_ph_copies_the_extract_without_clipping(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    report = run_stage_osm(source, out_dir, TAGINFO_FIXTURE, region="ph")

    extract_path = out_dir / "osm" / "ph.osm.pbf"
    assert extract_path.is_file()
    # No bbox filtering: every object survives byte for byte, including the
    # Visayas node 4, way 12 and ferry relation 101 the NCR clip drops.
    assert extract_path.read_bytes() == source.read_bytes()
    assert _read_ids(extract_path) == _read_ids(source)

    written = json.loads(
        (out_dir / "osm" / "coverage.json").read_text(encoding="utf-8")
    )
    validate_coverage(written)
    assert written["region"] == "ph"
    assert written["clip"] is False
    # a national report has no bbox context: nothing was clipped
    assert "bbox" not in written
    assert "bbox_text" not in written
    assert report["region"] == "ph"
    assert report["clip"] is False


def test_run_stage_osm_region_ph_reuses_an_existing_extract_of_the_same_size(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"
    run_stage_osm(source, out_dir, TAGINFO_FIXTURE, region="ph")
    extract_path = out_dir / "osm" / "ph.osm.pbf"

    # A rebuild must not re-copy a ~612 MB extract. Backdate the destination:
    # if the stage copied again, its mtime would move to now.
    stale = 1_000_000_000  # 2001-09-09T01:46:40Z
    os.utime(extract_path, (stale, stale))

    run_stage_osm(source, out_dir, TAGINFO_FIXTURE, region="ph")

    assert extract_path.stat().st_mtime == pytest.approx(stale, abs=0.01)


def test_run_stage_osm_region_ph_recopies_a_stale_extract_of_a_different_size(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"
    extract_path = out_dir / "osm" / "ph.osm.pbf"
    extract_path.parent.mkdir(parents=True)
    extract_path.write_bytes(b"stale truncation")

    run_stage_osm(source, out_dir, TAGINFO_FIXTURE, region="ph")

    assert extract_path.read_bytes() == source.read_bytes()


def test_run_stage_osm_default_region_is_still_ncr(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    report = run_stage_osm(source, out_dir, TAGINFO_FIXTURE)

    assert (out_dir / "osm" / "ncr.osm.pbf").is_file()
    assert not (out_dir / "osm" / "ph.osm.pbf").exists()
    assert report["region"] == "ncr"
    assert report["clip"] is True
    assert report["bbox"] == list(ncr_bbox())


def test_cli_osm_region_ph_writes_the_national_extract(tmp_path):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    exit_code = cli_main(
        [
            "osm",
            "--region",
            "ph",
            "--pbf",
            str(source),
            "--out",
            str(out_dir),
            "--taginfo",
            str(TAGINFO_FIXTURE),
        ]
    )

    assert exit_code == 0
    assert (out_dir / "osm" / "ph.osm.pbf").is_file()
    assert not (out_dir / "osm" / "ncr.osm.pbf").exists()
    written = json.loads(
        (out_dir / "osm" / "coverage.json").read_text(encoding="utf-8")
    )
    assert written["region"] == "ph"
    assert written["clip"] is False


def test_cli_osm_rejects_an_unknown_region_without_writing_anything(tmp_path, capsys):
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    exit_code = cli_main(
        [
            "osm",
            "--region",
            "mars",
            "--pbf",
            str(source),
            "--out",
            str(out_dir),
            "--taginfo",
            str(TAGINFO_FIXTURE),
        ]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "mars" in captured.err
    assert "ncr" in captured.err
    assert "ph" in captured.err
    assert "bbox:min_lat,min_lon,max_lat,max_lon" in captured.err
    assert "Traceback" not in captured.err
    assert len(captured.err.strip().splitlines()) == 1
    assert not out_dir.exists()


def test_cli_osm_does_not_hide_an_internal_stage_value_error(tmp_path, monkeypatch):
    # Fix round 2: only a bad *selector* is user error (exit 2). A ValueError
    # raised inside the stage itself (pyosmium, extract_bbox) is a bug and must
    # surface as a traceback, not be reformatted into the clean exit-2 contract.
    source = _sample_pbf(tmp_path)
    out_dir = tmp_path / "build"

    def explode(*args, **kwargs):
        raise ValueError("internal stage bug")

    monkeypatch.setattr("pipeline.cli.run_stage_osm", explode)

    with pytest.raises(ValueError, match="internal stage bug"):
        cli_main(
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
