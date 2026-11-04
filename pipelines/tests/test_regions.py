"""Tests for the approximate regional split of a built feed (Task 3).

The boxes are the recon pass's documented coarse boxes (``scan-osm.py``,
recon §3), so these tests pin the assignment rule (NCR first, otherwise the
smallest-area containing box) and the honesty properties the coverage artifact
depends on: every stop lands in exactly one bucket, the ``unassigned`` bucket is
real, and the island roll-up is the sum of its regions.

They are fixture-based: the synthetic feed is built with
:func:`pipeline.gtfs.build_feed`, the same builder the publish stage uses, so a
change in the feed row shapes breaks the assignment here rather than silently
producing a wrong artifact.
"""

from __future__ import annotations

from collections import Counter
from datetime import date

from pipeline.gtfs import AgencyInfo, RouteDef, StopRef, build_feed
from pipeline.regions import (
    REGION_BOXES,
    REGION_NAMES,
    REGION_ROLLUPS,
    UNASSIGNED,
    region_for_point,
    regional_counts,
)

FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)


# ---------------------------------------------------------------------------
# region_for_point
# ---------------------------------------------------------------------------


def test_region_for_point_assigns_the_documented_pilot_coordinates():
    """The brief's pinned coordinates, including the smallest-area tie-break."""
    assert region_for_point(14.6760, 121.0437) == "NCR"  # Quezon City
    assert region_for_point(14.5995, 120.9842) == "NCR"  # Manila
    assert region_for_point(16.4023, 120.5960) == "CAR"  # Baguio
    assert region_for_point(10.3157, 123.8854) == "Region VII"  # Cebu City
    assert region_for_point(7.1907, 125.4553) == "Region XI"  # Davao City
    assert region_for_point(10.7202, 122.5621) == "Region VI"  # Iloilo City


def test_region_for_point_keeps_an_honest_unassigned_bucket():
    """Open water is ``unassigned``, never forced into a nearby region."""
    assert region_for_point(6.5, 119.0) == UNASSIGNED  # southwest Sulu Sea
    assert region_for_point(20.0, 125.0) == UNASSIGNED  # Luzon Strait


def test_region_for_point_does_not_crash_on_box_boundaries_or_bad_values():
    """Boundary values of every box return a region name; nothing raises."""
    for name, lat_min, lon_min, lat_max, lon_max in REGION_BOXES:
        for lat in (lat_min, lat_max):
            for lon in (lon_min, lon_max):
                result = region_for_point(lat, lon)
                assert isinstance(result, str)
                assert result and result != "unknown"

    # Values a caller can physically hand us must not raise either.
    assert region_for_point(float("nan"), 121.0) == UNASSIGNED
    assert region_for_point(14.6, float("inf")) == UNASSIGNED
    assert region_for_point(None, None) == UNASSIGNED  # type: ignore[arg-type]


def test_region_rollups_cover_every_box_exactly_once():
    grouped = [region for regions in REGION_ROLLUPS.values() for region in regions]

    assert set(REGION_ROLLUPS) == {"Luzon", "Visayas", "Mindanao"}
    assert sorted(grouped) == sorted(REGION_NAMES)
    assert len(grouped) == len(set(grouped))


# ---------------------------------------------------------------------------
# regional_counts
# ---------------------------------------------------------------------------


