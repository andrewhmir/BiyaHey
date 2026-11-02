"""Tests for the Task 8 landmark resolver (ruling R30).

The resolver is the missing link between the curated inventory (which names
terminals as text and deliberately stores no coordinates) and the GTFS builder
(which needs ``lat/lon``). It reads *named stop features* from the NCR extract:
``public_transport=platform|station|stop_position``, ``highway=bus_stop`` and
``railway=station|halt`` - nodes and platform ways (centroid).

Honesty rules pinned here:

* matching is exact after normalisation (case-fold, punctuation and diacritic
  folding) - there is no nearest-neighbour or fuzzy-distance guessing;
* when several OSM stops share a normalised name the first in file order wins
  and the collision is reported by :func:`ambiguous_stop_names`, never hidden;
* an inventory landmark with no match stays unresolved (it is not approximated),
  so the publish build report can list it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from pipeline.inventory import MODE_JEEPNEY, InventoryRoute
from pipeline.landmarks import (
    ALIASES_SCHEMA_PATH,
    LandmarkAlias,
    NamedStop,
    alias_coordinates,
    ambiguous_stop_names,
    build_stop_lookup,
    load_landmark_aliases,
    load_named_stops,
    normalise_name,
    resolve_landmarks,
    stop_feature_lookup,
)

FIXTURES = Path(__file__).parent / "fixtures"
OSM_ROUTES = FIXTURES / "osm_routes.osm"
PUBLISH = FIXTURES / "publish_ncr.osm"
REPO_ROOT = Path(__file__).resolve().parents[2]
ALIASES = REPO_ROOT / "data" / "routes" / "landmark-aliases.yaml"


def _inventory_route(stop_landmarks: tuple[str, ...]) -> InventoryRoute:
    return InventoryRoute(
        code="T9000",
        name="Test route",
        mode=MODE_JEEPNEY,
        endpoints=(stop_landmarks[0], stop_landmarks[-1]),
        via_roads=(),
        stop_landmarks=stop_landmarks,
        headway_peak_min=None,
        headway_offpeak_min=None,
        typical_length_km=None,
        operator=None,
        source_url="https://wiki.openstreetmap.org/wiki/x",
        needs_verification=True,
    )


# ---------------------------------------------------------------------------
# normalisation
# ---------------------------------------------------------------------------


def test_normalise_name_folds_case_whitespace_punctuation_and_diacritics():
    assert normalise_name("Novaliches") == "novaliches"
    assert normalise_name("NOVALICHES") == "novaliches"
    assert normalise_name("  Victory   Mall Monumento ") == "victory mall monumento"
    assert normalise_name("Paco (Obando)") == "paco obando"
    assert normalise_name("Biñan Población") == "binan poblacion"
    assert normalise_name("EDSA/Shaw Boulevard") == "edsa shaw boulevard"
    assert normalise_name("O'Donnell") == "odonnell"
    assert normalise_name("A. Bonifacio") == "a bonifacio"
    assert normalise_name("Sucat-Interchange") == "sucat interchange"
    assert normalise_name("") == ""


# ---------------------------------------------------------------------------
# reading named stop features from OSM
# ---------------------------------------------------------------------------


def test_load_named_stops_reads_platforms_railway_stations_and_platform_ways():
    stops = load_named_stops(PUBLISH)
    names = {stop.name for stop in stops}

    assert len(stops) == 22  # 21 tagged nodes + 1 platform way
    assert {
        "Bagong Silang",
        "RIZAL AVENUE",
        "Victory Mall Monumento",
        "South Station",
        "Alabang",
        "North Avenue",
        "Binan Poblacion",
    } <= names

    way = next(stop for stop in stops if stop.name == "Binan Poblacion")
    assert (way.osm_type, way.osm_id) == ("way", 6001)
    assert (way.lat, way.lon) == pytest.approx((14.4415, 121.0305))

    # named roads are geometry, not stops, and must never become landmarks
    assert {"EDSA", "Some Road", "MRT-3 track", "Susano Road", "Pasig River"}.isdisjoint(names)


def test_load_named_stops_ignores_named_nodes_without_stop_tags():
    stops = load_named_stops(OSM_ROUTES)
    assert {stop.name for stop in stops} == {
        "North Avenue",
        "Quezon Avenue",
        "GMA Kamuning",
        "Cubao",
        "Baclaran",
    }


def test_load_named_stops_missing_file_raises_a_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="absent.osm"):
        load_named_stops(tmp_path / "absent.osm")


# ---------------------------------------------------------------------------
# lookup building
# ---------------------------------------------------------------------------


def test_build_stop_lookup_normalises_keys_and_keeps_the_first_match():
    stops = [
        NamedStop("Alpha", 1.0, 2.0, "node", 1),
        NamedStop("ALPHA", 3.0, 4.0, "node", 2),
        NamedStop("Beta", 5.0, 6.0, "way", 3),
    ]
    lookup = build_stop_lookup(stops)

    assert lookup == {"alpha": (1.0, 2.0), "beta": (5.0, 6.0)}


def test_build_stop_lookup_from_a_fixture_is_keyed_by_normalised_name():
    lookup = build_stop_lookup(load_named_stops(PUBLISH))
    assert lookup["rizal avenue"] == pytest.approx((14.6094, 120.9824))
    assert lookup["binan poblacion"] == pytest.approx((14.4415, 121.0305))
    assert lookup["paco obando"] == pytest.approx((14.6692, 120.9461))


def test_ambiguous_stop_names_reports_conflicting_candidates_only():
    stops = [
        NamedStop("Alpha", 1.0, 2.0, "node", 1),
        NamedStop("alpha", 3.0, 4.0, "node", 2),
        NamedStop("Beta", 5.0, 6.0, "node", 3),
        NamedStop("BETA", 5.0, 6.0, "way", 4),  # same place: not ambiguous
    ]
    ambiguous = ambiguous_stop_names(stops)

    assert set(ambiguous) == {"alpha"}
    assert [stop.osm_id for stop in ambiguous["alpha"]] == [1, 2]


# ---------------------------------------------------------------------------
# the inventory adapter
# ---------------------------------------------------------------------------


def test_resolve_landmarks_maps_published_names_to_coordinates_and_drops_misses():
    route = _inventory_route(("Bagong Silang", "Biñan Población", "Unmapped Place"))
    lookup = build_stop_lookup(load_named_stops(PUBLISH))

    resolved = resolve_landmarks([route], lookup)

    assert set(resolved) == {"Bagong Silang", "Biñan Población"}
    assert resolved["Bagong Silang"] == pytest.approx((14.7589, 121.0483))
    assert resolved["Biñan Población"] == pytest.approx((14.4415, 121.0305))
    assert "Unmapped Place" not in resolved


def test_resolve_landmarks_does_not_guess_by_proximity():
    """A landmark that only *looks* like an OSM name stays unresolved."""
    route = _inventory_route(("Baclaran", "Baclaran Rotonda Terminal"))
    lookup = build_stop_lookup(load_named_stops(PUBLISH))

    resolved = resolve_landmarks([route], lookup)

    assert set(resolved) == {"Baclaran"}


# ---------------------------------------------------------------------------
# documented aliases (ruling R34)
# ---------------------------------------------------------------------------


def _alias(landmark, osm_stop, stop_name, source="gtfs stops.txt 1") -> LandmarkAlias:
    return LandmarkAlias(
        landmark=landmark,
        osm_stop=osm_stop,
        stop_name=stop_name,
        source=source,
        note="test alias",
    )


def test_stop_feature_lookup_keys_by_osm_feature():
    stops = [
        NamedStop("Alpha", 1.0, 2.0, "node", 1),
        NamedStop("Beta", 3.0, 4.0, "way", 2),
    ]

    assert set(stop_feature_lookup(stops)) == {"node/1", "way/2"}


def test_alias_coordinates_pins_the_aliased_feature():
    stops = [
        NamedStop("Novaliches Plaza Mall", 14.7219514, 121.0403010, "node", 7535900399),
        NamedStop("Unrelated", 1.0, 1.0, "node", 2),
    ]

    coordinates, invalid = alias_coordinates(
        [_alias("Novaliches", "node/7535900399", "Novaliches Plaza Mall")],
        stop_feature_lookup(stops),
    )

    assert coordinates == {"Novaliches": (14.7219514, 121.0403010)}
    assert invalid == []


def test_alias_coordinates_reports_missing_and_renamed_features():
    stops = [NamedStop("Renamed Stop", 3.0, 4.0, "node", 1)]

    coordinates, invalid = alias_coordinates(
        [
            _alias("Moved", "node/1", "Old Name"),
            _alias("Vanished", "node/9", "Whatever"),
        ],
        stop_feature_lookup(stops),
    )

    assert coordinates == {}
    assert [entry["landmark"] for entry in invalid] == ["Moved", "Vanished"]
    assert "named 'Renamed Stop'" in invalid[0]["reason"]
    assert "no named stop feature" in invalid[1]["reason"]


def test_resolve_landmarks_uses_a_documented_alias_only_when_the_direct_lookup_misses():
    lookup = build_stop_lookup(
        [NamedStop("Novaliches", 14.7285, 121.0330, "node", 5002)]
    )
    route = _inventory_route(("Novaliches", "Novaliches Plaza Mall"))

    resolved = resolve_landmarks(
        [route],
        lookup,
        {"Novaliches": (0.0, 0.0), "Novaliches Plaza Mall": (14.72, 121.04)},
    )

    # The exact OSM name still wins; the alias only fills the miss.
    assert resolved["Novaliches"] == pytest.approx((14.7285, 121.0330))
    assert resolved["Novaliches Plaza Mall"] == pytest.approx((14.72, 121.04))


def test_load_landmark_aliases_validates_the_schema(tmp_path):
    bad = tmp_path / "landmark-aliases.yaml"
    bad.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "aliases": [
                    {
                        "landmark": "Novaliches",
                        "osm_stop": "somewhere",
                        "stop_name": "Novaliches",
                        "source": "gtfs stops.txt 1",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="aliases do not match"):
        load_landmark_aliases(bad)


def test_load_landmark_aliases_rejects_duplicate_normalised_landmarks(tmp_path):
    duplicate = tmp_path / "landmark-aliases.yaml"
    duplicate.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "aliases": [
                    {
                        "landmark": "SM Fairview",
                        "osm_stop": "node/1",
                        "stop_name": "SM City Fairview",
                        "source": "gtfs stops.txt 1",
                    },
                    {
                        "landmark": "SM  FAIRVIEW",
                        "osm_stop": "node/2",
                        "stop_name": "SM City Fairview",
                        "source": "gtfs stops.txt 2",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="normalise to the same key"):
        load_landmark_aliases(duplicate)


def test_committed_alias_file_is_schema_valid_and_cites_feed_lines():
    aliases = load_landmark_aliases(ALIASES)

    assert aliases, "the committed alias file must not be empty"
    for alias in aliases:
        assert re.fullmatch(r"(node|way)/[0-9]+", alias.osm_stop), alias.landmark
        assert re.fullmatch(r"gtfs stops\.txt [0-9]+", alias.source), alias.landmark
        assert normalise_name(alias.stop_name), alias.landmark
    assert ALIASES_SCHEMA_PATH.is_file()
