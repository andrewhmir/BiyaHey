"""National-scale OSM route ingestion (``pipeline.osm_routes``), Task 2R2.

These tests pin the things the national PH extract needs and the NCR extract
never exercised:

1. **Route ids stay unique and deterministic, with R19 reversal awareness.** A
   base id is ``<family>-<slug>``. The lowest-OSM-id relation keeps it; a later
   relation whose normalized ``from``/``to`` are exactly the kept relation's
   ``to``/``from`` is the same corridor's opposite direction and is **dropped**
   (the feed already emits both travel directions for one relation); every other
   colliding relation gets ``<base>-osm<osm id>``. A relation with no
   ``name``/``ref`` is skipped and counted, because the feed cannot name it.
2. **Stop identity is unchanged (Lead ruling R16).** Served stops keep their
   per-route namespaced ids (``<route_id>:node:<id>`` / ``:way:<id>`` /
   ``:landmark:<n>``), so the NCR feed keeps one stop row per route, not one row
   globally. MOTIS links nearby stops itself.
3. **Shapes start and end at served stops (6B defect 3b).** Leading/trailing
   chain vertices outside the first/last stop are trimmed; an unlocatable stop
   leaves the shape untrimmed and is counted.
4. **Every relation is accounted for.** The reader returns national counters
   (read / route relations / unsupported route value / no name / candidates /
   accepted / duplicate direction / collision-renamed) and a per-relation
   ``skipped_member_reasons`` breakdown; the GTFS builder's existing counters are
   kept and extended with shape counters (trimmed, untrimmed, two-point).

Everything here is offline: the only inputs are the committed fixtures
``tests/fixtures/osm_routes_collisions.osm`` (national collision shape),
``tests/fixtures/osm_routes_shape_trim.osm`` (the rail-1 6B regression, in
miniature) and ``tests/fixtures/osm_routes.osm`` (the NCR fixture).
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date
from pathlib import Path

import pytest

from pipeline.gtfs import AgencyInfo, build_feed
from pipeline.osm_routes import (
    iter_route_relations,
    read_route_relation_composition,
    read_route_relations,
)

FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes_collisions.osm"
TRIM_FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes_shape_trim.osm"
NCR_FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes.osm"
FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)

#: The 16 route ids the collision fixture must produce, in file order. Relation
#: 7111 is absent: it is the exact reverse of 7110 and is dropped by R19.
EXPECTED_ROUTE_IDS = [
    "bus-7",
    "bus-7-osm7002",
    "bus-7-osm7004",
    "ferry-7",
    "bus-shared",
    "bus-other",
    "bus-order-osm7032",  # written before 7031 but the higher OSM id
    "bus-order",
    "ferry-guadalupepasigferry",
    "ferry-guadalupepasigferry-osm7041",
    "bus-dangle",
    "bus-osm7080",  # no slug (name is not ASCII): falls back to the OSM id
    "bus-frag",
    "bus-rev",
    "bus-rev-osm7112",
    "bus-rev-osm7113",
]

#: ``route=road`` is not a public-transport mode: counted, never yielded.
EXPECTED_UNSUPPORTED = (("road", 1),)

#: Every skipped member on the fixture, by reason. The two routes with skips are
#: 7050 (dangling way + two dangling stop nodes + nested relation) and 7090
#: (one detached fragment).
EXPECTED_SKIP_REASONS = {
    "dangling_stop_node": 2,
    "dangling_way": 1,
    "detached_fragment": 1,
    "nested_relation": 1,
}


def _ingest():
    """Read the collision fixture once (three streaming passes; tiny file)."""
    return read_route_relations(FIXTURE)


def _by_route_id():
    return {relation.route_id: relation for relation in _ingest().relations}


def _feed():
    return build_feed(
        _ingest().relations,
        agency=AgencyInfo.SYNTHETIC,
        feed_start=FEED_START,
        feed_end=FEED_END,
    )


def _trim_feed():
    return build_feed(
        read_route_relations(TRIM_FIXTURE).relations,
        agency=AgencyInfo.SYNTHETIC,
        feed_start=FEED_START,
        feed_end=FEED_END,
    )


def _csv_rows(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(zf.read(name).decode("utf-8-sig"))))


def _shape_length_m(points) -> float:
    """Great-circle length of a shape polyline in metres."""
    import math

    total = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        h = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        total += 2 * 6371000.0 * math.asin(math.sqrt(min(1.0, h)))
    return total


# --------------------------------------------------------------------------
# route-id collisions: deterministic, unique, family-scoped, reversal-aware
# --------------------------------------------------------------------------


def test_collision_ids_are_unique_and_deterministic():
    relations = _ingest().relations

    assert [relation.route_id for relation in relations] == EXPECTED_ROUTE_IDS
    assert len({relation.route_id for relation in relations}) == len(relations)

    # the first (lowest) relation of each collision group keeps the bare id
    by_id = _by_route_id()
    assert by_id["bus-7"].osm_id == 7001
    assert by_id["bus-7-osm7002"].osm_id == 7002
    assert by_id["bus-7-osm7004"].osm_id == 7004
    assert by_id["ferry-guadalupepasigferry"].osm_id == 7040
    assert by_id["ferry-guadalupepasigferry-osm7041"].osm_id == 7041

    # re-reading the same file yields the same ids and the same stats
    second = _ingest()
    assert [relation.route_id for relation in second.relations] == EXPECTED_ROUTE_IDS
    assert second.stats == _ingest().stats


def test_the_lowest_osm_id_wins_not_the_file_position():
    """7032 is written before 7031 in the fixture; 7031 is the lower id."""
    ids = _by_route_id()

    assert ids["bus-order"].osm_id == 7031
    assert ids["bus-order-osm7032"].osm_id == 7032


def test_exact_reverse_direction_pair_is_dropped_and_counted():
    """7111 is 7110's reverse after case/punctuation/whitespace normalization."""
    ingest = _ingest()
    relations = {relation.osm_id: relation for relation in ingest.relations}

    assert 7110 in relations
    assert relations[7110].route_id == "bus-rev"
    assert 7111 not in relations
    route_ids = {relation.route_id for relation in ingest.relations}
    assert "bus-rev-osm7111" not in route_ids
    assert ingest.stats.routes_skipped_duplicate_direction == 1
    assert ingest.stats.accepted == ingest.stats.candidates - 1


