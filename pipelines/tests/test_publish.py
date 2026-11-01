"""End-to-end tests for the Task 8 publish stage (rulings R29/R30, spec 8.2 stage 05).

Everything is offline: the OSM input is the committed miniature fixture
``tests/fixtures/publish_ncr.osm``, and the curated inventory, fare matrix and
provenance registry are the real committed files. The build report these tests
pin is the coverage report Task 11 consumes.

What the fixture demonstrates:

* named stop features that resolve 10 of the 16 curated inventory routes;
* a curated landmark whose diacritics differ from OSM ("Biñan Población" vs
  "Binan Poblacion"), resolved by normalisation, not by guessing;
* routes with genuinely unmapped landmarks, which must appear in
  ``landmark_unresolved`` instead of disappearing;
* an OSM relation whose id is ``jeep-t101`` colliding with curated ``T101``
  after the ruling R29 lowercasing - OSM must win and the curated duplicate must
  be reported, never both admitted.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
import yaml

from pipeline.cli import main
from pipeline.fares import FARE_ATTRIBUTES_FILENAME, FARE_RULES_FILENAME
from pipeline.inventory import load_inventory
from pipeline.manifest import BlockedDatasetError
from pipeline.publish import FEED_END, FEED_START, run_stage_publish

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures"
PBF = FIXTURES / "publish_ncr.osm"
INVENTORY = REPO_ROOT / "data" / "routes" / "jeepney-inventory.yaml"
FARES = REPO_ROOT / "data" / "fares" / "fares-2026-09-28.yaml"
SOURCES = REPO_ROOT / "data" / "provenance" / "sources.yaml"

BUILT_AT = "2026-11-01T00:00:00Z"

#: Spec Appendix A literal, hardcoded on purpose (never imported from the code
#: under test). Task 6 pins it too; the publish stage must not lose it.
SPEC_APPENDIX_A_ATTRIBUTION = (
    "© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0"
)


@pytest.fixture(scope="module")
def published(tmp_path_factory):
    out = tmp_path_factory.mktemp("publish-run")
    report = run_stage_publish(
        PBF, out, INVENTORY, FARES, SOURCES, built_at=BUILT_AT
    )
    return out, report


def _csv_rows(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    text = archive.read(name).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


# ---------------------------------------------------------------------------
# artifacts and the manifest
# ---------------------------------------------------------------------------


def test_publish_writes_the_zip_manifest_and_build_report(published):
    out, report = published

    assert (out / "gtfs" / "gtfs.zip").is_file()
    assert (out / "manifest.json").is_file()
    assert (out / "build-report.json").is_file()

    on_disk = json.loads((out / "build-report.json").read_text(encoding="utf-8"))
    assert on_disk == report
    assert report["built_at"] == BUILT_AT


def test_manifest_records_the_zip_hash_datasets_and_attributions(published):
    out, _ = published
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    zip_sha = hashlib.sha256((out / "gtfs" / "gtfs.zip").read_bytes()).hexdigest()

    assert manifest["built_at"] == BUILT_AT
    assert manifest["engine"] == {"name": "motis", "version": "v2.11.4"}

    datasets = {dataset["id"]: dataset for dataset in manifest["datasets"]}
    assert {"osm", "osm-wiki-jeepney", "ltfrb-fares", "gtfs"} <= set(datasets)
    assert datasets["gtfs"]["sha256"] == zip_sha
    assert datasets["gtfs"]["licence_spdx"] == "ODbL-1.0"  # derived database
    assert datasets["osm"]["licence_spdx"] == "ODbL-1.0"
    assert datasets["osm-wiki-jeepney"]["licence_spdx"] == "CC-BY-SA-2.0"
    assert datasets["osm"]["sha256"] == hashlib.sha256(PBF.read_bytes()).hexdigest()

    assert SPEC_APPENDIX_A_ATTRIBUTION in manifest["attributions"]
    assert any("CC BY-SA 2.0" in text for text in manifest["attributions"])


def test_zip_contains_the_fare_tables_and_keeps_the_odbl_licence(published):
    out, _ = published

    with zipfile.ZipFile(out / "gtfs" / "gtfs.zip") as archive:
        names = set(archive.namelist())
        assert {FARE_ATTRIBUTES_FILENAME, FARE_RULES_FILENAME, "LICENSE-DATA.txt"} <= names

        licence = archive.read("LICENSE-DATA.txt").decode("utf-8-sig")
        assert SPEC_APPENDIX_A_ATTRIBUTION in licence
        assert "published under the Open Database License (ODbL) 1.0" in " ".join(
            licence.split()
        )

        fares = _csv_rows(archive, FARE_ATTRIBUTES_FILENAME)
        rules = _csv_rows(archive, FARE_RULES_FILENAME)
        routes = _csv_rows(archive, "routes.txt")

        route_ids = {row["route_id"] for row in routes}
        fare_ids = {row["fare_id"] for row in fares}
        assert len(fares) == 6
        assert {"jeepney-traditional", "city-bus-ordinary", "ferry-pasig-river"} <= fare_ids
        assert rules
        assert {row["fare_id"] for row in rules} <= fare_ids
        assert {row["route_id"] for row in rules} <= route_ids
        # rail fares live in data/fares/rail-tables.yaml; UV Express is per-km.
        # Neither can be a flat GTFS fare, so neither gets a rule.
        assert all(not row["route_id"].startswith(("rail-", "uv-")) for row in rules)


# ---------------------------------------------------------------------------
# the coverage report (Task 11 consumes this)
# ---------------------------------------------------------------------------


def test_build_report_counts_curated_and_osm_coverage(published):
    _, report = published
    inventory = load_inventory(INVENTORY)

    assert report["curated_routes_total"] == len(inventory)
    assert report["curated_routes_modelled"] == (
        report["curated_routes_total"] - len(report["curated_routes_skipped"])
    )
    assert report["curated_routes_modelled"] >= 10

    assert report["osm_routes_total"] == 5
    assert report["oms_routes_total"] == report["osm_routes_total"]  # brief's spelling
    assert report["osm_routes_skipped"] == 1  # bus-b2: dangling way only
    assert report["oms_routes_skipped"] == report["osm_routes_skipped"]

    assert report["blocked_datasets_checked"] is True
    assert report["feed"]["start_date"] == FEED_START.isoformat()
    assert report["feed"]["end_date"] == FEED_END.isoformat()


def test_curated_routes_are_lowercased_and_merged_case_insensitively(published):
    """Ruling R29: ``jeep-T101`` and ``jeep-t101`` can never both enter the feed."""
    out, report = published
    feed_ids = report["feed"]["route_ids"]

    assert "jeep-t101" in feed_ids  # the OSM relation, lowercased by its slug
    assert all(route_id == route_id.lower() for route_id in feed_ids)
    assert len(feed_ids) == len({route_id.casefold() for route_id in feed_ids})

    skipped = {entry["code"]: entry["reason"] for entry in report["curated_routes_skipped"]}
    assert "T101" in skipped
    assert "duplicate" in skipped["T101"].lower()
    assert "jeep-t101" in skipped["T101"]

    # every curated route that did enter the feed did so under a lowercased id
    records = {record["code"]: record for record in report["curated_routes"]}
    assert records["T109"]["route_id"] == "jeep-t109"
    assert records["T109"]["route_id"] in feed_ids

    # stop ids are namespaced by the lowercased route id (no case split)
    with zipfile.ZipFile(out / "gtfs" / "gtfs.zip") as archive:
        stops = _csv_rows(archive, "stops.txt")
    assert all(row["stop_id"].split(":", 1)[0] in feed_ids for row in stops)


def test_unresolved_landmarks_are_reported_not_dropped(published):
    _, report = published
    unresolved = {
        (entry["route_code"], entry["landmark"]) for entry in report["landmark_unresolved"]
    }

    assert ("T448", "Spectrum Midway") in unresolved
    assert ("T448", "Zapote Kabila Terminal") in unresolved
    assert ("110", "Quirino Highway") in unresolved

    skipped = {entry["code"]: entry["reason"] for entry in report["curated_routes_skipped"]}
    assert "T448" in skipped
    assert "Spectrum Midway" in skipped["T448"]
    assert "T109" not in skipped  # fully resolved, it must not be listed


def test_curated_provenance_flags_are_preserved_in_the_report(published):
    _, report = published
    records = {record["code"]: record for record in report["curated_routes"]}

    for code, record in records.items():
        assert record["source_url"].startswith(
            "https://wiki.openstreetmap.org/wiki/Metro_Manila/"
        ), code
        assert record["needs_verification"] is True, code

    assert records["T109"]["status"] == "modelled"
    assert records["T448"]["status"] == "skipped"


def test_report_lists_the_datasets_and_attributions_used(published):
    _, report = published

    assert {"osm", "osm-wiki-jeepney", "ltfrb-fares", "gtfs"} <= set(report["datasets_used"])
    assert SPEC_APPENDIX_A_ATTRIBUTION in report["attributions"]
    assert report["fare_tables"]["fare_attributes_rows"] == 6
    assert report["fare_tables"]["fare_rules_rows"] > 0
    assert {entry["fare_id"] for entry in report["fare_tables"]["unrepresentable"]} == {
        "uv-express-traditional",
        "uv-express-modern",
        "p2p-premium",
    }


# ---------------------------------------------------------------------------
# reproducibility and refusal paths
# ---------------------------------------------------------------------------


def test_publish_is_reproducible(published, tmp_path):
    _, first = published
    second_out = tmp_path / "second"
    second = run_stage_publish(
        PBF, second_out, INVENTORY, FARES, SOURCES, built_at=BUILT_AT
    )

    first_zip = Path(first["feed"]["path"])
    assert (second_out / "gtfs" / "gtfs.zip").read_bytes() == first_zip.read_bytes()
    assert second["feed"]["sha256"] == first["feed"]["sha256"]


def test_publish_refuses_a_blocked_sources_registry(tmp_path):
    registry = yaml.safe_load(SOURCES.read_text(encoding="utf-8"))
    registry["sources"].append(
        {
            "id": "busmaps",
            "name": "BusMaps",
            "publisher": "BusMaps",
            "url": "https://example.invalid",
            "licence_spdx": "NOASSERTION",
            "licence_url": "https://example.invalid",
            "coverage": "internal exploration only",
            "last_checked": "2026-11-01",
            "attribution": "BusMaps - internal exploration only, never shipped",
            "used_for": ["internal exploration"],
        }
    )
    bad_sources = tmp_path / "sources.yaml"
    bad_sources.write_text(yaml.safe_dump(registry), encoding="utf-8")
    out = tmp_path / "blocked-out"

    with pytest.raises(BlockedDatasetError, match="busmaps"):
        run_stage_publish(PBF, out, INVENTORY, FARES, bad_sources, built_at=BUILT_AT)

    assert not (out / "manifest.json").exists()
    assert not (out / "gtfs" / "gtfs.zip").exists()


def test_publish_requires_the_osm_extract(tmp_path):
    with pytest.raises(FileNotFoundError, match="ncr.osm.pbf"):
        run_stage_publish(
            tmp_path / "ncr.osm.pbf",
            tmp_path / "out",
            INVENTORY,
            FARES,
            SOURCES,
            built_at=BUILT_AT,
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_publish_runs_the_stage(tmp_path, capsys):
    out = tmp_path / "build"
    code = main(
        [
            "publish",
            "--pbf",
            str(PBF),
            "--out",
            str(out),
            "--inventory",
            str(INVENTORY),
            "--fares",
            str(FARES),
            "--sources",
            str(SOURCES),
            "--built-at",
            BUILT_AT,
        ]
    )

    assert code == 0
    assert (out / "gtfs" / "gtfs.zip").is_file()
    assert (out / "manifest.json").is_file()
    printed = capsys.readouterr().out
    assert "gtfs.zip" in printed
    assert "manifest.json" in printed
