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
from pipeline.gtfs import RouteDef
from pipeline.inventory import load_inventory, route_id_for
from pipeline.manifest import BlockedDatasetError
from pipeline.publish import (
    DEFAULT_ALIASES,
    FEED_END,
    FEED_START,
    merge_curated_routes,
    run_stage_publish,
)

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

#: Spec Appendix A CC BY-SA 2.0 literal for the wiki-derived inventory (R32),
#: hardcoded on purpose for the same reason: the constant under test must not
#: vouch for itself.
SPEC_WIKI_ATTRIBUTION = (
    "Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)"
)


@pytest.fixture(scope="module")
def published(tmp_path_factory):
    out = tmp_path_factory.mktemp("publish-run")
    # The live alias file pins OSM feature ids from the real NCR extract, which
    # the miniature fixture does not contain; alias wiring has its own tests
    # below, so the fixture build resolves by exact stop name only.
    report = run_stage_publish(
        PBF,
        out,
        INVENTORY,
        FARES,
        SOURCES,
        None,
        built_at=BUILT_AT,
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


def test_published_zip_states_the_cc_by_sa_inventory_attribution(published):
    """Ruling R32: the artifact itself, not only the manifest, states it."""
    out, report = published

    # wiki-derived routes really are in this feed (10 of the 16 curated routes)
    assert report["curated_routes_modelled"] > 0

    with zipfile.ZipFile(out / "gtfs" / "gtfs.zip") as archive:
        licence = archive.read("LICENSE-DATA.txt").decode("utf-8-sig")

    assert SPEC_WIKI_ATTRIBUTION in licence
    # the ODbL notice is unchanged: both notices, exact spec Appendix A literal
    assert SPEC_APPENDIX_A_ATTRIBUTION in licence
    assert "published under the Open Database License (ODbL) 1.0" in " ".join(
        licence.split()
    )


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
        PBF, second_out, INVENTORY, FARES, SOURCES, None, built_at=BUILT_AT
    )

    first_zip = Path(first["feed"]["path"])
    assert (second_out / "gtfs" / "gtfs.zip").read_bytes() == first_zip.read_bytes()
    assert second["feed"]["sha256"] == first["feed"]["sha256"]


def test_cli_licence_gate_passes_the_published_feed(published, capsys):
    out, _ = published

    assert main(["licence-gate", "--manifest", str(out / "manifest.json")]) == 0
    printed = capsys.readouterr().out
    assert "licence-gate: ok" in printed
    assert "CC BY-SA 2.0" in printed


def test_licence_gate_rejects_a_feed_that_lost_the_cc_by_sa_attribution(
    published, tmp_path, capsys
):
    """R32 negative proof: strip the notice from a copy of the artifact."""
    out, _ = published
    stripped = tmp_path / "gtfs.zip"
    with zipfile.ZipFile(out / "gtfs" / "gtfs.zip") as source, zipfile.ZipFile(
        stripped, "w", zipfile.ZIP_DEFLATED
    ) as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename == "LICENSE-DATA.txt":
                text = payload.decode("utf-8-sig")
                assert SPEC_WIKI_ATTRIBUTION in text  # the strip must be real
                payload = text.replace(f"{SPEC_WIKI_ATTRIBUTION}\n", "").encode(
                    "utf-8-sig"
                )
            target.writestr(info, payload)

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    for dataset in manifest["datasets"]:
        if dataset["id"] == "gtfs":
            dataset["path"] = str(stripped)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert main(["licence-gate", "--manifest", str(manifest_path)]) == 1
    assert "CC BY-SA" in capsys.readouterr().err


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
# Task 11: coverage contract and documented landmark aliases (ruling R34)
# ---------------------------------------------------------------------------


def test_merge_curated_routes_does_not_let_an_unwritable_osm_id_shadow_a_curated_route():
    """R29: OSM wins *because* its geometry is usable; an unwritable id cannot win."""
    osm = [
        RouteDef("bus-b2", 3, "dangling OSM route"),
        RouteDef("jeep-t101", 3, "usable OSM route"),
    ]
    curated = [
        RouteDef("jeep-t101", 3, "curated duplicate"),
        RouteDef("uv-m01", 3, "curated gap filler"),
    ]

    merged = merge_curated_routes(osm, curated, {"jeep-t101"})

    assert [route.route_id for route in merged] == [
        "bus-b2",
        "jeep-t101",
        "uv-m01",
    ]


