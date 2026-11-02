"""Tests for Task 8 fares: the hand-curated matrix -> GTFS ``fare_*`` tables.

Everything here is offline. The only fare input is the committed matrix
``data/fares/fares-2026-09-28.yaml`` (or a tiny in-test matrix).

Honesty contract
----------------
The matrix prices jeepney / city bus / provincial bus fares as
``base_fare + per_km`` and UV Express / P2P as distance- or multiplier-based
amounts. GTFS ``fare_attributes.txt`` has a single flat ``price`` column and no
distance component, so only the fares that *are* flat (a boarding/base fare or
an explicit ``fare:`` amount) are emitted. The distance-only and multiplier
rows are reported by :func:`pipeline.fares.unrepresentable_fares` instead of
being invented as flat prices - the BFF computes those from the matrix
(spec 8.2 stage 03 / 8.3).
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date
from pathlib import Path

import pytest
import yaml

from pipeline.fares import (
    FARE_ATTRIBUTES_FILENAME,
    FARE_ATTRIBUTE_COLUMNS,
    FARE_RULE_COLUMNS,
    FARE_RULES_FILENAME,
    attribute_rows,
    build_gtfs_fare_tables,
    rule_rows,
    unrepresentable_fares,
)
from pipeline.gtfs import ODBL_ATTRIBUTION, GtfsFeed

REPO_ROOT = Path(__file__).resolve().parents[2]
FARES_PATH = REPO_ROOT / "data" / "fares" / "fares-2026-09-28.yaml"

#: The flat prices the committed matrix produces, keyed by fare id.
EXPECTED_ATTRIBUTES = {
    "jeepney-traditional": "14.00",
    "jeepney-modern": "17.00",
    "city-bus-ordinary": "15.00",
    "city-bus-aircon": "18.00",
    "provincial-bus-ordinary": "12.00",
    "ferry-pasig-river": "0.00",
}


def fare_matrix() -> dict:
    """The committed matrix, parsed exactly as the publish stage parses it."""
    return yaml.safe_load(FARES_PATH.read_text(encoding="utf-8"))


def csv_rows(text: str) -> tuple[list[str], list[list[str]]]:
    rows = list(csv.reader(io.StringIO(text)))
    return rows[0], rows[1:]


# ---------------------------------------------------------------------------
# the committed matrix
# ---------------------------------------------------------------------------


def test_committed_matrix_emits_one_flat_row_per_priced_mode_class():
    tables = build_gtfs_fare_tables(fare_matrix())

    header, rows = csv_rows(tables[FARE_ATTRIBUTES_FILENAME])
    assert header == list(FARE_ATTRIBUTE_COLUMNS)

    by_id = {row[0]: row for row in rows}
    assert {fare_id: row[1] for fare_id, row in by_id.items()} == EXPECTED_ATTRIBUTES
    assert {row[2] for row in rows} == {"PHP"}  # currency_type
    assert {row[3] for row in rows} == {"0"}  # payment_method: pay on board
    assert {row[4] for row in rows} == {"0"}  # transfers: single-leg fares


def test_distance_and_multiplier_fares_are_reported_not_faked():
    matrix = fare_matrix()
    unsupported = unrepresentable_fares(matrix)
    unsupported_ids = {entry["fare_id"] for entry in unsupported}

    assert unsupported_ids == {
        "uv-express-traditional",
        "uv-express-modern",
        "p2p-premium",
    }
    assert all(entry["reason"].strip() for entry in unsupported)
    assert any("per_km" in entry["reason"] for entry in unsupported)
    assert any("multiplier" in entry["reason"] for entry in unsupported)

    # ... and none of them leaked into a flat GTFS price.
    attribute_ids = {row.fare_id for row in attribute_rows(matrix)}
    assert attribute_ids.isdisjoint(unsupported_ids)


def test_prices_are_always_formatted_with_two_decimal_places():
    matrix = {
        "matrix_id": "test",
        "effective_from": "2026-09-28",
        "source_id": "ltfrb-fares",
        "source_url": "https://ltfrb.gov.ph",
        "currency": "PHP",
        "fares": [
            {"mode": "jeepney", "class": "traditional", "base_fare": 2.5, "base_km": 4, "per_km": 2},
            {"mode": "ferry", "class": "pasig-river", "fare": 0},
        ],
    }
    tables = build_gtfs_fare_tables(matrix)
    _, rows = csv_rows(tables[FARE_ATTRIBUTES_FILENAME])
    prices = {row[0]: row[1] for row in rows}
    assert prices == {"jeepney-traditional": "2.50", "ferry-pasig-river": "0.00"}


# ---------------------------------------------------------------------------
# fare_rules: which routes the flat fares attach to
# ---------------------------------------------------------------------------


def test_fare_rules_bind_jeep_bus_and_ferry_route_ids_only():
    route_ids = ["jeep-t109", "bus-b1", "ferry-pasig", "rail-mrt3", "uv-c20", "jeep-t101"]
    rules = rule_rows(attribute_rows(fare_matrix()), route_ids)

    assert [(rule.fare_id, rule.route_id) for rule in rules] == [
        ("jeepney-traditional", "jeep-t109"),
        ("city-bus-ordinary", "bus-b1"),
        ("ferry-pasig-river", "ferry-pasig"),
        ("jeepney-traditional", "jeep-t101"),
    ]


def test_every_fare_rule_points_at_an_emitted_fare_attribute():
    route_ids = ["jeep-t109", "bus-b1", "ferry-pasig", "rail-mrt3", "uv-c20"]
    tables = build_gtfs_fare_tables(fare_matrix(), route_ids)

    attr_header, attr_rows = csv_rows(tables[FARE_ATTRIBUTES_FILENAME])
    rule_header, rule_rows_out = csv_rows(tables[FARE_RULES_FILENAME])
    assert rule_header == list(FARE_RULE_COLUMNS)

    attribute_ids = {row[0] for row in attr_rows}
    rule_ids = {row[0] for row in rule_rows_out}
    assert rule_ids
    assert rule_ids <= attribute_ids
    assert {row[1] for row in rule_rows_out} == {"jeep-t109", "bus-b1", "ferry-pasig"}
    # every rule row carries the full column set, empty zone columns included
    assert all(len(row) == len(rule_header) for row in rule_rows_out)
    assert all(row[2:] == ["", "", ""] for row in rule_rows_out)
    # attributes and rules keep the same column width
    assert all(len(row) == len(attr_header) for row in attr_rows)


def test_route_ids_are_optional_so_fare_attributes_can_be_built_alone():
    tables = build_gtfs_fare_tables(fare_matrix())

    assert set(tables) == {FARE_ATTRIBUTES_FILENAME, FARE_RULES_FILENAME}
    header, rows = csv_rows(tables[FARE_RULES_FILENAME])
    assert header == list(FARE_RULE_COLUMNS)
    assert rows == []
    _, attr_rows = csv_rows(tables[FARE_ATTRIBUTES_FILENAME])
    assert len(attr_rows) == len(EXPECTED_ATTRIBUTES)


# ---------------------------------------------------------------------------
# input validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "matrix, match",
    [
        ({}, "fares"),
        ({"currency": "PHP", "fares": []}, "fares"),
        ({"currency": "php", "fares": [{"mode": "jeepney", "class": "traditional", "fare": 1}]}, "currency"),
        (
            {"currency": "PHP", "fares": [{"mode": "jeepney", "class": "traditional", "fare": -1}]},
            "negative",
        ),
        (
            {
                "currency": "PHP",
                "fares": [
                    {"mode": "jeepney", "class": "traditional", "fare": 1},
                    {"mode": "jeepney", "class": "traditional", "fare": 2},
                ],
            },
            "duplicate",
        ),
        (
            {"currency": "PHP", "fares": [{"mode": "jeepney", "class": "traditional", "base_fare": "fourteen"}]},
            "number",
        ),
        (
            {"currency": "PHP", "fares": [{"mode": "jeepney"}]},
            "class",
        ),
    ],
)
def test_rejects_an_invalid_fare_matrix(matrix, match):
    with pytest.raises(ValueError, match=match):
        build_gtfs_fare_tables(matrix)


# ---------------------------------------------------------------------------
# attaching the fare tables to a GTFS zip
# ---------------------------------------------------------------------------


def _empty_feed() -> GtfsFeed:
    return GtfsFeed(
        agency=[],
        routes=[],
        stops=[],
        trips=[],
        stop_times=[],
        shapes=[],
        calendar=[],
        feed_info=[],
        feed_start=date(2026, 11, 1),
        feed_end=date(2027, 10, 31),
    )


def test_extra_tables_are_written_into_the_zip_without_touching_the_licence(tmp_path):
    tables = build_gtfs_fare_tables(fare_matrix(), ["jeep-t109"])
    out = tmp_path / "gtfs.zip"
    _empty_feed().write(out, extra_tables=tables)

    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        assert {FARE_ATTRIBUTES_FILENAME, FARE_RULES_FILENAME, "LICENSE-DATA.txt"} <= names
        assert archive.read(FARE_ATTRIBUTES_FILENAME).decode("utf-8-sig").startswith(
            "fare_id,price,currency_type"
        )
        licence = archive.read("LICENSE-DATA.txt").decode("utf-8-sig")
        assert ODBL_ATTRIBUTION in licence


def test_write_rejects_an_extra_table_name_that_is_not_a_plain_txt_file(tmp_path):
    with pytest.raises(ValueError, match="plain"):
        _empty_feed().write(tmp_path / "gtfs.zip", extra_tables={"../evil.txt": "x"})


def test_write_rejects_an_extra_table_that_would_overwrite_a_generated_file(tmp_path):
    with pytest.raises(ValueError, match="overwrite"):
        _empty_feed().write(tmp_path / "gtfs.zip", extra_tables={"LICENSE-DATA.txt": "x"})
