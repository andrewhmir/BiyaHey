"""National-scale OSM route ingestion (``pipeline.osm_routes``), Task 2R2.

These tests pin the things the national PH extract needs and the NCR extract
never exercised:

1. **Route ids stay unique and deterministic, with R19/R30/R32 semantics.** A
   base id is ``<family>-<slug>``. The keeper is the lowest-OSM-id *feed-ready*
   candidate (R30: a shape way, and either two or more stop-ish members or none
   at all, so landmark synthesis can publish it); only a group with no
   feed-ready candidate falls back to its lowest OSM id. A later relation whose
   normalized ``from``/``to`` are the exact reverse of *any already-kept
   relation in the same group* is dropped as the corridor's opposite direction
   (R32; the feed already emits both directions of one relation). Every other
   colliding relation gets ``<base>-osm<osm id>``. A relation with no
   ``name``/``ref`` is ingested under ``<family>-osm<id>`` with no short name
   and counted in ``relations_without_name`` (R31).
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
``tests/fixtures/osm_routes_keeper.osm`` (R30 feed-ready keeper, R31 nameless
ingest and R32 renamed reverse pair, in miniature),
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
KEEPER_FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes_keeper.osm"
TRIM_FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes_shape_trim.osm"
NCR_FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes.osm"
PLATFORM_NAMES_FIXTURE = (
    Path(__file__).parent / "fixtures" / "osm_routes_platform_names.osm"
)
FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)

#: The 17 route ids the collision fixture must produce, in file order. Relation
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
    "bus-osm7070",  # R31: no name/ref, ingested under the OSM id
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


def _keeper_ingest():
    """Read the R30/R31/R32 keeper fixture once."""
    return read_route_relations(KEEPER_FIXTURE)


def _keeper_feed():
    return build_feed(
        _keeper_ingest().relations,
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
    # 7070 (no name) and 7080 (non-ASCII name) have no slug: bus-osm<id>
    assert stats.fallback_route_ids == 2


def test_relation_only_composition_matches_the_full_read():
    composition = read_route_relation_composition(FIXTURE)
    full = _ingest().stats

    assert composition.relations_read == full.relations_read
    assert composition.route_relations == full.route_relations
    assert composition.unsupported_route == full.unsupported_route
    assert composition.relations_without_name == full.relations_without_name
    assert composition.candidates == full.candidates
    assert composition.accepted == full.accepted
    assert composition.route_id_collisions == full.route_id_collisions
    assert (
        composition.routes_skipped_duplicate_direction
        == full.routes_skipped_duplicate_direction
    )
    assert composition.renamed_route_ids == full.renamed_route_ids
    assert (
        composition.groups_without_feed_ready_keeper
        == full.groups_without_feed_ready_keeper
    )
    # the relation-only pass does not resolve geometry, so member counters are 0
    assert composition.skipped_members == 0
    assert full.skipped_members == 5


# --------------------------------------------------------------------------
# R30/R31/R32: feed-ready keeper, nameless ingest, whole-group reverse dedupe
# --------------------------------------------------------------------------

#: The keeper fixture's route ids, in file order. 7201 and 7303 are absent:
#: 7201 is the reverse direction of the feed-ready 7202, and 7303 the reverse of
#: the already-renamed bus-rr-osm7302.
EXPECTED_KEEPER_ROUTE_IDS = [
    "bus-p28",  # 7202: 0 stop members, so landmark stops publish it
    "bus-p31-osm7211",  # 7211: exactly 1 stop member -> renamed
    "bus-p31",  # 7212: 0 stop members, feed-ready -> bare id
    "bus-p35",  # 7221: no feed-ready candidate -> lowest-id fallback
    "bus-rr",  # 7301
    "bus-rr-osm7302",  # 7302
    "bus-osm7401",  # 7401: nameless, feed-ready (R31)
    "bus-osm7402",  # 7402: nameless, ingested but not feed-ready
]


def test_r30_feed_ready_later_relation_keeps_the_bare_id():
    """p28/p31/p35 regression: a 1-stop keeper must not steal the bare id.

    Pre-fix the lowest OSM id (7201, exactly one stop member) kept ``bus-p28``,
    the builder then skipped it as "too few stops", and the later 0-stop
    landmark-publishable reverse direction (7202) was dropped as a duplicate -
    so the route vanished from the feed entirely.
    """
    ingest = _keeper_ingest()
    routes = {relation.route_id: relation for relation in ingest.relations}

    assert routes["bus-p28"].osm_id == 7202
    assert [stop.name for stop in routes["bus-p28"].stops] == ["Beta", "Alpha"]
    assert 7201 not in {relation.osm_id for relation in ingest.relations}

    published = {row.route_id for row in _keeper_feed().routes}
    assert "bus-p28" in published  # the route is back, under its bare id
    assert "bus-p28-osm7201" not in published


def test_r30_one_stop_relation_is_renamed_and_skipped_as_too_few_stops():
    ingest = _keeper_ingest()
    routes = {relation.route_id: relation for relation in ingest.relations}

    # same-direction group: 7211 (1 stop) cannot keep the bare id; 7212 can
    assert routes["bus-p31"].osm_id == 7212
    assert routes["bus-p31-osm7211"].osm_id == 7211

    feed = _keeper_feed()
    published = {row.route_id for row in feed.routes}
    assert "bus-p31" in published
    assert "bus-p31-osm7211" not in published
    # bus-p31-osm7211, bus-p35 and bus-osm7402 each have exactly one stop
    assert feed.stats.routes_skipped_too_few_stops == 3


def test_r30_group_without_a_feed_ready_candidate_falls_back_to_the_lowest_id():
    ingest = _keeper_ingest()
    routes = {relation.route_id: relation for relation in ingest.relations}

    # 7221 is alone under bus-p35 with one stop: no feed-ready candidate, so the
    # lowest OSM id keeps the bare id and the builder counts the skip.
    assert routes["bus-p35"].osm_id == 7221
    # bus-osm7402 is the same situation for a nameless relation (R31 + R30).
    assert routes["bus-osm7402"].osm_id == 7402
    assert ingest.stats.groups_without_feed_ready_keeper == 2


def test_r32_reverse_of_an_already_renamed_relation_is_dropped():
    """7303 is 7302's exact reverse, not the bare keeper's."""
    ingest = _keeper_ingest()
    routes = {relation.route_id: relation for relation in ingest.relations}

    assert routes["bus-rr"].osm_id == 7301  # from North to South
    assert routes["bus-rr-osm7302"].osm_id == 7302  # from East to West
    # 7303 (from West to East) only reverses the renamed 7302, so a keeper-only
    # check would publish bus-rr-osm7303 and duplicate the corridor.
    assert 7303 not in {relation.osm_id for relation in ingest.relations}
    assert "bus-rr-osm7303" not in routes
    assert ingest.stats.routes_skipped_duplicate_direction == 2


def test_r31_nameless_relation_is_ingested_with_no_short_name():
    ingest = _keeper_ingest()
    routes = {relation.route_id: relation for relation in ingest.relations}
    relation = routes["bus-osm7401"]

    assert relation.osm_id == 7401
    assert relation.name == "OSM route 7401"
    assert relation.short_name == ""
    assert [stop.name for stop in relation.stops] == [
        "Nameless Start",
        "Nameless End",
    ]
    # 7401 and 7402 both lack name/ref; neither is silently dropped
    assert ingest.stats.relations_without_name == 2

    published = {row.route_id for row in _keeper_feed().routes}
    assert "bus-osm7401" in published
    assert "bus-osm7402" not in published  # R30: not feed-ready (one stop)


def test_keeper_fixture_composition_counters():
    stats = _keeper_ingest().stats

    assert stats.relations_read == 10
    assert stats.route_relations == 10
    assert stats.unsupported_route == 0
    assert stats.relations_without_name == 2
    assert stats.candidates == 10
    assert stats.accepted == 8
    assert stats.route_id_collisions == 3  # P28, P31, RR
    assert stats.routes_skipped_duplicate_direction == 2  # 7201, 7303
    assert stats.routes_renamed_collision == 2  # 7211, 7302
    assert stats.groups_without_feed_ready_keeper == 2  # bus-p35, bus-osm7402


def test_keeper_fixture_publishes_the_feed_ready_ids():
    feed = _keeper_feed()

    assert feed.stats.routes_in == 8
    assert feed.stats.routes_written == 5
    assert feed.stats.routes_skipped_no_geometry == 0
    assert feed.stats.routes_skipped_too_few_stops == 3
    assert {row.route_id for row in feed.routes} == {
        "bus-p28",
        "bus-p31",
        "bus-rr",
        "bus-rr-osm7302",
        "bus-osm7401",
    }
    assert len(feed.stops) == 10
    assert len(feed.trips) == 5 * 328


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
    assert stats.relations_without_name == 1  # 7070: ingested under bus-osm7070
    assert stats.candidates == 18
    assert stats.accepted == 17
    assert len(ingest.relations) == 17

    # every type=route relation lands in exactly one bucket; a nameless relation
    # is a candidate too (R31), so it is a sub-count, not a separate bucket
    assert stats.route_relations == (
        stats.unsupported_route
        + stats.candidates
        + stats.tricycle_relations_seen
        + stats.excluded_mistagged_tricycle_count
    )
    assert stats.relations_without_name <= stats.candidates
    assert stats.candidates == (
        stats.accepted + stats.routes_skipped_duplicate_direction
    )

    assert stats.skipped_members == 5
    assert dict(stats.skipped_member_reasons) == EXPECTED_SKIP_REASONS
    assert stats.skipped_members == sum(dict(stats.skipped_member_reasons).values())
    # 7010, 7040, 7041, 7070, 7080, 7090, 7110, 7111, 7112, 7113
    assert stats.candidates_without_stop_members == 10
    assert stats.groups_without_feed_ready_keeper == 0


def test_unsupported_route_values_are_counted_not_yielded():
    ingest = _ingest()

    assert "bus-r7" not in {relation.route_id for relation in ingest.relations}
    assert all(relation.osm_route != "road" for relation in ingest.relations)
    assert dict(ingest.stats.unsupported_route_values) == {"road": 1}


def test_a_relation_without_any_name_is_ingested_under_its_osm_id():
    """R31: no name/ref is not a skip; the OSM id is a resolvable identity."""
    ingest = _ingest()
    relation = {r.osm_id: r for r in ingest.relations}[7070]

    assert relation.route_id == "bus-osm7070"
    assert relation.name == "OSM route 7070"
    assert relation.short_name == ""  # no fabricated ref
    assert relation.shape == ((14.9500, 121.9500), (14.9550, 121.9550))
    # no name/from/to tags, so the landmark stops keep the neutral default names
    assert [stop.name for stop in relation.stops] == ["Start", "End"]
    assert ingest.stats.relations_without_name == 1


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
    assert document["relations_without_name"] == 1
    assert document["candidates"] == 18
    assert document["accepted"] == 17
    assert document["routes_skipped_duplicate_direction"] == 1
    assert document["routes_renamed_collision"] == 6
    assert document["renamed_route_ids"] == 6
    assert document["groups_without_feed_ready_keeper"] == 0


# --------------------------------------------------------------------------
# the built feed: unique ids, existing builder counters preserved
# --------------------------------------------------------------------------


def test_collision_fixture_builds_a_feed_with_unique_route_ids():
    feed = _feed()

    assert feed.stats.routes_in == 17
    assert feed.stats.routes_written == 16  # bus-dangle has no geometry
    assert feed.stats.routes_skipped_no_geometry == 1
    assert feed.stats.routes_skipped_duplicate_id == 0
    assert feed.stats.dangling_members == 5
    assert feed.stats.shapes_trimmed == 0
    assert feed.stats.shapes_untrimmed_stop_not_found == 0
    # every landmark-only route plus every 2-node way stays a 2-point shape
    assert feed.stats.two_point_shapes == 11

    route_ids = [row.route_id for row in feed.routes]
    assert len(route_ids) == len(set(route_ids)) == 16
    assert "bus-dangle" not in route_ids
    assert {"bus-7", "bus-7-osm7002", "bus-7-osm7004"} <= set(route_ids)
    assert "bus-osm7070" in route_ids
    assert "bus-rev" in route_ids
    assert "bus-rev-osm7111" not in route_ids
    assert "bus-rev-osm7112" in route_ids
    assert "bus-rev-osm7113" in route_ids
    # every written route has exactly two stops, both directions
    assert len(feed.stops) == 32
    assert len(feed.trips) == 16 * 328


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


# --------------------------------------------------------------------------
# R11: e-trike share_taxi -> trike- family; route=tricycle counted + excluded
# --------------------------------------------------------------------------

#: One miniature extract covering the whole tricycle classification rule:
#:
#: * 9001 a ``share_taxi`` whose name is the real-would-be Wilson E-trike System;
#: * 9002 a plain UV Express relation (must stay ``uv-``);
#: * 9003 a plain van association (must stay ``jeep-``);
#: * 9004 a ``share_taxi`` whose *operator* names a traysikel TODA;
#: * 9005 a ``share_taxi`` whose *description* names an electric tricycle;
#: * 9006 ``route=tricycle`` - unusable service evidence, must be excluded;
#: * 9007 a UV Express relation that also says "E-trike" (UV keeps priority).
#:
#: All share_taxi relations reuse the same way and stop pair so the fixture stays
#: small; the reader resolves each relation independently.
TRIKE_FIXTURE_XML = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="task-8-tricycle-fixture">
  <node id="9101" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6000" lon="121.0000">
    <tag k="name" v="Wilson E-trike Start"/>
  </node>
  <node id="9102" version="1" timestamp="2026-10-31T21:23:00Z" lat="14.6010" lon="121.0020">
    <tag k="name" v="Wilson E-trike End"/>
  </node>
  <way id="9201" version="1" timestamp="2026-10-31T21:23:00Z">
    <nd ref="9101"/>
    <nd ref="9102"/>
  </way>
  <relation id="9001" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="E1"/>
    <tag k="name" v="Wilson E-trike System"/>
    <tag k="operator" v="Wilson E-trike"/>
  </relation>
  <relation id="9002" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="C20"/>
    <tag k="name" v="UV Express C20"/>
  </relation>
  <relation id="9003" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="L1"/>
    <tag k="name" v="Laguna Van Association"/>
  </relation>
  <relation id="9004" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="T1"/>
    <tag k="name" v="Poblacion Route"/>
    <tag k="operator" v="Traysikel Operators and Drivers Association"/>
  </relation>
  <relation id="9005" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="T2"/>
    <tag k="name" v="Circuit Route"/>
    <tag k="description" v="electric tricycle corridor"/>
  </relation>
  <relation id="9006" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <tag k="type" v="route"/>
    <tag k="route" v="tricycle"/>
    <tag k="name" v="Tuguegarao to Callao Cave"/>
  </relation>
  <relation id="9007" version="1" timestamp="2026-10-31T21:23:00Z">
    <member type="way" ref="9201" role=""/>
    <member type="node" ref="9101" role="stop"/>
    <member type="node" ref="9102" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="share_taxi"/>
    <tag k="ref" v="C21"/>
    <tag k="name" v="UV Express E-trike shuttle"/>
  </relation>
</osm>
"""