def test_build_report_carries_the_coverage_contract(published):
    _, report = published
    inventory = load_inventory(INVENTORY)
    coverage = report["coverage"]

    assert coverage["total"] == report["curated_routes_total"]
    assert coverage["pct"] == round(100.0 * coverage["modelled"] / coverage["total"], 1)
    feed_ids = {route_id.casefold() for route_id in report["feed"]["route_ids"]}
    expected_missing = [
        route.code
        for route in inventory
        if route_id_for(route).casefold() not in feed_ids
    ]
    assert [entry["code"] for entry in coverage["missing"]] == expected_missing
    # A route OSM already supplies (the R29 duplicate skip) is covered by the
    # feed even though the curated entry did not enter, so coverage >= curated.
    assert coverage["modelled"] >= report["curated_routes_modelled"]
    skipped = {entry["code"] for entry in report["curated_routes_skipped"]}
    assert {entry["code"] for entry in coverage["missing"]} <= skipped
    for entry in coverage["missing"]:
        assert entry["reason"].startswith(("no GTFS route jeep-", "no GTFS route uv-"))
    # this fixture build resolved by exact stop name only
    assert report["landmark_aliases"] == {
        "path": None,
        "total": 0,
        "used": [],
        "invalid": [],
    }


def test_publish_reports_aliases_that_cannot_apply_to_this_extract(published, tmp_path):
    """A pinned OSM feature absent from the extract is reported, never guessed."""
    _, baseline = published
    out = tmp_path / "aliased"

    report = run_stage_publish(
        PBF, out, INVENTORY, FARES, SOURCES, DEFAULT_ALIASES, built_at=BUILT_AT
    )

    aliases = report["landmark_aliases"]
    assert aliases["path"].endswith("landmark-aliases.yaml")
    assert aliases["total"] > 0
    assert aliases["used"] == []
    assert len(aliases["invalid"]) == aliases["total"]
    # No alias applied, so modelled coverage is exactly the baseline.
    assert report["curated_routes_modelled"] == baseline["curated_routes_modelled"]


def test_publish_applies_a_documented_alias_and_names_the_route(tmp_path):
    inventory = tmp_path / "inventory.yaml"
    inventory.write_text(
        yaml.safe_dump(
            {
                "routes": [
                    {
                        "code": "T9001",
                        "name": "Fixture alias route",
                        "mode": "jeepney",
                        "endpoints": ["Bagong Silang", "Novaliches"],
                        "via_roads": [],
                        "stop_landmarks": ["Bagong Silang", "Novaliches Town"],
                        "headway_peak_min": None,
                        "headway_offpeak_min": None,
                        "typical_length_km": None,
                        "operator": None,
                        "source_url": "https://wiki.openstreetmap.org/wiki/Metro_Manila/x",
                        "needs_verification": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    aliases = tmp_path / "landmark-aliases.yaml"
    aliases.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "aliases": [
                    {
                        "landmark": "Novaliches Town",
                        "osm_stop": "node/5002",
                        "stop_name": "Novaliches",
                        "source": "gtfs stops.txt 1",
                        "note": "fixture alias",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    report = run_stage_publish(
        PBF,
        tmp_path / "out",
        inventory,
        FARES,
        SOURCES,
        aliases,
        built_at=BUILT_AT,
    )

    assert report["curated_routes_modelled"] == 1
    assert report["coverage"] == {
        "total": 1,
        "modelled": 1,
        "pct": 100.0,
        "missing": [],
    }
    assert report["landmark_unresolved"] == []
    used = report["landmark_aliases"]["used"]
    assert used == [
        {
            "landmark": "Novaliches Town",
            "osm_stop": "node/5002",
            "stop_name": "Novaliches",
            "source": "gtfs stops.txt 1",
            "route_codes": ["T9001"],
        }
    ]
    assert report["landmark_aliases"]["invalid"] == []


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
            "--no-aliases",
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