def _synthetic_feed():
    """Four routes whose stops land in NCR/CAR, VI/VII, X/XI and open water.

    The same coordinates are repeated per route with route-namespaced stop ids,
    matching the served stop identity ruling R16.
    """
    routes = [
        RouteDef(
            route_id="ncr-car",
            route_type=3,
            name="Quezon City - Baguio",
            stops=(
                StopRef("ncr-car:qc", "Quezon City", 14.6760, 121.0437),
                StopRef("ncr-car:baguio", "Baguio", 16.4023, 120.5960),
            ),
            shape=((14.6760, 121.0437), (16.4023, 120.5960)),
        ),
        RouteDef(
            route_id="vis",
            route_type=4,
            name="Cebu - Iloilo",
            stops=(
                StopRef("vis:cebu", "Cebu City", 10.3157, 123.8854),
                StopRef("vis:iloilo", "Iloilo City", 10.7202, 122.5621),
            ),
            shape=((10.3157, 123.8854), (10.7202, 122.5621)),
        ),
        RouteDef(
            route_id="mind",
            route_type=3,
            name="Davao - Cagayan de Oro",
            stops=(
                StopRef("mind:davao", "Davao City", 7.1907, 125.4553),
                StopRef("mind:cdo", "Cagayan de Oro", 8.4800, 124.6500),
            ),
            shape=((7.1907, 125.4553), (8.4800, 124.6500)),
        ),
        RouteDef(
            route_id="sea",
            route_type=4,
            name="Open-water fixture",
            stops=(
                StopRef("sea:a", "Sulu Sea A", 6.5000, 119.0000),
                StopRef("sea:b", "Sulu Sea B", 6.6000, 119.1000),
            ),
            shape=((6.5000, 119.0000), (6.6000, 119.1000)),
        ),
    ]
    feed = build_feed(routes, AgencyInfo.SYNTHETIC, FEED_START, FEED_END)
    # A skipped route would make every count assertion below vacuous.
    assert len(feed.routes) == len(routes)
    return feed


def test_regional_counts_assigns_every_stop_exactly_once():
    feed = _synthetic_feed()
    counts = regional_counts(feed)
    by_region = counts["by_region"]

    assert counts["totals"] == {
        "routes": len(feed.routes),
        "stops": len(feed.stops),
        "trips": len(feed.trips),
    }
    # Every region is listed (zero counts included), plus the honest bucket.
    assert set(by_region) == set(REGION_NAMES) | {UNASSIGNED}
    # Each stop row belongs to exactly one bucket: the coordinate assignment.
    expected = Counter(
        region_for_point(stop.stop_lat, stop.stop_lon) for stop in feed.stops
    )
    for region in by_region:
        assert by_region[region]["stops"] == expected[region]
    assert sum(by_region[region]["stops"] for region in by_region) == len(feed.stops)
    # A region with no stops in this fixture is still reported, with zeros.
    assert by_region["BARMM"] == {"routes": 0, "stops": 0, "trips": 0}


def test_regional_counts_counts_a_route_once_per_region_its_stops_touch():
    feed = _synthetic_feed()
    by_region = regional_counts(feed)["by_region"]
    trips = Counter(trip.route_id for trip in feed.trips)

    assert by_region["NCR"]["routes"] == 1
    assert by_region["CAR"]["routes"] == 1
    assert by_region["NCR"]["trips"] == trips["ncr-car"]
    assert by_region["CAR"]["trips"] == trips["ncr-car"]

    assert by_region["Region VI"]["routes"] == 1
    assert by_region["Region VII"]["routes"] == 1
    assert by_region["Region X"]["routes"] == 1
    assert by_region["Region XI"]["routes"] == 1

    # A route whose every stop is outside the boxes is never silently dropped.
    assert by_region[UNASSIGNED]["routes"] == 1
    assert by_region[UNASSIGNED]["stops"] == 2
    assert by_region[UNASSIGNED]["trips"] == trips["sea"]


def test_island_group_rollup_is_the_sum_of_its_regions():
    counts = regional_counts(_synthetic_feed())
    by_region = counts["by_region"]
    by_island_group = counts["by_island_group"]

    for group, regions in REGION_ROLLUPS.items():
        for metric in ("routes", "stops", "trips"):
            assert by_island_group[group][metric] == sum(
                by_region[region][metric] for region in regions
            ), (group, metric)

    # Spot-check the geography: one route spans Luzon's NCR/CAR boxes, one
    # spans the Visayas' VI/VII, one spans Mindanao's X/XI, and the last is
    # unassigned. Routes/trips are summed per region, so a route touching two
    # regions of one island group contributes twice (and the sums deliberately
    # exceed the feed totals) while stops never do.
    assert by_island_group["Luzon"]["routes"] == 2
    assert by_island_group["Luzon"]["stops"] == 2
    assert by_island_group["Visayas"]["routes"] == 2
    assert by_island_group["Visayas"]["stops"] == 2
    assert by_island_group["Mindanao"]["routes"] == 2
    assert by_island_group["Mindanao"]["stops"] == 2
    assert counts["unassigned"] == by_region[UNASSIGNED]
