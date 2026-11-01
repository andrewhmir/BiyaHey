"""Tests for the Task 11 coverage report (spec §3 criterion 7, ruling R29).

The metric: of the curated jeepney / UV Express inventory routes, how many have a
route in the built GTFS feed? The two honesty pins are

* ids compare case-insensitively, because the inventory keeps the published case
  (``jeep-T101``) while the feed carries the lowercased id (``jeep-t101``);
* every route that did not make it is listed with the lowercased id to look for,
  so the missing list is actionable rather than a bare count.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline.cli import main
from pipeline.coverage import compute_coverage, read_feed_route_ids
from pipeline.inventory import MODE_JEEPNEY, InventoryRoute, load_inventory, route_id_for

REPO_ROOT = Path(__file__).resolve().parents[2]
INVENTORY = REPO_ROOT / "data" / "routes" / "jeepney-inventory.yaml"


def inv(code: str) -> InventoryRoute:
    """A minimal curated route with the given code."""
    return InventoryRoute(
        code=code,
        name=f"Route {code}",
        mode=MODE_JEEPNEY,
        endpoints=("Alpha", "Beta"),
        via_roads=(),
        stop_landmarks=("Alpha", "Beta"),
        headway_peak_min=None,
        headway_offpeak_min=None,
        typical_length_km=None,
        operator=None,
        source_url="https://wiki.openstreetmap.org/wiki/Metro_Manila/x",
        needs_verification=True,
    )


def _feed_zip(path: Path, route_ids: list[str]) -> Path:
    """A minimal GTFS zip carrying only the routes table coverage reads."""
    with zipfile.ZipFile(path, "w") as archive:
        rows = "".join(f"{route_id},,,3\n" for route_id in route_ids)
        archive.writestr(
            "routes.txt",
            "route_id,route_short_name,route_long_name,route_type\n" + rows,
        )
    return path


# ---------------------------------------------------------------------------
# compute_coverage
# ---------------------------------------------------------------------------


def test_coverage_reports_missing_inventory_routes():
    report = compute_coverage([inv("T1010"), inv("T9999")], ["jeep-T1010"])

    assert report["total"] == 2
    assert report["modelled"] == 1
    assert report["pct"] == 50.0
    assert report["missing"] == [
        {"code": "T9999", "reason": "no GTFS route jeep-t9999"}
    ]


def test_coverage_compares_ids_case_insensitively():
    """R29: the inventory publishes ``jeep-T1010``; the feed carries ``jeep-t1010``."""
    report = compute_coverage([inv("T1010")], ["JEEP-T1010"])

    assert report == {"total": 1, "modelled": 1, "pct": 100.0, "missing": []}


def test_coverage_reports_all_missing_at_zero_and_rounds_the_percentage():
    none = compute_coverage([inv("T1"), inv("T2"), inv("T3")], [])
    one = compute_coverage([inv("T1"), inv("T2"), inv("T3")], ["jeep-t1"])

    assert none["pct"] == 0.0
    assert [entry["code"] for entry in none["missing"]] == ["T1", "T2", "T3"]
    assert one["pct"] == 33.3
    assert one["modelled"] == 1


def test_coverage_accepts_a_built_feed_object_as_well_as_ids():
    feed = SimpleNamespace(routes=[SimpleNamespace(route_id="jeep-t1010")])

    assert compute_coverage([inv("T1010")], feed)["modelled"] == 1


def test_coverage_rejects_a_bare_route_id_string():
    with pytest.raises(TypeError, match="not a single str"):
        compute_coverage([inv("T1010")], "jeep-t1010")  # type: ignore[arg-type]


def test_coverage_of_the_committed_inventory_reports_every_route():
    """The real inventory has 16 routes; a feed with all of them is 100 %."""
    inventory = load_inventory(INVENTORY)
    feed_ids = [route_id_for(route).lower() for route in inventory]

    report = compute_coverage(inventory, feed_ids)

    assert report["total"] == 16
    assert report["modelled"] == 16
    assert report["pct"] == 100.0
    assert report["missing"] == []


# ---------------------------------------------------------------------------
# read_feed_route_ids / CLI
# ---------------------------------------------------------------------------


def test_read_feed_route_ids_reads_routes_txt_from_the_zip(tmp_path):
    feed = _feed_zip(tmp_path / "gtfs.zip", ["bus-1", "jeep-t101", "rail-3"])

    assert read_feed_route_ids(feed) == ["bus-1", "jeep-t101", "rail-3"]


def test_read_feed_route_ids_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="absent.zip"):
        read_feed_route_ids(tmp_path / "absent.zip")


def test_cli_coverage_passes_at_the_threshold_and_lists_missing(tmp_path, capsys):
    inventory = load_inventory(INVENTORY)
    modelled = [route_id_for(route).lower() for route in inventory][:-4]
    feed = _feed_zip(tmp_path / "gtfs.zip", modelled)

    code = main(
        [
            "coverage",
            "--inventory",
            str(INVENTORY),
            "--feed",
            str(feed),
            "--threshold",
            "60",
        ]
    )

    assert code == 0
    printed = capsys.readouterr().out
    assert "coverage: 12/16 curated routes modelled (75.0%)" in printed
    assert "threshold: 60.0% -> PASS" in printed
    assert "missing: N02" in printed
    assert "no GTFS route uv-n02" in printed


def test_cli_coverage_fails_below_the_threshold(tmp_path, capsys):
    inventory = load_inventory(INVENTORY)
    modelled = [route_id_for(route).lower() for route in inventory][:-4]
    feed = _feed_zip(tmp_path / "gtfs.zip", modelled)

    code = main(
        [
            "coverage",
            "--inventory",
            str(INVENTORY),
            "--feed",
            str(feed),
            "--threshold",
            "90",
        ]
    )

    assert code == 1
    assert "threshold: 90.0% -> FAIL" in capsys.readouterr().out


def test_cli_coverage_json_output_is_machine_readable(tmp_path, capsys):
    inventory = load_inventory(INVENTORY)
    modelled = [route_id_for(route).lower() for route in inventory][:-4]
    feed = _feed_zip(tmp_path / "gtfs.zip", modelled)

    code = main(["coverage", "--inventory", str(INVENTORY), "--feed", str(feed), "--json"])

    assert code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["modelled"] == 12
    assert report["total"] == 16


def test_cli_coverage_missing_feed_is_an_input_error(tmp_path, capsys):
    code = main(
        [
            "coverage",
            "--inventory",
            str(INVENTORY),
            "--feed",
            str(tmp_path / "absent.zip"),
        ]
    )

    assert code == 2
    assert "error:" in capsys.readouterr().err
