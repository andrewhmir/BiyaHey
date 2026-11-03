"""Tests for pipeline stage 02: OSM route relations to the GTFS core.

Everything here is offline: the only OSM input is the hand-written, committed
fixture ``tests/fixtures/osm_routes.osm``. No test opens a socket, downloads a
PBF or queries an OSM API. The fixture deliberately carries dangling relation
members (the Task 5 bbox clip keeps complete ways but may drop the objects a
relation points at), so these tests prove the builder skips them and records
the count instead of crashing.

Trip-count arithmetic (the test pins the *implemented* formula, not the plan's
placeholder 272):

    service 05:00-22:00; peak 06:00-09:00 and 16:00-19:00
    peak:    2 windows x 180 min / 4-min headway = 90 departures per direction
    offpeak: 60/9 -> 7, 420/9 -> 47, 180/9 -> 20       = 74 departures per direction
    90 + 74 = 164 per direction; x 2 directions        = 328 trips
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path

import osmium
import pytest

from pipeline.gtfs import (
    ODBL_ATTRIBUTION,
    AgencyInfo,
    build_feed,
    generate_trips,
)
from pipeline.osm_routes import iter_route_relations

FIXTURE = Path(__file__).parent / "fixtures" / "osm_routes.osm"
FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)

#: Every table the GTFS core and the licence gate depend on (Task 6 contract).
REQUIRED_TABLES = {
    "agency.txt",
    "routes.txt",
    "stops.txt",
    "trips.txt",
    "stop_times.txt",
    "shapes.txt",
    "calendar.txt",
    "feed_info.txt",
    "LICENSE-DATA.txt",
}

#: Route ids the fixture must produce. ``rail-mrt3`` and ``ferry-pasig`` are the
#: pinned Task 10 namespacing examples; ``bus-b1`` pins the bus namespace.
EXPECTED_ROUTE_IDS = {"rail-mrt3", "ferry-pasig", "bus-b1", "bus-b2"}

#: Spec Appendix A attribution, hardcoded on purpose (``©`` U+00A9, em dash
#: U+2014). The production constant ``pipeline.gtfs.ODBL_ATTRIBUTION`` must
#: never be interpolated here: the file is built from that constant, so a typo
#: or corruption in it could otherwise never fail the licence gate.
SPEC_APPENDIX_A_ATTRIBUTION = (
    "© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0"
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _relations():
    """Read the fixture once per call (cheap; the parser makes three passes)."""
    return list(iter_route_relations(FIXTURE))


def _by_route_id():
    return {relation.route_id: relation for relation in _relations()}


def _feed():
    return build_feed(
        _relations(),
        agency=AgencyInfo.SYNTHETIC,
        feed_start=FEED_START,
        feed_end=FEED_END,
    )


def _csv_rows(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    text = zf.read(name).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


# --------------------------------------------------------------------------
# route relations from OSM (including dangling members)
# --------------------------------------------------------------------------


def test_reads_route_relations_and_namespaces_the_route_ids():
    relations = _by_route_id()

    assert set(relations) == EXPECTED_ROUTE_IDS
    assert {"rail-mrt3", "ferry-pasig"} <= set(relations)

    # mode mapping pinned by the plan/task contract
    assert relations["rail-mrt3"].route_type == 1  # light_rail
    assert relations["ferry-pasig"].route_type == 4  # ferry
    assert relations["bus-b1"].route_type == 3  # bus

    # route=road is not a public-transport mode and must be ignored
    assert all(relation.osm_route != "road" for relation in relations.values())


def test_skips_dangling_members_and_still_resolves_the_geometry():
    rail = _by_route_id()["rail-mrt3"]

    # way 8999 (geometry) and node 9999 (stop) are dangling in the fixture
    assert rail.skipped_members == 2

    # ways 2001 + 2002 share node 1002: five points, no duplicated junction
    assert len(rail.shape) == 5
    assert rail.shape[0] == pytest.approx((14.6000, 121.0000))
    assert rail.shape[-1] == pytest.approx((14.6100, 121.0100))

    # the resolvable stop members become stops, in relation-member order
    assert [stop.name for stop in rail.stops] == [
        "North Avenue",
        "Quezon Avenue",
        "GMA Kamuning",
    ]


def test_synthesises_landmark_stops_when_a_relation_has_no_stop_members():
    ferry = _by_route_id()["ferry-pasig"]

    assert ferry.stops
    assert [stop.name for stop in ferry.stops] == ["Guadalupe", "Pasig"]
    # positions come from the first/last shape vertex
    assert ferry.stops[0].lat == pytest.approx(14.5650)
    assert ferry.stops[0].lon == pytest.approx(121.0450)
    assert ferry.stops[-1].lat == pytest.approx(14.5750)
    assert ferry.stops[-1].lon == pytest.approx(121.0600)


def test_stop_ids_are_route_namespaced_and_stable_across_reads():
    first = {
        route_id: [stop.stop_id for stop in relation.stops]
        for route_id, relation in _by_route_id().items()
    }
    second = {
        route_id: [stop.stop_id for stop in relation.stops]
        for route_id, relation in _by_route_id().items()
    }

    assert first == second  # stable: no hash/order-dependent ids
    all_ids = [stop_id for ids in first.values() for stop_id in ids]
    assert len(all_ids) == len(set(all_ids))  # no cross-route collisions
    for route_id, stop_ids in first.items():
        assert all(stop_id.startswith(f"{route_id}:") for stop_id in stop_ids)


def test_missing_osm_file_raises_a_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="absent.osm"):
        list(iter_route_relations(tmp_path / "absent.osm"))


def test_reads_the_same_relations_from_pbf(tmp_path):
    """The reader must accept both committed XML and the production PBF form."""
    destination = tmp_path / "osm_routes.osm.pbf"
    with osmium.SimpleWriter(str(destination), header=osmium.io.Header()) as writer:
        for obj in osmium.FileProcessor(str(FIXTURE)):
            if obj.is_node():
                writer.add_node(obj)
            elif obj.is_way():
                writer.add_way(obj)
            else:
                writer.add_relation(obj)

    from_xml = {relation.route_id: relation for relation in iter_route_relations(FIXTURE)}
    from_pbf = {
        relation.route_id: relation
        for relation in iter_route_relations(destination)
    }

    assert set(from_pbf) == set(from_xml)
    assert from_pbf["rail-mrt3"].shape == from_xml["rail-mrt3"].shape
    assert from_pbf["rail-mrt3"].skipped_members == 2


# --------------------------------------------------------------------------
# generate_trips: the pinned arithmetic
# --------------------------------------------------------------------------


def test_generate_trips_pins_the_both_directions_arithmetic():
    trips = generate_trips(headway_peak_min=4, headway_offpeak_min=9)

    # 2 * (90 peak + 74 offpeak) == 328; see the module docstring arithmetic.
    assert len(trips) == 328
    assert Counter(trip.direction_id for trip in trips) == {0: 164, 1: 164}
    assert {trip.direction_id for trip in trips} == {0, 1}

    departures = [trip.departure_time for trip in trips]
    assert min(departures) == "05:00:00"
    assert max(departures) == "21:51:00"
    assert all("05:00:00" <= departure < "22:00:00" for departure in departures)

    # 2 directions x 45 departures in each of the two peak windows
    peak = [
        departure
        for departure in departures
        if ("06:00:00" <= departure < "09:00:00")
        or ("16:00:00" <= departure < "19:00:00")
    ]
    assert len(peak) == 180
    # 2 directions x (7 + 47 + 20) off-peak departures
    assert len(departures) - len(peak) == 148


def test_generate_trips_rejects_non_positive_headways():
    with pytest.raises(ValueError, match="headway"):
        generate_trips(headway_peak_min=0, headway_offpeak_min=9)
    with pytest.raises(ValueError, match="headway"):
        generate_trips(headway_peak_min=4, headway_offpeak_min=-1)


# --------------------------------------------------------------------------
# build_feed / GtfsFeed.write
# --------------------------------------------------------------------------


def test_build_feed_skips_unresolved_geometry_and_counts_it():
    feed = _feed()

    assert feed.stats.routes_in == 4
    assert feed.stats.routes_written == 3
    assert feed.stats.routes_skipped_no_geometry == 1
    # two dangling members on rail-mrt3 plus one on the unresolved bus-b2
    assert feed.stats.dangling_members == 3

    route_ids = {row.route_id for row in feed.routes}
    assert route_ids == {"rail-mrt3", "ferry-pasig", "bus-b1"}
    assert "bus-b2" not in route_ids  # no resolvable way member


def test_write_produces_the_required_gtfs_tables_and_the_odbl_notice(tmp_path):
    feed = _feed()
    out = tmp_path / "gtfs.zip"
    feed.write(out)

    with zipfile.ZipFile(out) as zf:
        assert REQUIRED_TABLES <= set(zf.namelist())
        licence = zf.read("LICENSE-DATA.txt").decode("utf-8-sig")

        # The hardcoded Appendix A literal must be in the generated file. This
        # intentionally does not compare the constant with itself.
        assert SPEC_APPENDIX_A_ATTRIBUTION in licence

        # Independent gate: the file must explicitly say what it is for - that
        # the feed is published under ODbL 1.0 - regardless of the attribution
        # constant and of the attribution line above.
        flattened = " ".join(licence.split())
        assert "published under the Open Database License (ODbL) 1.0" in flattened

        # Wiring check: the constant is still the one embedded in the notice.
        assert ODBL_ATTRIBUTION in licence

        routes = _csv_rows(zf, "routes.txt")
        assert {row["route_id"] for row in routes} == {
            "rail-mrt3",
            "ferry-pasig",
            "bus-b1",
        }
        assert {row["route_type"] for row in routes} == {"1", "3", "4"}

        stops = _csv_rows(zf, "stops.txt")
        assert len({row["stop_id"] for row in stops}) == len(stops)

        calendar = _csv_rows(zf, "calendar.txt")
        assert len(calendar) == 1
        assert calendar[0]["start_date"] == "20261101"
        assert calendar[0]["end_date"] == "20271031"
        assert all(calendar[0][day] == "1" for day in (
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ))

        feed_info = _csv_rows(zf, "feed_info.txt")
        assert feed_info[0]["feed_start_date"] == "20261101"
        assert feed_info[0]["feed_end_date"] == "20271031"
        assert feed_info[0]["feed_lang"] == "en"


def test_odbl_attribution_constant_matches_the_spec_appendix_a_literal():
    """A future edit to the constant fails loudly (separate from the file gate)."""
    assert ODBL_ATTRIBUTION == SPEC_APPENDIX_A_ATTRIBUTION


def test_trip_count_in_the_feed_follows_the_headway_formula():
    feed = _feed()

    # 3 written routes x 328 trips; each route uses the default 4/9 min headways
    assert len(feed.trips) == 3 * 328
    assert {trip.route_id for trip in feed.trips} == {
        "rail-mrt3",
        "ferry-pasig",
        "bus-b1",
    }
    assert {trip.direction_id for trip in feed.trips} == {0, 1}


def test_stop_times_are_monotonic_within_every_trip():
    feed = _feed()
    grouped = feed.stop_times_by_trip()

    assert len(grouped) == len(feed.trips)
    for trip_stops in grouped:
        assert len(trip_stops) >= 2
        assert [row.stop_sequence for row in trip_stops] == list(
            range(1, len(trip_stops) + 1)
        )
        assert all(
            earlier.time <= later.time
            for earlier, later in zip(trip_stops, trip_stops[1:])
        )


def test_shapes_table_carries_the_relation_way_geometry_per_direction():
    feed = _feed()
    shapes: dict[str, list] = {}
    for row in feed.shapes:
        shapes.setdefault(row.shape_id, []).append(row)

    # GTFS shapes are ordered in *travel* order, so a shape must not be shared by
    # both directions: each route gets one per direction, the second reversed.
    assert set(shapes) == {
        f"{row.route_id}:shape:{direction}"
        for row in feed.routes
        for direction in (0, 1)
    }

    rail = sorted(shapes["rail-mrt3:shape:0"], key=lambda row: row.shape_pt_sequence)
    assert len(rail) == 5
    assert (rail[0].shape_pt_lat, rail[0].shape_pt_lon) == pytest.approx(
        (14.6000, 121.0000)
    )
    assert (rail[-1].shape_pt_lat, rail[-1].shape_pt_lon) == pytest.approx(
        (14.6100, 121.0100)
    )

    # the return direction traverses the same geometry in the opposite order
    rail_return = sorted(
        shapes["rail-mrt3:shape:1"], key=lambda row: row.shape_pt_sequence
    )
    assert len(rail_return) == 5
    assert (rail_return[0].shape_pt_lat, rail_return[0].shape_pt_lon) == pytest.approx(
        (14.6100, 121.0100)
    )
    assert (rail_return[-1].shape_pt_lat, rail_return[-1].shape_pt_lon) == pytest.approx(
        (14.6000, 121.0000)
    )

    # every shape point has a globally valid coordinate and a 1-based sequence
    for rows in shapes.values():
        assert [row.shape_pt_sequence for row in rows] == list(range(1, len(rows) + 1))
        assert all(-90.0 <= row.shape_pt_lat <= 90.0 for row in rows)
        assert all(-180.0 <= row.shape_pt_lon <= 180.0 for row in rows)


def test_trips_reference_the_shape_for_their_travel_direction():
    feed = _feed()

    # A direction-1 trip reverses the stop sequence, so it must also reference the
    # reversed shape; sharing the direction-0 shape is what let MOTIS draw the
    # whole trip shape as a multi-kilometre beeline on the return leg.
    for trip in feed.trips:
        assert trip.shape_id == f"{trip.route_id}:shape:{trip.direction_id}"


def test_write_is_deterministic(tmp_path):
    """A rebuild of the same feed must be byte-identical (manifest sha256, Task 8)."""
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"
    _feed().write(first)
    _feed().write(second)
    assert first.read_bytes() == second.read_bytes()