def test_same_direction_collision_is_renamed_not_dropped():
    """7112 has the same from/to as the kept relation: a distinct route id."""
    relation = _by_route_id()["bus-rev-osm7112"]

    assert relation.osm_id == 7112
    assert relation.shape  # still published, with landmark stops
    assert [stop.name for stop in relation.stops] == ["North End", "South End"]


def test_missing_from_to_is_not_comparable_and_is_renamed():
    """7113 has no from/to tags, so R19 cannot call it a reverse pair."""
    relation = _by_route_id()["bus-rev-osm7113"]

    assert relation.osm_id == 7113
    assert relation.shape
    assert [stop.stop_id for stop in relation.stops] == [
        "bus-rev-osm7113:landmark:0",
        "bus-rev-osm7113:landmark:1",
    ]


def test_the_same_slug_in_another_family_does_not_collide():
    ids = _by_route_id()

    assert ids["bus-7"].route_type == 3
    assert ids["ferry-7"].route_type == 4
    assert ids["ferry-7"].osm_id == 7010


def test_collision_composition_counters_are_reported():
    stats = _ingest().stats

    # bus-7, bus-order, ferry-guadalupepasigferry, bus-rev
    assert stats.route_id_collisions == 4
    # 7002, 7004, 7032, 7041, 7112, 7113
    assert stats.renamed_route_ids == 6
    assert stats.routes_renamed_collision == 6
    assert stats.routes_skipped_duplicate_direction == 1
    assert stats.fallback_route_ids == 1  # 7080: non-ASCII name -> bus-osm7080


