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

from pipeline import publish as publish_module
from pipeline.cli import main
from pipeline.coverage import compute_coverage, read_feed_route_ids
from pipeline.fares import FARE_ATTRIBUTES_FILENAME, FARE_RULES_FILENAME
from pipeline.gtfs import RouteDef
from pipeline.inventory import load_inventory, route_id_for
from pipeline.manifest import BlockedDatasetError
from pipeline.publish import (
    COVERAGE_REGIONAL_FILENAME,
    DEFAULT_ALIASES,
    FEED_END,
    FEED_START,
    TRICYCLE_TERMINALS_FILENAME,
    UNSUPPORTED_RAIL_ROUTE_IDS,
    exclude_unsupported_routes,
    merge_curated_routes,
    run_stage_publish,
    unsupported_route_reason,
)
from pipeline.regions import REGION_NAMES, REGION_ROLLUPS, UNASSIGNED

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
    # bus-b2 (dangling shape) and the non-PRFS fixture ferry are the two
    # relations the feed does not carry; the ferry is excluded by policy before
    # the builder sees it (final-review item 7).
    assert report["osm_routes_skipped"] == 2
    assert report["oms_routes_skipped"] == report["osm_routes_skipped"]
    assert report["excluded_routes_total"] == 1
    assert report["excluded_routes"] == [
        {
            "route_id": "ferry-pasig",
            "reason": "unsupported ferry: not the free MMDA Pasig River Ferry (PRFS)",
        }
    ]

    assert report["blocked_datasets_checked"] is True
    assert report["feed"]["start_date"] == FEED_START.isoformat()
    assert report["feed"]["end_date"] == FEED_END.isoformat()


def test_mode_gate_excludes_unsupported_rail_and_ferry_families():
    """Final-review item 7: only priceable rail/ferry families reach the feed."""
    for route_id in ("rail-ss", "rail-mnc", "rail-mrt9"):
        assert unsupported_route_reason(route_id) is not None, route_id
    assert "rail-ss" in UNSUPPORTED_RAIL_ROUTE_IDS
    for route_id in ("ferry-manilacoron", "ferry-maniladavaocitygeneralsantosiloilomanila"):
        assert "not the free MMDA" in (unsupported_route_reason(route_id) or ""), route_id

    # Priceable families stay untouched.
    for route_id in (
        "rail-1",
        "rail-2",
        "rail-3",
        "rail-mrt3",
        "bus-b1",
        "jeep-t101",
        "uv-c20",
        "ferry-prfsguadelupeescolta",
    ):
        assert unsupported_route_reason(route_id) is None, route_id

    prices = [
        RouteDef(route_id="bus-b1", route_type=3, name="B1"),
        RouteDef(route_id="rail-ss", route_type=2, name="PNR"),
        RouteDef(route_id="ferry-prfsescoltapinagbuhatan", route_type=4, name="PRFS"),
        RouteDef(route_id="ferry-manilacoron", route_type=4, name="Manila-Coron"),
    ]
    kept, excluded = exclude_unsupported_routes(prices)
    assert [route.route_id for route in kept] == [
        "bus-b1",
        "ferry-prfsescoltapinagbuhatan",
    ]
    assert [entry["route_id"] for entry in excluded] == ["rail-ss", "ferry-manilacoron"]
    assert all(entry["reason"] for entry in excluded)


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


def test_build_report_carries_the_osm_ingest_counters(published):
    """The reader's national counters must reach ``build-report.json``.

    Lane A R30/R31/R32: the reviewer found the R19 counters were not exposed in
    the published report, so a route lost by the id assignment could not be seen
    in the artifact. This pins the whole ingest accounting block for a fixture
    build, including the per-reason skipped-member breakdown the builder keeps.
    """
    _, report = published
    ingest = report["osm_ingest"]

    assert ingest["relations_read"] == 5
    assert ingest["route_relations"] == 5
    assert ingest["unsupported_route"] == 0
    assert ingest["relations_without_name"] == 0
    assert ingest["candidates"] == 5
    assert ingest["accepted"] == 5
    assert ingest["route_id_collisions"] == 0
    assert ingest["routes_renamed_collision"] == 0
    assert ingest["routes_skipped_duplicate_direction"] == 0
    assert ingest["groups_without_feed_ready_keeper"] == 0
    # the per-reason skip breakdown travels with the counters
    assert ingest["skipped_members"] == 1
    assert ingest["skipped_member_reasons"] == {"dangling_way": 1}

    # the builder's own skip accounting is in the same report
    build = report["build_stats"]
    for key in (
        "routes_in",
        "routes_written",
        "routes_skipped_no_geometry",
        "routes_skipped_too_few_stops",
        "routes_skipped_duplicate_id",
        "dangling_members",
        "shapes_trimmed",
        "shapes_untrimmed_stop_not_found",
        "two_point_shapes",
    ):
        assert key in build
    assert build["dangling_members"] == 1
    assert build["routes_skipped_no_geometry"] == 1  # bus-b2's way is dangling


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