def _trike_fixture(tmp_path) -> Path:
    path = tmp_path / "trike_routes.osm"
    path.write_text(TRIKE_FIXTURE_XML, encoding="utf-8")
    return path


def _trike_routes(tmp_path):
    ingest = read_route_relations(_trike_fixture(tmp_path))
    return {relation.route_id: relation for relation in ingest.relations}


def test_etrike_share_taxi_becomes_a_trike_route_with_route_type_3(tmp_path):
    routes = _trike_routes(tmp_path)

    assert routes["trike-e1"].osm_route == "share_taxi"
    assert routes["trike-e1"].route_type == 3
    assert routes["trike-e1"].name == "Wilson E-trike System"
    assert [stop.name for stop in routes["trike-e1"].stops] == [
        "Wilson E-trike Start",
        "Wilson E-trike End",
    ]

    feed = build_feed(
        read_route_relations(_trike_fixture(tmp_path)).relations,
        agency=AgencyInfo.SYNTHETIC,
        feed_start=FEED_START,
        feed_end=FEED_END,
    )
    assert "trike-e1" in {route.route_id for route in feed.routes}
    assert {
        route.route_type for route in feed.routes if route.route_id == "trike-e1"
    } == {3}


def test_uv_express_and_plain_share_taxi_are_unchanged(tmp_path):
    """R11 must not reclassify anything that is not an e-trike/tricycle."""
    routes = _trike_routes(tmp_path)

    assert "uv-c20" in routes  # UV Express keeps its historical family
    assert "jeep-l1" in routes  # plain share_taxi stays jeep-
    # UV Express priority is untouched even when the name also says E-trike.
    assert "uv-c21" in routes
    assert not any(route_id.startswith("trike-") for route_id in ("uv-c20", "uv-c21"))