def test_relation_only_composition_matches_the_full_read():
    composition = read_route_relation_composition(FIXTURE)
    full = _ingest().stats

    assert composition.relations_read == full.relations_read
    assert composition.route_relations == full.route_relations
    assert composition.unsupported_route == full.unsupported_route
    assert composition.skipped_no_name == full.skipped_no_name
    assert composition.candidates == full.candidates
    assert composition.accepted == full.accepted
    assert composition.route_id_collisions == full.route_id_collisions
    assert (
        composition.routes_skipped_duplicate_direction
        == full.routes_skipped_duplicate_direction
    )
    assert composition.renamed_route_ids == full.renamed_route_ids
    # the relation-only pass does not resolve geometry, so member counters are 0
    assert composition.skipped_members == 0
    assert full.skipped_members == 5


# --------------------------------------------------------------------------
# stop identity is unchanged (R16): per-route namespaced, never global
# --------------------------------------------------------------------------


def test_shared_member_stop_nodes_stay_route_namespaced_in_the_feed(tmp_path):
    routes = _by_route_id()
    shared = {stop.stop_id for stop in routes["bus-shared"].stops}
    other = {stop.stop_id for stop in routes["bus-other"].stops}

    # both relations list nodes 5301 and 5302 as their stops
    assert shared == {"bus-shared:node:5301", "bus-shared:node:5302"}
    assert other == {"bus-other:node:5301", "bus-other:node:5302"}
    assert not shared & other

    out = tmp_path / "gtfs.zip"
    _feed().write(out)
    with zipfile.ZipFile(out) as zf:
        stops = _csv_rows(zf, "stops.txt")

    by_id = {row["stop_id"]: row for row in stops}
    for stop_list in (shared, other):
        for stop_id in stop_list:
            assert stop_id in by_id
    # the same OSM node appears once per route - two rows, not one deduped row
    assert sum(1 for row in stops if row["stop_name"] == "Shared One") == 2
    assert sum(1 for row in stops if row["stop_name"] == "Shared Two") == 2
    assert by_id["bus-shared:node:5301"]["stop_lat"] == by_id["bus-other:node:5301"]["stop_lat"]


def test_landmark_stops_are_synthesised_per_route_and_route_scoped():
    routes = _by_route_id()

    keeper = routes["ferry-guadalupepasigferry"]
    collided = routes["ferry-guadalupepasigferry-osm7041"]

    assert [stop.name for stop in keeper.stops] == ["Guadalupe", "Pasig"]
    assert [stop.name for stop in collided.stops] == ["Guadalupe", "Pasig"]
    assert [stop.stop_id for stop in keeper.stops] == [
        "ferry-guadalupepasigferry:landmark:0",
        "ferry-guadalupepasigferry:landmark:1",
    ]
    assert [stop.stop_id for stop in collided.stops] == [
        "ferry-guadalupepasigferry-osm7041:landmark:0",
        "ferry-guadalupepasigferry-osm7041:landmark:1",
    ]

    # the ferry with from/to tags names its landmarks from them
    tagged = routes["ferry-7"]
    assert [stop.name for stop in tagged.stops] == ["North Pier", "South Pier"]


# --------------------------------------------------------------------------
# shape trimming: starts at the first served stop, ends at the last (6B 3b)
# --------------------------------------------------------------------------


def test_shape_is_trimmed_to_the_first_and_last_served_stop():
    relation = {r.route_id: r for r in read_route_relations(TRIM_FIXTURE).relations}[
        "rail-trim"
    ]

    # the leading way (8005 -> 8001, ~3 km) and the trailing way (8004 -> 8006)
    # are outside the served stops and must not be in the published shape
    assert relation.shape_trimmed is True
    assert relation.shape_untrimmed_stop_not_found is False
    assert relation.shape[0] == pytest.approx((14.6574, 121.0035))  # First Stop
    assert relation.shape[-1] == pytest.approx((14.6590, 121.0200))  # Last Stop
    assert len(relation.shape) == 4

    length_m = _shape_length_m(relation.shape)
    # the main line is ~1.8 km; the untrimmed chain is ~5.9 km. A leg is sane
    # when it is the served section, not the whole relation geometry.
    assert 1500 < length_m < 2500


