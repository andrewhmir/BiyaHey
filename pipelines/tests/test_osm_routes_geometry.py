"""Regression tests for route-relation shape stitching (``pipeline.osm_routes``).

The bug these tests pin: ``_resolve_shape`` concatenated the geometry of a
relation's way members in relation-member order without checking that
consecutive members actually touch. OSM route relations routinely list ways out
of order, store a way against the direction of travel, or carry a stray detached
fragment (the Task 5 bbox clip also leaves members whose object is outside the
extract). The old code drew a straight line between two unrelated way endpoints,
so the app rendered beelines through buildings (MRT-3: a 13.4 km jump from Taft
to North Avenue).

The fix is endpoint stitching: chain way members that share an OSM node (or an
identical endpoint coordinate), reversing as needed; keep the main contiguous
chain and drop the detached fragments; and, when only a bare two-point shape
survives but the relation carries three or more ordered stop nodes, use those
stop coordinates instead of the two-point line.

Everything here is offline: the only input is the committed fixture
``tests/fixtures/osm_routes_stitching.osm``.
"""

from __future__ import annotations

import math
from pathlib import Path

from pipeline.osm_routes import iter_route_relations

FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes_stitching.osm"


def _by_route_id():
    return {relation.route_id: relation for relation in iter_route_relations(FIXTURE)}



def _distance_m(a, b):
    """Great-circle distance in metres between two ``(lat, lon)`` pairs."""
    lat1, lon1 = a
    lat2, lon2 = b
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371000.0 * math.asin(math.sqrt(min(1.0, h)))


# --------------------------------------------------------------------------
# endpoint stitching: relation order and way direction must not matter
# --------------------------------------------------------------------------


def test_stitches_unordered_and_reversed_way_members_into_one_chain():
    relation = _by_route_id()["bus-stitch1"]

    # members are listed 4102 (C-D-E), 4101 (A-B-C), 4103 (F-E); travel is A..F
    assert relation.shape == (
        (14.5000, 121.0000),
        (14.5050, 121.0050),
        (14.5100, 121.0100),
        (14.5150, 121.0150),
        (14.5200, 121.0200),
        (14.5250, 121.0250),
    )
    assert relation.skipped_members == 0

    # no beeline: every consecutive hop is short, the old order produced tens of km
    gaps = [
        _distance_m(earlier, later)
        for earlier, later in zip(relation.shape, relation.shape[1:])
    ]
    assert max(gaps) < 1000.0


def test_drops_detached_fragments_and_counts_them():
    relation = _by_route_id()["bus-stitch2"]

    # 4113 and 4114 share no node with the main chain, so they are dropped whole -
    # not spliced in as two more straight jumps.
    assert relation.shape == (
        (14.6000, 121.0000),
        (14.6050, 121.0050),
        (14.6100, 121.0100),
    )
    assert relation.skipped_members == 2


def test_orients_the_shape_so_it_starts_at_the_first_stop():
    relation = _by_route_id()["bus-stitch6"]

    # way 4151 is stored B->A while the stops are ordered A then B
    assert relation.shape == (
        (14.6500, 121.0500),
        (14.6550, 121.0550),
    )
    assert relation.skipped_members == 0


# --------------------------------------------------------------------------
# ordered-stop fallback for a shape that is only two way points
# --------------------------------------------------------------------------


def test_synthesises_the_shape_from_ordered_stops_when_only_two_way_points_exist():
    relation = _by_route_id()["bus-stitch3"]

    # the way gives only P..Q; the three ordered stops give P-R-Q, which is
    # strictly the better geometry (the two hops are shorter than P..Q)
    assert relation.shape == (
        (14.7000, 121.0000),
        (14.7050, 121.0020),
        (14.7100, 121.0000),
    )
    assert [stop.name for stop in relation.stops] == ["P", "R", "Q"]


def test_keeps_the_bare_two_point_shape_when_stop_order_would_zigzag():
    relation = _by_route_id()["bus-stitch5"]

    # the middle stop is ~39 km from both ends: honouring the member order would
    # replace a 10.8 km line with two 39 km beelines, which is worse
    assert relation.shape == (
        (14.4000, 121.0000),
        (14.4000, 121.1000),
    )


def test_does_not_replace_a_two_point_shape_with_fewer_than_three_stops():
    relation = _by_route_id()["bus-stitch4"]

    assert relation.shape == (
        (14.8000, 121.0000),
        (14.8050, 121.0050),
    )
