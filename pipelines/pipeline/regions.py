"""Approximate administrative-region split of a built GTFS feed (Task 3).

Why this module exists
----------------------
The national publish (plan ``2026-11-04-ph-wide-coverage``, ruling R6/R17) has to
answer "how much of the country does this feed reach?" per region, not only in
total. No administrative-boundary dataset exists in this repository, so the only
documented geometry available is the recon pass's coarse region boxes.

The boxes below are copied verbatim from that pass and are the same ones the
recon used to bucket national route relations. They are the brief's 16
administrative regions plus BARMM (17 boxes in total); BARMM has no route
relations in the 2026-11 snapshot. Assignment follows the recon rule: NCR is
tested first, then the **smallest-area containing box** wins (ties by listed
order). Points outside every box are returned as ``"unassigned"`` rather than
forced into a neighbour.

Caveat, stated rather than hidden
---------------------------------
The boxes are **axis-aligned approximations**, not administrative boundaries.
They overlap heavily (e.g. CAR and Regions I/II, Region IV-B's sea area), so a
boundary-adjacent stop can be attributed to the neighbouring region; a route is
placed by the regions its stops touch, not by a surveyed alignment. The recon
document (``docs/research/2026-11-04-ph-wide-coverage-recon.md`` §3) states the
same caveat and calls the per-stop counts in the national feed the displayable
number — this module is that implementation. Use the counts as a coverage
indicator, never as a legal boundary or a fare-zone source.

Counting rules
--------------
* every stop row is assigned by its own coordinates; each stop is counted
  exactly once, and the per-region stop counts therefore sum to the feed total;
* a route is counted once in **each** region any of its served stops touches,
  and its trips are counted in those same regions. A cross-region route
  therefore inflates the per-region route/trip sums relative to the feed total
  by design; the ``totals`` block always reports the feed's own counts;
* routes whose served stops are all outside the boxes are counted under
  ``"unassigned"`` (never dropped), and ``"unassigned"`` is also exposed as a
  top-level key for the artifact reader.

Region V (Bicol) is grouped with Luzon, where it administratively belongs; the
recon scan's working table placed it with the Visayas, so the recon's heuristic
island numbers are not directly comparable with these administrative roll-ups.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Any, Dict, List, Tuple

from .gtfs import GtfsFeed

__all__ = [
    "REGION_BOXES",
    "REGION_NAMES",
    "REGION_ROLLUPS",
    "UNASSIGNED",
    "region_for_point",
    "regional_counts",
]

#: Bucket for a point (or route) outside every documented box.
UNASSIGNED = "unassigned"

#: One coarse region box: ``(name, lat_min, lon_min, lat_max, lon_max)``.
#: Copied verbatim from the Phase-0 recon pass (same order, same values); the
#: order breaks area ties and NCR must stay first because it is tested first.
REGION_BOXES: Tuple[Tuple[str, float, float, float, float], ...] = (
    ("NCR", 14.35, 120.90, 14.80, 121.15),
    ("CAR", 16.10, 120.45, 17.90, 121.55),
    ("Region I", 15.90, 119.70, 18.60, 121.00),
    ("Region II", 16.00, 121.00, 19.00, 122.60),
    ("Region III", 14.60, 119.70, 16.20, 121.30),
    ("Region IV-A", 13.60, 120.60, 14.95, 122.30),
    ("Region IV-B", 7.90, 116.80, 14.60, 122.40),
    ("Region V", 11.60, 122.20, 14.20, 124.50),
    ("Region VI", 9.20, 121.60, 12.00, 123.60),
    ("Region VII", 9.30, 123.20, 11.40, 124.60),
    ("Region VIII", 9.80, 124.20, 12.60, 125.70),
    ("Region IX", 5.50, 120.40, 8.60, 123.80),
    ("Region X", 7.00, 123.20, 9.40, 125.70),
    ("Region XI", 5.30, 125.00, 7.70, 126.50),
    ("Region XII", 5.50, 124.00, 7.60, 125.40),
    ("Region XIII", 8.00, 125.30, 9.90, 126.70),
    ("BARMM", 4.50, 121.00, 8.20, 125.20),
)

#: The box names in listed order, for reporting zero-count regions.
REGION_NAMES: Tuple[str, ...] = tuple(box[0] for box in REGION_BOXES)

#: Island-group roll-up -> its administrative regions (Bicol is Luzon; Mimaropa
#: is Luzon; BARMM is Mindanao). Every region appears in exactly one group.
REGION_ROLLUPS: Dict[str, List[str]] = {
    "Luzon": [
        "NCR",
        "CAR",
        "Region I",
        "Region II",
        "Region III",
        "Region IV-A",
        "Region IV-B",
        "Region V",
    ],
    "Visayas": [
        "Region VI",
        "Region VII",
        "Region VIII",
    ],
    "Mindanao": [
        "Region IX",
        "Region X",
        "Region XI",
        "Region XII",
        "Region XIII",
        "BARMM",
    ],
}


def region_for_point(lat: float, lon: float) -> str:
    """Assign one coordinate to its approximate region box, or ``"unassigned"``.

    Implements the recon rule verbatim: NCR is checked first, then the
    smallest-area containing box wins (ties broken by :data:`REGION_BOXES`
    order). Box edges are inclusive.

    The function never raises: out-of-range, non-finite or non-numeric input is
    ``"unassigned"``. That is deliberate — an artifact generator must not lose a
    whole build to one malformed row — and it keeps the honest bucket honest.

    Args:
        lat: latitude in degrees.
        lon: longitude in degrees.

    Returns:
        A name from :data:`REGION_NAMES`, or :data:`UNASSIGNED`.
    """
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return UNASSIGNED
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return UNASSIGNED

    # NCR is tested first by the recon rule, before any overlapping box.
    name, lat_min, lon_min, lat_max, lon_max = REGION_BOXES[0]
    if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
        return name

    best_key: Any = None
    best_name = UNASSIGNED
    for index, (name, lat_min, lon_min, lat_max, lon_max) in enumerate(
        REGION_BOXES[1:], start=1
    ):
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            area = (lat_max - lat_min) * (lon_max - lon_min)
            key = (area, index)
            if best_key is None or key < best_key:
                best_key = key
                best_name = name
    return best_name


def regional_counts(feed: GtfsFeed) -> Dict[str, Any]:
    """Per-region and per-island-group counts for a built feed.

    Stops are assigned by their own coordinates. A route is assigned to every
    region any of its served stops touches (once per region), and each of its
    trips is counted in those same regions; a route with no in-box stop lands in
    ``"unassigned"``. See the module docstring for why per-region route/trip
    sums can exceed the feed totals while stop counts never do.

    Args:
        feed: a built :class:`pipeline.gtfs.GtfsFeed` (``feed.stops`` carries
            the coordinates, ``feed.stop_times`` the served stops and
            ``feed.trips`` the route each trip belongs to).

    Returns:
        ``{by_region, by_island_group, unassigned, totals}`` where

        * ``by_region`` maps every region name **and** ``"unassigned"`` to
          ``{routes, stops, trips}`` (zero-count regions are listed);
        * ``by_island_group`` maps each :data:`REGION_ROLLUPS` key to the sum of
          its regions' counts;
        * ``unassigned`` repeats the unassigned bucket at the top level;
        * ``totals`` is the feed's own ``{routes, stops, trips}`` counts.
    """
    stop_region: Dict[str, str] = {}
    stop_counts: Counter = Counter()
    for stop in feed.stops:
        region = region_for_point(stop.stop_lat, stop.stop_lon)
        stop_region[stop.stop_id] = region
        stop_counts[region] += 1

    trip_routes: Dict[str, str] = {trip.trip_id: trip.route_id for trip in feed.trips}
    route_stop_ids: Dict[str, set] = {route.route_id: set() for route in feed.routes}
    for stop_time in feed.stop_times:
        route_id = trip_routes.get(stop_time.trip_id)
        if route_id is None:
            continue
        route_stop_ids.setdefault(route_id, set()).add(stop_time.stop_id)

    route_regions: Dict[str, set] = {}
    for route_id, stop_ids in route_stop_ids.items():
        touched = {
            stop_region[stop_id] for stop_id in stop_ids if stop_id in stop_region
        }
        route_regions[route_id] = touched or {UNASSIGNED}

    trips_by_route: Counter = Counter(trip.route_id for trip in feed.trips)

    by_region: Dict[str, Dict[str, int]] = {
        region: {"routes": 0, "stops": stop_counts[region], "trips": 0}
        for region in REGION_NAMES + (UNASSIGNED,)
    }
    for route_id, regions in route_regions.items():
        for region in regions:
            by_region[region]["routes"] += 1
            by_region[region]["trips"] += trips_by_route[route_id]

    by_island_group: Dict[str, Dict[str, int]] = {
        group: {
            metric: sum(by_region[region][metric] for region in regions)
            for metric in ("routes", "stops", "trips")
        }
        for group, regions in REGION_ROLLUPS.items()
    }

    totals = {
        "routes": len(feed.routes),
        "stops": len(feed.stops),
        "trips": len(feed.trips),
    }
    return {
        "by_region": by_region,
        "by_island_group": by_island_group,
        "unassigned": dict(by_region[UNASSIGNED]),
        "totals": totals,
    }