def test_unlocatable_stop_leaves_the_shape_untrimmed_and_counts_it():
    relation = {r.route_id: r for r in read_route_relations(TRIM_FIXTURE).relations}[
        "bus-unlocatable"
    ]

    # stop 8007 is >1 km from every chain vertex, so no trim is attempted
    assert relation.shape_trimmed is False
    assert relation.shape_untrimmed_stop_not_found is True
    assert len(relation.shape) == 5  # 8005, 8001, 8002, 8003, 8004
    assert _shape_length_m(relation.shape) > 4000  # the leading spur is still there


def test_shape_counters_reach_the_build_report():
    feed = _trim_feed()

    assert feed.stats.routes_in == 3
    assert feed.stats.routes_written == 3
    assert feed.stats.shapes_trimmed == 1
    assert feed.stats.shapes_untrimmed_stop_not_found == 1
    # only 8203 (way-only, two landmark stops) still has a two-point shape
    assert feed.stats.two_point_shapes == 1


# --------------------------------------------------------------------------
# per-relation skip accounting
# --------------------------------------------------------------------------


def test_dangling_members_are_counted_by_reason_and_the_route_still_yields():
    relation = _by_route_id()["bus-dangle"]

    # way 8999, stops 9998/9999 and relation 7001 are all missing/unresolved
    assert relation.shape == ()
    assert relation.stops == ()
    assert relation.skipped_members == 4
    assert dict(relation.skipped_member_reasons) == {
        "dangling_stop_node": 2,
        "dangling_way": 1,
        "nested_relation": 1,
    }


def test_a_detached_fragment_is_counted_as_one_drop():
    relation = _by_route_id()["bus-frag"]

    # way 6602 is disconnected from way 6601: dropped whole, not spliced in
    assert relation.shape == ((14.6000, 121.6000), (14.6050, 121.6050))
    assert relation.skipped_members == 1
    assert dict(relation.skipped_member_reasons) == {"detached_fragment": 1}


def test_every_relations_skip_total_equals_its_reason_breakdown():
    for relation in _ingest().relations:
        reasons = dict(relation.skipped_member_reasons)
        assert relation.skipped_members == sum(reasons.values()), relation.route_id


# --------------------------------------------------------------------------
# national counters: every relation accounted for
# --------------------------------------------------------------------------


def test_national_counters_account_for_every_relation():
    ingest = _ingest()
    stats = ingest.stats

    # 20 relations in the fixture: 19 type=route + 1 boundary
    assert stats.relations_read == 20
    assert stats.route_relations == 19
    assert stats.unsupported_route == 1
    assert stats.unsupported_route_values == EXPECTED_UNSUPPORTED
    assert stats.skipped_no_name == 1
    assert stats.candidates == 17
    assert stats.accepted == 16
    assert len(ingest.relations) == 16

    # every type=route relation lands in exactly one bucket
    assert stats.route_relations == (
        stats.unsupported_route + stats.skipped_no_name + stats.candidates
    )
    assert stats.candidates == (
        stats.accepted + stats.routes_skipped_duplicate_direction
    )

    assert stats.skipped_members == 5
    assert dict(stats.skipped_member_reasons) == EXPECTED_SKIP_REASONS
    assert stats.skipped_members == sum(dict(stats.skipped_member_reasons).values())
    # 7010, 7040, 7041, 7080, 7090, 7110, 7111, 7112, 7113
    assert stats.candidates_without_stop_members == 9


def test_unsupported_route_values_are_counted_not_yielded():
    ingest = _ingest()

    assert "bus-r7" not in {relation.route_id for relation in ingest.relations}
    assert all(relation.osm_route != "road" for relation in ingest.relations)
    assert dict(ingest.stats.unsupported_route_values) == {"road": 1}


def test_a_relation_without_any_name_is_skipped_and_counted():
    ingest = _ingest()

    # relation 7070 has no name and no ref - it cannot be named in the feed
    assert 7070 not in {relation.osm_id for relation in ingest.relations}
    assert ingest.stats.skipped_no_name == 1


def test_a_relation_whose_name_has_no_ascii_slug_keeps_the_osm_id_fallback():
    relation = _by_route_id()["bus-osm7080"]

    assert relation.osm_id == 7080
    assert relation.name == "日本語"
    assert relation.stops  # still ingestible: landmark stops synthesised
    assert all(stop.stop_id.startswith("bus-osm7080:") for stop in relation.stops)


