"""Tests for pipeline stage: curated jeepney / UV Express inventory (Task 7).

Everything here is offline. The only route data is the committed seed file
``data/routes/jeepney-inventory.yaml``, transcribed by hand from the OSM Wiki
list of Metro Manila jeepney and UV Express routes. No test opens a socket and
no test needs the wiki page to be reachable.

Discovery path
--------------
``pytest`` runs from ``pipelines/`` (see ``pyproject.toml``), so the seed path is
resolved from this file rather than from the current directory:

    tests/test_inventory.py -> parents[2] -> repository root

Honesty contract
----------------
The wiki publishes route codes, names, road sequences, some operators and some
route lengths. It publishes **no headways** and **no stop-level inventory**, so
the seed leaves ``headway_peak_min`` / ``headway_offpeak_min`` null and derives
``stop_landmarks`` only from terminals the wiki actually names. These tests pin
that honest subset: they never assert a headway value that the source does not
contain.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.gtfs import DEFAULT_HEADWAY_OFFPEAK_MIN, DEFAULT_HEADWAY_PEAK_MIN, RouteDef
from pipeline.inventory import (
    MODE_JEEPNEY,
    MODE_UV_EXPRESS,
    InventoryRoute,
    TerminalNotMappedError,
    load_inventory,
    merge_routes,
    to_route_def,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "data" / "routes" / "jeepney-inventory.yaml"

#: Real Metro Manila coordinates for landmarks used by the synthetic tests.
#: These are test fixtures, not seed data: the seed deliberately carries no
#: stop coordinates, because the wiki publishes none.
STOP_LOOKUP = {
    "Bagong Silang": (14.7589, 121.0483),
    "Novaliches": (14.7285, 121.0330),
    "Aurora Center": (14.6433, 121.0533),
}


def route_def(route_id: str, name: str) -> RouteDef:
    """An OSM-sourced RouteDef, i.e. the left-hand argument of merge_routes."""
    return RouteDef(route_id=route_id, route_type=3, name=name)


def inventory_route(
    code: str,
    name: str,
    *,
    mode: str = MODE_JEEPNEY,
    endpoints: tuple[str, str] = ("Bagong Silang", "Novaliches"),
    via_roads: tuple[str, ...] = ("Susano",),
    stop_landmarks: tuple[str, ...] = ("Bagong Silang", "Novaliches"),
    headway_peak_min: int | None = None,
    headway_offpeak_min: int | None = None,
    typical_length_km: float | None = 7.76,
    operator: str | None = None,
    lookup: dict[str, tuple[float, float]] | None = None,
) -> RouteDef:
    """A curated RouteDef: an InventoryRoute pushed through to_route_def."""
    route = InventoryRoute(
        code=code,
        name=name,
        mode=mode,
        endpoints=endpoints,
        via_roads=via_roads,
        stop_landmarks=stop_landmarks,
        headway_peak_min=headway_peak_min,
        headway_offpeak_min=headway_offpeak_min,
        typical_length_km=typical_length_km,
        operator=operator,
        source_url=(
            "https://wiki.openstreetmap.org/wiki/"
            "Metro_Manila/Jeepney_and_UV_Express_routes#T1xx:_Camanava_and_Bulacan"
        ),
        needs_verification=True,
    )
    return to_route_def(route, STOP_LOOKUP if lookup is None else lookup)


# ---------------------------------------------------------------------------
# the committed seed
# ---------------------------------------------------------------------------


def test_seed_inventory_has_at_least_ten_routes():
    routes = load_inventory(SEED_PATH)
    assert len(routes) >= 10
    assert all(route.source_url.startswith("https://") for route in routes)
    assert len({route.code for route in routes}) == len(routes), "route codes must be unique"


def test_seed_entries_cite_the_wiki_section_they_were_transcribed_from():
    routes = load_inventory(SEED_PATH)
    for route in routes:
        assert route.source_url.startswith(
            "https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes#"
        ), route.code
        assert route.needs_verification is True, route.code


def test_seed_entries_still_answer_the_landmark_question_and_declare_their_gaps():
    """Every entry names where it starts, ends and what it passes, or says null."""
    routes = load_inventory(SEED_PATH)
    for route in routes:
        assert len(route.endpoints) == 2 and all(route.endpoints), route.code
        assert route.stop_landmarks, f"{route.code}: stop_landmarks must be non-empty"
        assert isinstance(route.via_roads, tuple), route.code
        assert route.typical_length_km is None or route.typical_length_km > 0, route.code
        assert route.operator is None or route.operator.strip(), route.code


def test_seed_covers_traditional_modern_and_uv_express_families():
    routes = load_inventory(SEED_PATH)
    modes = {route.mode for route in routes}
    assert modes == {MODE_JEEPNEY, MODE_UV_EXPRESS}
    traditional = [route for route in routes if route.code.startswith("T")]
    modern = [route for route in routes if route.code[:1].isdigit()]
    uv_express = [route for route in routes if route.mode == MODE_UV_EXPRESS]
    assert traditional, "expected at least one T1xx-T4xx traditional jeepney route"
    assert modern, "expected at least one 1xx-4xx modern jeepney route"
    assert uv_express, "expected at least one Cxxx/Mxxx/Nxxx UV Express route"


# ---------------------------------------------------------------------------
# load_inventory: schema validation that names the offending route
# ---------------------------------------------------------------------------


def test_rejects_a_route_missing_via_roads(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text("routes:\n  - code: T9999\n    name: Bad route\n")
    with pytest.raises(ValueError, match="T9999"):
        load_inventory(bad)


def test_rejects_an_unknown_mode_and_names_the_route_code(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "routes:\n"
        "  - code: T9998\n"
        "    name: Bad route\n"
        "    mode: tricycle\n"
        "    endpoints: [A, B]\n"
        "    via_roads: []\n"
        "    stop_landmarks: [A]\n"
        "    headway_peak_min: null\n"
        "    headway_offpeak_min: null\n"
        "    typical_length_km: null\n"
        "    operator: null\n"
        "    source_url: https://wiki.openstreetmap.org/wiki/x\n"
        "    needs_verification: true\n"
    )
    with pytest.raises(ValueError, match="T9998"):
        load_inventory(bad)


# ---------------------------------------------------------------------------
# to_route_def
# ---------------------------------------------------------------------------


def test_to_route_def_namespaces_the_route_id_and_uses_the_length_as_distance():
    route_def_out = inventory_route("T1010", "Bagong Silang - Novaliches via Susano")

    assert route_def_out.route_id == "jeep-T1010"
    assert route_def_out.route_type == 3
    assert route_def_out.distance_km == 7.76
    assert route_def_out.short_name == "T1010"
    assert [stop.name for stop in route_def_out.stops] == ["Bagong Silang", "Novaliches"]
    assert route_def_out.stops[0].stop_id == "jeep-T1010:landmark:0"
    assert route_def_out.shape[0] == (14.7589, 121.0483)
    assert route_def_out.shape[-1] == (14.7285, 121.0330)


def test_to_route_def_uses_the_uv_prefix_for_uv_express_routes():
    route_def_out = inventory_route(
        "C20", "Molino - Alabang via Daang Hari", mode=MODE_UV_EXPRESS
    )
    assert route_def_out.route_id == "uv-C20"


def test_to_route_def_falls_back_to_the_pinned_headways_when_the_source_has_none():
    route_def_out = inventory_route("T1011", "Unknown headway route")
    assert route_def_out.headway_peak_min == DEFAULT_HEADWAY_PEAK_MIN
    assert route_def_out.headway_offpeak_min == DEFAULT_HEADWAY_OFFPEAK_MIN


def test_to_route_def_raises_listing_every_unmapped_landmark():
    route = InventoryRoute(
        code="T1012",
        name="Bagong Silang - Novaliches",
        mode=MODE_JEEPNEY,
        endpoints=("Bagong Silang", "Novaliches"),
        via_roads=("Susano",),
        stop_landmarks=("Bagong Silang", "Novaliches", "Aurora Center"),
        headway_peak_min=None,
        headway_offpeak_min=None,
        typical_length_km=None,
        operator=None,
        source_url="https://wiki.openstreetmap.org/wiki/x",
        needs_verification=True,
    )

    with pytest.raises(TerminalNotMappedError) as excinfo:
        to_route_def(route, {"Bagong Silang": (14.7589, 121.0483)})

    message = str(excinfo.value)
    assert "T1012" in message
    assert "Novaliches" in message
    assert "Aurora Center" in message
    assert excinfo.value.missing == ("Novaliches", "Aurora Center")


# ---------------------------------------------------------------------------
# merge_routes
# ---------------------------------------------------------------------------


def test_merge_prefers_osm_route_definition():
    merged = merge_routes(
        [route_def("jeep-T1010", "OSM version")],
        [inventory_route("T1010", "Curated version")],
    )
    assert [route.name for route in merged if route.route_id == "jeep-T1010"] == ["OSM version"]


def test_merge_keeps_inventory_routes_that_osm_does_not_supply():
    merged = merge_routes(
        [route_def("rail-mrt3", "MRT-3")],
        [inventory_route("T1010", "Curated version")],
    )
    assert [route.route_id for route in merged] == ["rail-mrt3", "jeep-T1010"]