def test_trike_heuristic_reads_operator_and_description(tmp_path):
    routes = _trike_routes(tmp_path)

    assert routes["trike-t1"].osm_id == 9004  # operator says "Traysikel"
    assert routes["trike-t2"].osm_id == 9005  # description says "tricycle"


def test_route_tricycle_is_counted_and_excluded_with_a_reason(tmp_path):
    ingest = read_route_relations(_trike_fixture(tmp_path))
    stats = ingest.stats

    assert stats.tricycle_relations_seen == 1
    assert 9006 not in {relation.osm_id for relation in ingest.relations}
    assert [entry["osm_id"] for entry in stats.excluded_tricycle_relations] == [9006]
    excluded = stats.excluded_tricycle_relations[0]
    assert excluded["name"] == "Tuguegarao to Callao Cave"
    assert "route=tricycle" in excluded["reason"]
    assert "never auto-ingested" in excluded["reason"]

    # every type=route relation is still accounted for, the tricycle included
    assert stats.route_relations == (
        stats.unsupported_route
        + stats.candidates
        + stats.tricycle_relations_seen
        + stats.excluded_mistagged_tricycle_count
    )
    assert stats.route_relations == 7
    assert stats.candidates == 6
    assert stats.accepted == 6

    document = stats.as_dict()
    assert document["tricycle_relations_seen"] == 1
    assert document["excluded_tricycle_relations"][0]["osm_id"] == 9006