# ---------------------------------------------------------------------------
# Task 3: regional coverage artifact and the landmarks extract (ruling R17)
# ---------------------------------------------------------------------------


def test_publish_writes_the_regional_coverage_artifact(published):
    out, report = published
    artifact_path = out / COVERAGE_REGIONAL_FILENAME
    assert artifact_path.is_file()

    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    inventory = load_inventory(INVENTORY)
    # The acceptance definition: the artifact's `curated` block is exactly the
    # coverage of the feed written to disk, not a second implementation.
    expected = compute_coverage(
        inventory, read_feed_route_ids(out / "gtfs" / "gtfs.zip")
    )
    assert artifact["curated"] == expected
    assert artifact["curated"] == report["coverage"]

    assert artifact["feed"]["routes"] == report["feed"]["routes"]
    assert artifact["feed"]["stops"] == report["feed"]["stops"]
    assert artifact["feed"]["trips"] == report["feed"]["trips"]
    assert artifact["feed"]["sha256"] == report["feed"]["sha256"]

    regional = artifact["regional"]
    assert regional["totals"] == {
        "routes": report["feed"]["routes"],
        "stops": report["feed"]["stops"],
        "trips": report["feed"]["trips"],
    }
    assert set(regional["by_region"]) == set(REGION_NAMES) | {UNASSIGNED}
    assert (
        sum(entry["stops"] for entry in regional["by_region"].values())
        == report["feed"]["stops"]
    )
    for group, regions in REGION_ROLLUPS.items():
        for metric in ("routes", "stops", "trips"):
            assert regional["by_island_group"][group][metric] == sum(
                regional["by_region"][region][metric] for region in regions
            )
    # The committed fixture is an NCR extract, so its stops must land in NCR.
    assert regional["by_region"]["NCR"]["stops"] > 0


def _spy_on_named_stops(monkeypatch):
    """Record every extract the landmark pass reads; return the list."""
    seen = []
    real = publish_module.load_named_stops

    def spy(path):
        seen.append(Path(path))
        return real(Path(path))

    monkeypatch.setattr(publish_module, "load_named_stops", spy)
    return seen


def test_publish_reads_landmarks_from_the_main_extract_by_default(
    tmp_path, monkeypatch
):
    """NCR build unchanged: the default landmarks extract is the --pbf one."""
    seen = _spy_on_named_stops(monkeypatch)

    run_stage_publish(
        PBF,
        tmp_path / "default",
        INVENTORY,
        FARES,
        SOURCES,
        None,
        built_at=BUILT_AT,
    )

    assert seen == [PBF]


def test_publish_reads_landmarks_from_an_explicit_extract(tmp_path, monkeypatch):
    """R17: a national build can point the landmark pass at the NCR clip."""
    seen = _spy_on_named_stops(monkeypatch)
    # Keep the fixture's XML format: pyosmium dispatches on the extension, and
    # a .pbf filename over OSM XML is an invalid BlobHeader, not a fixture.
    landmarks = tmp_path / "ncr-clip.osm"
    landmarks.write_bytes(PBF.read_bytes())

    default_out = tmp_path / "default"
    run_stage_publish(
        PBF,
        default_out,
        INVENTORY,
        FARES,
        SOURCES,
        None,
        built_at=BUILT_AT,
    )
    explicit_out = tmp_path / "explicit"
    run_stage_publish(
        PBF,
        explicit_out,
        INVENTORY,
        FARES,
        SOURCES,
        None,
        landmarks_pbf=landmarks,
        built_at=BUILT_AT,
    )

    assert seen == [PBF, landmarks]
    # Same landmark data, so the NCR feed bytes must not move when the argument
    # is supplied: the option changes which extract is read, nothing else.
    assert (explicit_out / "gtfs" / "gtfs.zip").read_bytes() == (
        default_out / "gtfs" / "gtfs.zip"
    ).read_bytes()