def test_stats_serialise_for_the_build_report():
    stats = _ingest().stats
    document = stats.as_dict()

    assert document["relations_read"] == 20
    assert document["unsupported_route_values"] == {"road": 1}
    assert document["skipped_member_reasons"] == EXPECTED_SKIP_REASONS
    assert document["candidates"] == 17
    assert document["accepted"] == 16
    assert document["routes_skipped_duplicate_direction"] == 1
    assert document["routes_renamed_collision"] == 6
    assert document["renamed_route_ids"] == 6


# --------------------------------------------------------------------------
# the built feed: unique ids, existing builder counters preserved
# --------------------------------------------------------------------------


def test_collision_fixture_builds_a_feed_with_unique_route_ids():
    feed = _feed()

    assert feed.stats.routes_in == 16
    assert feed.stats.routes_written == 15  # bus-dangle has no geometry
    assert feed.stats.routes_skipped_no_geometry == 1
    assert feed.stats.routes_skipped_duplicate_id == 0
    assert feed.stats.dangling_members == 5
    assert feed.stats.shapes_trimmed == 0
    assert feed.stats.shapes_untrimmed_stop_not_found == 0
    # every landmark-only route plus every 2-node way stays a 2-point shape
    assert feed.stats.two_point_shapes == 10

    route_ids = [row.route_id for row in feed.routes]
    assert len(route_ids) == len(set(route_ids)) == 15
    assert "bus-dangle" not in route_ids
    assert {"bus-7", "bus-7-osm7002", "bus-7-osm7004"} <= set(route_ids)
    assert "bus-rev" in route_ids
    assert "bus-rev-osm7111" not in route_ids
    assert "bus-rev-osm7112" in route_ids
    assert "bus-rev-osm7113" in route_ids
    # every written route has exactly two stops, both directions
    assert len(feed.stops) == 30
    assert len(feed.trips) == 15 * 328


# --------------------------------------------------------------------------
# the NCR fixture's route ids must not change
# --------------------------------------------------------------------------


def test_ncr_fixture_route_ids_and_stop_ids_are_unchanged():
    ingest = read_route_relations(NCR_FIXTURE)
    routes = {relation.route_id: relation for relation in ingest.relations}

    assert set(routes) == {"rail-mrt3", "ferry-pasig", "bus-b1", "bus-b2"}
    assert ingest.stats.route_id_collisions == 0
    assert ingest.stats.renamed_route_ids == 0
    assert ingest.stats.routes_skipped_duplicate_direction == 0
    assert ingest.stats.fallback_route_ids == 0

    # R16: served stop ids keep the existing per-route namespace
    assert [stop.stop_id for stop in routes["rail-mrt3"].stops] == [
        "rail-mrt3:node:1001",
        "rail-mrt3:node:1002",
        "rail-mrt3:node:1003",
    ]
    assert [stop.stop_id for stop in routes["ferry-pasig"].stops] == [
        "ferry-pasig:landmark:0",
        "ferry-pasig:landmark:1",
    ]
    assert [stop.stop_id for stop in routes["bus-b1"].stops] == [
        "bus-b1:node:1004",
        "bus-b1:node:1005",
    ]

    # stops are already at the shape ends here: no trim and no two-point shape
    assert routes["rail-mrt3"].shape_trimmed is False
    assert routes["rail-mrt3"].shape_untrimmed_stop_not_found is False
    feed = build_feed(
        ingest.relations,
        agency=AgencyInfo.SYNTHETIC,
        feed_start=FEED_START,
        feed_end=FEED_END,
    )
    assert feed.stats.two_point_shapes == 1  # ferry-pasig's landmark-only shape


def test_iter_route_relations_still_yields_the_same_relations():
    """The pinned reader interface is unchanged (publish consumes it as-is)."""
    assert [relation.route_id for relation in iter_route_relations(FIXTURE)] == (
        EXPECTED_ROUTE_IDS
    )