def test_relation_only_composition_reports_the_tricycle_count(tmp_path):
    composition = read_route_relation_composition(_trike_fixture(tmp_path))
    full = read_route_relations(_trike_fixture(tmp_path)).stats

    assert composition.tricycle_relations_seen == full.tricycle_relations_seen == 1
    assert composition.route_relations == full.route_relations
    assert composition.candidates == full.candidates
    assert composition.accepted == full.accepted


# --------------------------------------------------------------------------
# R34: case-insensitive route=tricycle and route=bus tricycle-corridor exclusion
# --------------------------------------------------------------------------

#: One miniature extract for the R34 rules:
#:
#: * 9301 ``route=bus``, name names a Baliwag Tricycle TODA corridor. It is
#:   feed-ready (one way + two stops), which is exactly why it must be excluded:
#:   otherwise it would publish as a ``bus-*`` route and take the city-bus fare.
#: * 9302 an ordinary ``route=bus`` with no tricycle wording - unaffected;
#: * 9303 ``route=Tricycle`` (capital T, nameless) - counted as
#:   ``tricycle_relations_seen``, never ingested, never "unsupported";
#: * 9304 ``route=bus`` whose *operator* names a Bustos traysikel TODA - excluded;
#: * 9305 ``route=Bus`` (capital B) with tricycle wording - the normalized route
#:   value is still ``bus``, so it is excluded too.
MISTAGGED_BUS_FIXTURE_XML = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="r34-mistagged-bus-fixture">
  <node id="9401" version="1" timestamp="2026-11-04T00:00:00Z" lat="14.9500" lon="120.9000">
    <tag k="name" v="Baliwag Terminal"/>
  </node>
  <node id="9402" version="1" timestamp="2026-11-04T00:00:00Z" lat="14.9600" lon="120.9100">
    <tag k="name" v="Bustos Terminal"/>
  </node>
  <way id="9403" version="1" timestamp="2026-11-04T00:00:00Z">
    <nd ref="9401"/>
    <nd ref="9402"/>
  </way>
  <relation id="9301" version="1" timestamp="2026-11-04T00:00:00Z">
    <member type="way" ref="9403" role=""/>
    <member type="node" ref="9401" role="stop"/>
    <member type="node" ref="9402" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="bus"/>
    <tag k="ref" v="BT-1"/>
    <tag k="name" v="Baliwag Tricycle TODA"/>
  </relation>
  <relation id="9302" version="1" timestamp="2026-11-04T00:00:00Z">
    <member type="way" ref="9403" role=""/>
    <member type="node" ref="9401" role="stop"/>
    <member type="node" ref="9402" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="bus"/>
    <tag k="name" v="Baliwag City Bus"/>
  </relation>
  <relation id="9303" version="1" timestamp="2026-11-04T00:00:00Z">
    <member type="way" ref="9403" role=""/>
    <member type="node" ref="9401" role="stop"/>
    <member type="node" ref="9402" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="Tricycle"/>
  </relation>
  <relation id="9304" version="1" timestamp="2026-11-04T00:00:00Z">
    <member type="way" ref="9403" role=""/>
    <member type="node" ref="9401" role="stop"/>
    <member type="node" ref="9402" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="bus"/>
    <tag k="ref" v="P1"/>
    <tag k="name" v="Poblacion Service"/>
    <tag k="operator" v="Bustos Traysikel TODA"/>
  </relation>
  <relation id="9305" version="1" timestamp="2026-11-04T00:00:00Z">
    <member type="way" ref="9403" role=""/>
    <member type="node" ref="9401" role="stop"/>
    <member type="node" ref="9402" role="stop"/>
    <tag k="type" v="route"/>
    <tag k="route" v="Bus"/>
    <tag k="name" v="Baliwag Tricycle TODA Loop"/>
  </relation>