def test_publish_fails_loudly_when_the_landmarks_extract_is_missing(tmp_path):
    """R17: a missing landmarks extract is an input error, never a silent skip."""
    missing = tmp_path / "ncr.osm.pbf"
    out = tmp_path / "out"

    with pytest.raises(FileNotFoundError, match="landmarks"):
        run_stage_publish(
            PBF,
            out,
            INVENTORY,
            FARES,
            SOURCES,
            None,
            landmarks_pbf=missing,
            built_at=BUILT_AT,
        )

    assert not (out / "gtfs" / "gtfs.zip").exists()
    assert not (out / "manifest.json").exists()


def test_cli_publish_accepts_an_explicit_landmarks_extract(
    tmp_path, monkeypatch, capsys
):
    seen = _spy_on_named_stops(monkeypatch)
    landmarks = tmp_path / "landmarks.osm"
    landmarks.write_bytes(PBF.read_bytes())
    out = tmp_path / "build"

    code = main(
        [
            "publish",
            "--pbf",
            str(PBF),
            "--landmarks-pbf",
            str(landmarks),
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
    assert seen == [landmarks]
    assert (out / COVERAGE_REGIONAL_FILENAME).is_file()
    assert "landmarks" in capsys.readouterr().out


def test_cli_publish_reports_a_missing_landmarks_extract_as_input_error(
    tmp_path, capsys
):
    missing = tmp_path / "missing.osm.pbf"
    code = main(
        [
            "publish",
            "--pbf",
            str(PBF),
            "--landmarks-pbf",
            str(missing),
            "--out",
            str(tmp_path / "build"),
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

    assert code == 2
    stderr = capsys.readouterr().err
    assert "landmarks" in stderr
    assert "missing.osm.pbf" in stderr


# ---------------------------------------------------------------------------
# R11: tricycle terminals artifact and trike route pricing
# ---------------------------------------------------------------------------

#: Terminal features + one e-trike share_taxi relation + one unusable
#: ``route=tricycle`` relation, injected into a copy of the NCR fixture. The
#: taxi stand proves unrelated amenities are ignored; 6902/6903 have no usable
#: name so the artifact must say ``null`` rather than invent one.
TERMINAL_NODES = """  <node id="6901" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6100" lon="121.0100">
    <tag k="amenity" v="tricycle_station"/>
    <tag k="name" v="Wilson E-trike Terminal"/>
  </node>
  <node id="6902" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6110" lon="121.0110">
    <tag k="amenity" v="motorcycle_taxi"/>
  </node>
  <node id="6903" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6120" lon="121.0120">
    <tag k="amenity" v="tricycle_stand"/>
    <tag k="name" v="   "/>
  </node>
  <node id="6904" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6130" lon="121.0130">
    <tag k="amenity" v="taxi_stand"/>
    <tag k="name" v="Not a tricycle terminal"/>
  </node>
"""

TRIKE_RELATIONS = """  <relation id="7006" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="6101" role=""/>
    <member type="node" ref="5018" role="stop"/>
    <member type="node" ref="5019" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="E1"/>
    <tag k="name" v="Wilson E-trike System"/>
  </relation>
  <relation id="7007" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="6101" role=""/>
    <tag k="type" v="route"/>
    <tag k="route" v="tricycle"/>
    <tag k="name" v="Tuguegarao to Callao Cave"/>
  </relation>
"""

TRICYCLE_TERMINALS_SOURCE = (
    "OSM amenity=tricycle_station|tricycle_stand|motorcycle_taxi (ODbL 1.0)"
)


def _terminal_fixture(tmp_path):
    """The NCR fixture plus terminal nodes, an e-trike route and route=tricycle."""
    text = PBF.read_text(encoding="utf-8")
    text = text.replace('  <way id="6101"', TERMINAL_NODES + '  <way id="6101"', 1)
    text = text.replace("</osm>", TRIKE_RELATIONS + "</osm>", 1)
    path = tmp_path / "publish_terminals.osm"
    path.write_text(text, encoding="utf-8")
    return path


def test_tricycle_terminals_artifact_is_written_empty_when_none_are_mapped(published):
    """Absent amenities are data (an empty list), never a build error."""
    out, report = published
    path = out / TRICYCLE_TERMINALS_FILENAME

    assert path.is_file()
    artifact = json.loads(path.read_text(encoding="utf-8"))
    assert artifact == {
        "generated_at": BUILT_AT,
        "source": TRICYCLE_TERMINALS_SOURCE,
        "extract": str(PBF),
        "terminals": [],
    }
    assert report["tricycle_terminals"] == {
        "path": str(path),
        "canonical_path": None,
        "extract": str(PBF),
        "count": 0,
        "by_kind": {
            "tricycle_station": 0,
            "tricycle_stand": 0,
            "motorcycle_taxi": 0,
        },
    }


def test_tricycle_terminals_artifact_is_written_at_both_paths(tmp_path, monkeypatch):
    """The region copy and the build-root copy are byte-identical (R11/R28)."""
    build_root = tmp_path / "data-build"
    monkeypatch.setattr(publish_module, "DEFAULT_BUILD_DIR", build_root)
    out = build_root / "gtfs" / "ph"
    fixture = _terminal_fixture(tmp_path)

    report = run_stage_publish(
        fixture,
        out,
        INVENTORY,
        FARES,
        SOURCES,
        None,
        built_at=BUILT_AT,
    )

    region_path = out / TRICYCLE_TERMINALS_FILENAME
    canonical_path = build_root / TRICYCLE_TERMINALS_FILENAME
    assert region_path.is_file()
    assert canonical_path.is_file()
    assert region_path.read_bytes() == canonical_path.read_bytes()

    artifact = json.loads(region_path.read_text(encoding="utf-8"))
    assert set(artifact) == {"generated_at", "source", "extract", "terminals"}
    assert artifact["generated_at"] == BUILT_AT
    assert artifact["source"] == TRICYCLE_TERMINALS_SOURCE
    assert artifact["extract"] == str(fixture)
    assert artifact["terminals"] == [
        {
            "osm_id": 6901,
            "name": "Wilson E-trike Terminal",
            "lat": 14.61,
            "lon": 121.01,
            "kind": "tricycle_station",
        },
        {
            "osm_id": 6902,
            "name": None,
            "lat": 14.611,
            "lon": 121.011,
            "kind": "motorcycle_taxi",
        },
        {
            "osm_id": 6903,
            "name": None,
            "lat": 14.612,
            "lon": 121.012,
            "kind": "tricycle_stand",
        },
    ]
    # the taxi stand is not a tricycle terminal
    assert 6904 not in {terminal["osm_id"] for terminal in artifact["terminals"]}

    summary = report["tricycle_terminals"]
    assert summary["path"] == str(region_path)
    assert summary["canonical_path"] == str(canonical_path)
    assert summary["count"] == 3
    assert summary["by_kind"] == {
        "tricycle_station": 1,
        "tricycle_stand": 1,
        "motorcycle_taxi": 1,
    }

    # route=tricycle is counted/excluded; the e-trike relation is in the feed.
    ingest = report["osm_ingest"]
    assert ingest["tricycle_relations_seen"] == 1
    excluded = ingest["excluded_tricycle_relations"]
    assert len(excluded) == 1
    assert excluded[0]["osm_id"] == 7007
    assert excluded[0]["name"] == "Tuguegarao to Callao Cave"
    assert "route=tricycle" in excluded[0]["reason"]
    assert "never auto-ingested" in excluded[0]["reason"]
    assert "trike-e1" in report["feed"]["route_ids"]


def test_etrike_route_enters_the_feed_without_a_fare_rule(tmp_path):
    """R4/R11/R28: trike legs show no fare; never the jeepney matrix."""
    fixture = _terminal_fixture(tmp_path)
    out = tmp_path / "out"

    report = run_stage_publish(
        fixture,
        out,
        INVENTORY,
        FARES,
        SOURCES,
        None,
        built_at=BUILT_AT,
    )

    trike_route_ids = [
        route_id
        for route_id in report["feed"]["route_ids"]
        if route_id.startswith("trike-")
    ]
    assert trike_route_ids == ["trike-e1"]

    with zipfile.ZipFile(out / "gtfs" / "gtfs.zip") as archive:
        routes = _csv_rows(archive, "routes.txt")
        rules = _csv_rows(archive, FARE_RULES_FILENAME)
        fares = _csv_rows(archive, FARE_ATTRIBUTES_FILENAME)

    route = {row["route_id"]: row for row in routes}["trike-e1"]
    assert route["route_type"] == "3"
    assert route["route_short_name"] == "E1"

    assert all(not row["route_id"].startswith("trike-") for row in rules)
    assert {row["fare_id"] for row in fares} == {
        "jeepney-traditional",
        "jeepney-modern",
        "city-bus-ordinary",
        "city-bus-aircon",
        "provincial-bus-ordinary",
        "ferry-pasig-river",
    }
    # no invented tricycle fare row exists in the matrix or the feed
    assert not any("trike" in row["fare_id"].lower() for row in fares)
    assert not any("tricycle" in row["route_id"].lower() for row in routes)
