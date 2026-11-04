"""Tests for Task 8 provenance manifest and the licence gate (spec 8.1, ruling R22).

Everything here is offline: the registry is the committed
``data/provenance/sources.yaml`` and the artifacts are bytes written by the
test itself. No test opens a socket.

The gate has three teeth:

* ``assert_no_blocked_dataset`` - Sakay/PTAC 2014 GTFS, BusMaps and any
  unlicensed feed are internal-exploration only and must never appear in a
  shipped manifest (``data/provenance/PROVENANCE_NOTES.md``);
* ``assert_licence_notice`` - a published manifest must carry an ODbL-1.0
  dataset and the exact spec Appendix A OpenStreetMap attribution;
* the CC BY-SA 2.0 check (ruling R32) - when the manifest lists the wiki-derived
  inventory, both the manifest and the published feed artifact must carry the
  exact inventory attribution, so losing it inside ``gtfs.zip`` fails the gate.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest
import yaml

from pipeline.cli import main
from pipeline.manifest import (
    BLOCKED_DATASET_IDS,
    ENGINE,
    BlockedDatasetError,
    LicenceGateError,
    artifact_licence_text,
    assert_licence_notice,
    assert_no_blocked_dataset,
    build_manifest,
    gate_manifest,
    load_sources,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_PATH = REPO_ROOT / "data" / "provenance" / "sources.yaml"

#: Spec Appendix A literal, hardcoded on purpose (not imported from the code
#: under test) so a corrupted constant fails this gate too.
SPEC_APPENDIX_A_ATTRIBUTION = (
    "© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0"
)

#: Spec Appendix A CC BY-SA 2.0 literal for the wiki-derived inventory (R32).
SPEC_WIKI_ATTRIBUTION = (
    "Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)"
)


def _artifact(tmp_path: Path, name: str = "gtfs.zip", payload: bytes = b"zip") -> Path:
    path = tmp_path / name
    path.write_bytes(payload)
    return path


def _write_manifest(path: Path, document: dict) -> Path:
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def _compliant_manifest() -> dict:
    return {
        "built_at": "2026-11-01T00:00:00Z",
        "engine": dict(ENGINE),
        "datasets": [
            {
                "id": "gtfs",
                "path": "data/build/gtfs/gtfs.zip",
                "sha256": "0" * 64,
                "licence_spdx": "ODbL-1.0",
            }
        ],
        "attributions": [SPEC_APPENDIX_A_ATTRIBUTION],
    }


def _licence_zip(tmp_path: Path, licence_text: str, name: str = "gtfs.zip") -> Path:
    """A minimal feed artifact: a zip carrying only ``LICENSE-DATA.txt``."""
    path = tmp_path / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("LICENSE-DATA.txt", licence_text)
    return path


def _compliant_wiki_manifest(artifact: Path) -> dict:
    """A published-shape manifest: ODbL feed plus the CC BY-SA 2.0 inventory."""
    manifest = _compliant_manifest()
    manifest["datasets"][0]["path"] = str(artifact)
    manifest["datasets"].append(
        {
            "id": "osm-wiki-jeepney",
            "path": "data/routes/jeepney-inventory.yaml",
            "sha256": "0" * 64,
            "licence_spdx": "CC-BY-SA-2.0",
        }
    )
    manifest["attributions"].append(SPEC_WIKI_ATTRIBUTION)
    return manifest


# ---------------------------------------------------------------------------
# build_manifest
# ---------------------------------------------------------------------------


def test_manifest_records_sha256_and_licence(tmp_path):
    f = _artifact(tmp_path)
    m = build_manifest([f], {"osm": {"licence_spdx": "ODbL-1.0"}}, "2026-11-01T00:00:00Z")

    assert m["datasets"][0]["sha256"] == hashlib.sha256(b"zip").hexdigest()
    assert m["datasets"][0]["licence_spdx"] == "ODbL-1.0"
    assert m["engine"] == {"name": "motis", "version": "v2.11.4"}
    assert m["built_at"] == "2026-11-01T00:00:00Z"


def test_manifest_hashes_source_datasets_and_orders_attributions(tmp_path):
    extract = _artifact(tmp_path, "ncr.osm.pbf", b"osm-bytes")
    inventory = _artifact(tmp_path, "jeepney-inventory.yaml", b"inventory-bytes")
    feed = _artifact(tmp_path, "gtfs.zip", b"zip")

    sources = {
        "osm": {
            "licence_spdx": "ODbL-1.0",
            "attribution": SPEC_APPENDIX_A_ATTRIBUTION,
            "path": extract,
            "artifact": "gtfs.zip",
        },
        "osm-wiki-jeepney": {
            "licence_spdx": "CC-BY-SA-2.0",
            "attribution": "Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)",
            "path": inventory,
        },
    }
    m = build_manifest([feed], sources, "2026-11-01T00:00:00Z")

    assert [dataset["id"] for dataset in m["datasets"]] == ["osm", "osm-wiki-jeepney", "gtfs"]
    by_id = {dataset["id"]: dataset for dataset in m["datasets"]}
    assert by_id["osm"]["sha256"] == hashlib.sha256(b"osm-bytes").hexdigest()
    assert by_id["osm"]["licence_spdx"] == "ODbL-1.0"
    assert by_id["osm-wiki-jeepney"]["sha256"] == hashlib.sha256(b"inventory-bytes").hexdigest()
    assert by_id["osm-wiki-jeepney"]["licence_spdx"] == "CC-BY-SA-2.0"
    assert by_id["gtfs"]["sha256"] == hashlib.sha256(b"zip").hexdigest()
    assert by_id["gtfs"]["licence_spdx"] == "ODbL-1.0"  # derived from OSM
    assert m["attributions"] == [
        SPEC_APPENDIX_A_ATTRIBUTION,
        "Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)",
    ]


def test_manifest_requires_an_existing_artifact(tmp_path):
    with pytest.raises(FileNotFoundError, match="absent.zip"):
        build_manifest([tmp_path / "absent.zip"], {"osm": {"licence_spdx": "ODbL-1.0"}}, "2026-11-01T00:00:00Z")


def test_manifest_requires_a_licence_for_every_source(tmp_path):
    with pytest.raises(ValueError, match="licence_spdx"):
        build_manifest([_artifact(tmp_path)], {"mystery": {}}, "2026-11-01T00:00:00Z")


def test_manifest_refuses_to_be_built_from_a_blocked_source(tmp_path):
    with pytest.raises(BlockedDatasetError, match="busmaps"):
        build_manifest(
            [_artifact(tmp_path)],
            {"busmaps": {"licence_spdx": "NOASSERTION"}},
            "2026-11-01T00:00:00Z",
        )


# ---------------------------------------------------------------------------
# the blocked-dataset gate
# ---------------------------------------------------------------------------


def test_licence_gate_rejects_blocked_datasets():
    with pytest.raises(BlockedDatasetError, match="busmaps"):
        assert_no_blocked_dataset({"datasets": [{"id": "busmaps"}]})


@pytest.mark.parametrize(
    "dataset_id",
    [
        "busmaps",
        "BusMaps",
        "bus_maps",
        "bus-maps",
        "sakay-gtfs",
        "Sakay_GTFS",
        "sakaygtfs",
        "ptac-2014",
        "PTAC_2014",
    ],
)
def test_blocked_ids_are_matched_case_and_punctuation_insensitively(dataset_id):
    with pytest.raises(BlockedDatasetError):
        assert_no_blocked_dataset({"datasets": [{"id": dataset_id}]})


def test_blocked_list_pins_the_spec_8_1_never_shipped_datasets():
    assert {"sakay-gtfs", "ptac-2014", "busmaps"} <= BLOCKED_DATASET_IDS


def test_licence_gate_accepts_a_clean_manifest():
    assert_no_blocked_dataset({"datasets": [{"id": "osm"}, {"id": "gtfs"}]})


# ---------------------------------------------------------------------------
# the ODbL notice gate
# ---------------------------------------------------------------------------


def test_licence_notice_gate_requires_an_odbl_dataset():
    with pytest.raises(LicenceGateError, match="ODbL"):
        assert_licence_notice(
            [{"id": "gtfs", "licence_spdx": "MIT"}], [SPEC_APPENDIX_A_ATTRIBUTION]
        )


def test_licence_notice_gate_requires_the_exact_appendix_a_attribution():
    with pytest.raises(LicenceGateError, match="notice"):
        assert_licence_notice(
            [{"id": "gtfs", "licence_spdx": "ODbL-1.0"}],
            ["© OpenStreetMap contributors"],
        )


def test_licence_notice_gate_passes_a_compliant_manifest():
    gate_manifest(_compliant_manifest())


def test_licence_notice_gate_requires_the_wiki_attribution_for_wiki_datasets():
    datasets = [
        {"id": "gtfs", "licence_spdx": "ODbL-1.0"},
        {"id": "osm-wiki-jeepney", "licence_spdx": "CC-BY-SA-2.0"},
    ]
    with pytest.raises(LicenceGateError, match="CC BY-SA"):
        assert_licence_notice(datasets, [SPEC_APPENDIX_A_ATTRIBUTION])


def test_licence_notice_gate_requires_the_wiki_attribution_inside_the_artifact():
    datasets = [
        {"id": "gtfs", "licence_spdx": "ODbL-1.0"},
        {"id": "osm-wiki-jeepney", "licence_spdx": "CC-BY-SA-2.0"},
    ]
    attributions = [SPEC_APPENDIX_A_ATTRIBUTION, SPEC_WIKI_ATTRIBUTION]

    with pytest.raises(LicenceGateError, match="artifact"):
        assert_licence_notice(
            datasets,
            attributions,
            artifact_text=SPEC_APPENDIX_A_ATTRIBUTION + "\n",
        )
    # the same manifest passes once the feed states the notice
    assert_licence_notice(
        datasets,
        attributions,
        artifact_text=f"{SPEC_APPENDIX_A_ATTRIBUTION}\n{SPEC_WIKI_ATTRIBUTION}\n",
    )


@pytest.mark.parametrize(
    "wiki_dataset",
    [
        {"id": "osm-wiki-jeepney", "licence_spdx": "NOASSERTION"},  # id detection
        {"id": "renamed", "licence_spdx": "CC-BY-SA-2.0"},  # licence detection
        {"id": "OSM_Wiki_Jeepney"},  # squashed id, no licence recorded
    ],
)
def test_licence_notice_gate_detects_the_wiki_inventory_by_id_or_licence(
    wiki_dataset,
):
    with pytest.raises(LicenceGateError, match="CC BY-SA"):
        assert_licence_notice(
            [{"id": "gtfs", "licence_spdx": "ODbL-1.0"}, wiki_dataset],
            [SPEC_APPENDIX_A_ATTRIBUTION],
        )


def test_artifact_licence_text_reads_the_zip_the_manifest_names(tmp_path):
    artifact = _licence_zip(tmp_path, SPEC_APPENDIX_A_ATTRIBUTION + "\n")
    manifest = _compliant_wiki_manifest(artifact)

    text = artifact_licence_text(manifest)

    assert SPEC_APPENDIX_A_ATTRIBUTION in text


def test_gate_manifest_rejects_a_blocked_manifest():
    manifest = _compliant_manifest()
    manifest["datasets"].append(
        {"id": "busmaps", "path": "x", "sha256": "0", "licence_spdx": "NOASSERTION"}
    )
    with pytest.raises(BlockedDatasetError, match="busmaps"):
        gate_manifest(manifest)


# ---------------------------------------------------------------------------
# the committed provenance registry
# ---------------------------------------------------------------------------


def test_load_sources_reads_the_committed_registry_in_canonical_order():
    sources = load_sources(SOURCES_PATH)

    assert list(sources) == [
        "osm",
        "osm-wiki-jeepney",
        "ltfrb-fares",
        "rail-fares",
        "mmda-ferry",
        "psgc",
        "photon",
        "openfreemap",
        "motis",
        "crowd-reports",
        "walk-estimate",
    ]
    assert sources["osm"]["licence_spdx"] == "ODbL-1.0"
    assert sources["osm"]["attribution"] == SPEC_APPENDIX_A_ATTRIBUTION
    assert sources["osm-wiki-jeepney"]["licence_spdx"] == "CC-BY-SA-2.0"


def test_load_sources_rejects_a_duplicate_id(tmp_path):
    bad = tmp_path / "sources.yaml"
    bad.write_text(
        yaml.safe_dump(
            {
                "sources": [
                    {"id": "osm", "licence_spdx": "ODbL-1.0", "attribution": "a"},
                    {"id": "osm", "licence_spdx": "ODbL-1.0", "attribution": "b"},
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate"):
        load_sources(bad)


# ---------------------------------------------------------------------------
# CLI: python -m pipeline.cli licence-gate
# ---------------------------------------------------------------------------


def test_cli_licence_gate_passes_the_committed_registry(capsys):
    assert main(["licence-gate"]) == 0
    out = capsys.readouterr().out
    assert "licence-gate: ok" in out
    assert "ODbL-1.0" in out


def test_cli_licence_gate_exits_non_zero_for_a_blocked_manifest(tmp_path, capsys):
    manifest = _write_manifest(
        tmp_path / "manifest.json",
        {
            "built_at": "2026-11-01T00:00:00Z",
            "engine": dict(ENGINE),
            "datasets": [
                {"id": "busmaps", "path": "x", "sha256": "0", "licence_spdx": "NOASSERTION"}
            ],
            "attributions": [SPEC_APPENDIX_A_ATTRIBUTION],
        },
    )

    code = main(["licence-gate", "--manifest", str(manifest)])

    assert code == 1
    assert "busmaps" in capsys.readouterr().err
    assert code != 0


def test_cli_licence_gate_accepts_a_compliant_manifest(tmp_path, capsys):
    artifact = _licence_zip(tmp_path, SPEC_APPENDIX_A_ATTRIBUTION + "\n")
    manifest = _compliant_manifest()
    manifest["datasets"][0]["path"] = str(artifact)
    manifest_path = _write_manifest(tmp_path / "manifest.json", manifest)

    assert main(["licence-gate", "--manifest", str(manifest_path)]) == 0
    assert "licence-gate: ok" in capsys.readouterr().out


def test_cli_licence_gate_exits_non_zero_when_the_artifact_lost_the_wiki_attribution(
    tmp_path, capsys
):
    """R32 negative proof: the manifest is intact, the published feed is not."""
    artifact = _licence_zip(tmp_path, SPEC_APPENDIX_A_ATTRIBUTION + "\n")
    manifest = _compliant_wiki_manifest(artifact)
    manifest_path = _write_manifest(tmp_path / "manifest.json", manifest)

    assert main(["licence-gate", "--manifest", str(manifest_path)]) == 1
    err = capsys.readouterr().err
    assert "CC BY-SA" in err
    assert "artifact" in err


def test_cli_licence_gate_reports_a_missing_artifact_as_an_input_error(
    tmp_path, capsys
):
    manifest = _compliant_manifest()
    manifest["datasets"][0]["path"] = str(tmp_path / "absent.zip")
    manifest_path = _write_manifest(tmp_path / "manifest.json", manifest)

    assert main(["licence-gate", "--manifest", str(manifest_path)]) == 2
    assert "absent.zip" in capsys.readouterr().err


def test_cli_licence_gate_treats_a_missing_manifest_as_an_input_error(tmp_path, capsys):
    assert main(["licence-gate", "--manifest", str(tmp_path / "absent.json")]) == 2
    assert "absent.json" in capsys.readouterr().err


def test_cli_licence_gate_fails_a_manifest_without_the_odbl_notice(tmp_path, capsys):
    manifest = _write_manifest(
        tmp_path / "manifest.json",
        {
            "built_at": "2026-11-01T00:00:00Z",
            "engine": dict(ENGINE),
            "datasets": [{"id": "gtfs", "path": "x", "sha256": "0", "licence_spdx": "MIT"}],
            "attributions": ["MIT"],
        },
    )

    assert main(["licence-gate", "--manifest", str(manifest)]) == 1
    assert "ODbL" in capsys.readouterr().err


def test_gate_manifest_does_not_read_the_artifact_itself(tmp_path):
    """Reading the artifact is the caller's job (the CLI and publish do it).

    ``gate_manifest`` stays a pure function over the manifest plus optional
    artifact text, so a manifest whose datasets name no readable zip - and whose
    datasets include no wiki inventory - needs no data/build present.
    """
    manifest = _compliant_manifest()
    manifest["datasets"][0]["path"] = "data/build/gtfs/absent.zip"
    with zipfile.ZipFile(tmp_path / "unused.zip", "w") as archive:
        archive.writestr("README.txt", "the path above deliberately does not exist")
    gate_manifest(manifest)