</osm>
"""


def _mistagged_bus_fixture(tmp_path) -> Path:
    path = tmp_path / "mistagged_bus_routes.osm"
    path.write_text(MISTAGGED_BUS_FIXTURE_XML, encoding="utf-8")
    return path


def _mistagged_bus_ingest(tmp_path):
    return read_route_relations(_mistagged_bus_fixture(tmp_path))


def test_mistagged_bus_tricycle_relations_are_excluded_and_counted(tmp_path):
    """R34: a bus relation naming a tricycle TODA is never published as a bus."""
    ingest = _mistagged_bus_ingest(tmp_path)
    stats = ingest.stats

    # only the ordinary bus survives; the three tricycle corridors do not become
    # bus-* routes (and therefore cannot take the city-bus fare).
    assert {relation.osm_id for relation in ingest.relations} == {9302}
    assert stats.excluded_mistagged_tricycle_count == 3
    entries = {
        entry["osm_id"]: entry
        for entry in stats.excluded_mistagged_tricycle_relations
    }
    assert sorted(entries) == [9301, 9304, 9305]
    assert entries[9301]["name"] == "Baliwag Tricycle TODA"
    for entry in entries.values():
        reason = entry["reason"]
        assert "route=bus" in reason
        assert "tricycle TODA corridor" in reason
        assert "misprice" in reason
        assert "R34" in reason


def test_an_ordinary_bus_is_unaffected_by_the_tricycle_filter(tmp_path):
    routes = {
        relation.route_id: relation
        for relation in _mistagged_bus_ingest(tmp_path).relations
    }

    bus = routes["bus-baliwagcitybus"]
    assert bus.osm_id == 9302
    assert bus.osm_route == "bus"
    assert bus.route_type == 3
    assert [stop.name for stop in bus.stops] == ["Baliwag Terminal", "Bustos Terminal"]


def test_route_tricycle_detection_is_case_insensitive(tmp_path):
    """R34: route=Tricycle is counted as tricycle, not as an unsupported value."""
    ingest = _mistagged_bus_ingest(tmp_path)
    stats = ingest.stats

    assert stats.tricycle_relations_seen == 1
    assert stats.unsupported_route == 0
    assert stats.unsupported_route_values == ()
    assert 9303 not in {relation.osm_id for relation in ingest.relations}
    assert [entry["osm_id"] for entry in stats.excluded_tricycle_relations] == [9303]
    excluded = stats.excluded_tricycle_relations[0]
    assert excluded["name"] is None  # the national capital-T relation is nameless
    assert "route=tricycle" in excluded["reason"]
    assert "never auto-ingested" in excluded["reason"]


def test_national_counter_invariant_includes_the_mistagged_bus_bucket(tmp_path):
    stats = _mistagged_bus_ingest(tmp_path).stats

    assert stats.route_relations == 5
    assert (
        stats.unsupported_route,
        stats.tricycle_relations_seen,
        stats.excluded_mistagged_tricycle_count,
        stats.candidates,
    ) == (0, 1, 3, 1)
    # every type=route relation lands in exactly one bucket (R34 extends R11)
    assert stats.route_relations == (
        stats.unsupported_route
        + stats.tricycle_relations_seen
        + stats.excluded_mistagged_tricycle_count
        + stats.candidates
    )
    assert stats.candidates == (
        stats.accepted + stats.routes_skipped_duplicate_direction
    )


def test_build_report_counters_serialise_the_mistagged_bus_bucket(tmp_path):
    document = _mistagged_bus_ingest(tmp_path).stats.as_dict()

    assert document["tricycle_relations_seen"] == 1
    assert document["excluded_tricycle_relations"][0]["osm_id"] == 9303
    assert document["excluded_mistagged_tricycle_count"] == 3
    assert [
        entry["osm_id"]
        for entry in document["excluded_mistagged_tricycle_relations"]
    ] == [9301, 9304, 9305]
    assert all(
        "R34" in entry["reason"]
        for entry in document["excluded_mistagged_tricycle_relations"]
    )


def test_relation_only_composition_reports_the_mistagged_bus_bucket(tmp_path):
    path = _mistagged_bus_fixture(tmp_path)
    composition = read_route_relation_composition(path)
    full = read_route_relations(path).stats

    assert composition.route_relations == full.route_relations == 5
    assert composition.tricycle_relations_seen == full.tricycle_relations_seen == 1
    assert composition.excluded_mistagged_tricycle_count == 3
    assert composition.excluded_mistagged_tricycle_relations == (
        full.excluded_mistagged_tricycle_relations
    )
    assert composition.candidates == full.candidates == 1
    assert composition.accepted == full.accepted == 1


# --------------------------------------------------------------------------
# unnamed stop/platform members inherit a nearby named stop (rider-facing names)
# --------------------------------------------------------------------------


def test_unnamed_platform_inherits_the_nearest_named_station():
    relation = {
        r.route_id: r for r in read_route_relations(PLATFORM_NAMES_FIXTURE).relations
    }["rail-tl"]

    names = [stop.name for stop in relation.stops]
    # way 6001 sits beside the named station node 5001, so it inherits its name
    # instead of leaking "Platform 6001"; way 6002 is out of range and keeps the
    # honest id-based fallback; node 5001 keeps its own name.
    assert names == ["Test Station", "Platform 6002", "Test Station"]
