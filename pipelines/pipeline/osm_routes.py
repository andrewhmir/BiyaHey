"""OSM route relations to :class:`pipeline.gtfs.RouteDef` (Task 6, OSM side).

What this reader does
---------------------
``iter_route_relations`` reads an ``.osm`` or ``.osm.pbf`` file with pyosmium
and yields one :class:`RouteRelation` (a :class:`~pipeline.gtfs.RouteDef`) per
``type=route`` relation whose ``route=*`` value is a public-transport mode.

Geometry resolution needs objects the relation only *references*, and the
objects are read in separate streaming passes because pyosmium exposes one
object type at a time:

1. relations — copy the supported route tags and member list;
2. ways — node refs for every member way, plus names of stop/platform ways;
3. nodes — coordinates for every needed node, plus names of stop nodes.

The Task 5 bbox clip keeps complete ways but can leave **dangling relation
members** (a member pointing at an object that is not in the extract), and
open-data OSM relations routinely reference objects that were deleted. Such
members are skipped, counted in :attr:`RouteRelation.skipped_members`, and
never crash the build.

Route ids (pinned contract for Task 10)
---------------------------------------
GTFS ``route_id`` values are namespaced by mode family so the BFF can map them
back to app modes without a lookup table:

===============  =======================  ==============  =====================
OSM ``route=``   mode prefix               GTFS type       example
===============  =======================  ==============  =====================
light_rail       ``rail-``                 1               ``rail-mrt3``
subway           ``rail-``                 1               ``rail-lrt2``
train            ``rail-``                 1               ``rail-pnr``
ferry            ``ferry-``                4               ``ferry-pasig``
bus              ``bus-``                  3               ``bus-b1``
share_taxi       ``jeep-`` or ``uv-``      3               ``jeep-t1010``
jeepney          ``jeep-``                 3               ``jeep-t1010``
===============  =======================  ==============  =====================

The slug after the prefix is the relation's ``ref`` tag (falling back to
``name``, then the OSM id), lowercased and stripped to ASCII alphanumerics:
``ref=MRT-3`` becomes ``rail-mrt3`` and ``ref=Pasig`` becomes
``ferry-pasig``. ``share_taxi`` is ambiguous in OSM; relations whose name or
ref mentions "UV Express" become ``uv-`` (the curated inventory in Task 7 is
authoritative for jeepney/UV coverage).

Stops and shapes
----------------
Member nodes/ways with a role of ``stop``, ``platform``, ``stop_position``,
``boarding_position`` or ``stop_area`` become stops, in relation-member order.
A stop-platform way is represented by the centroid of its nodes. Stop ids are
namespaced by route id (``<route_id>:node:<osm id>``, ``<route_id>:way:<osm id>``
or ``<route_id>:landmark:<n>``) so they are stable and collision-free.

When a relation carries no stop members (common for ferries and older bus
relations), two landmark stops are synthesized from the first/last shape
vertex and named from the relation's ``from``/``to`` tags, else from a route
name split on a separator.

Shape geometry is *stitched*, not merely concatenated: member ways are chained
by shared endpoints (an OSM node id, or an identical endpoint coordinate) and
reversed where needed, because OSM relations routinely list ways out of order,
store a way against the direction of travel, or carry a detached fragment left
behind by mapping errors or by the bbox clip. The chain that covers the most
stops (then the longest) becomes the shape; detached fragment chains are
dropped and counted in :attr:`RouteRelation.skipped_members` instead of being
spliced in as multi-kilometre beelines. A relation whose only usable geometry
is a two-point line but which carries three or more ordered stop members gets
its shape synthesized from those stops (see :func:`_synthesise_shape_from_stops`).

The reader is offline by construction: it only opens the path it is given.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterator, List, Mapping, Optional, Sequence, Set, Tuple

import osmium

from .gtfs import (
    AgencyInfo,
    DEFAULT_HEADWAY_OFFPEAK_MIN,
    DEFAULT_HEADWAY_PEAK_MIN,
    RouteDef,
    StopRef,
)

__all__ = [
    "AgencyInfo",
    "RouteRelation",
    "iter_route_relations",
    "route_type_for",
]

#: OSM ``route=*`` value -> GTFS route_type (pinned mode mapping).
ROUTE_TYPE_BY_OSM_ROUTE: Dict[str, int] = {
    "light_rail": 1,
    "subway": 1,
    "train": 1,
    "ferry": 4,
    "bus": 3,
    "share_taxi": 3,
    "jeepney": 3,
}

#: Member roles that describe a stop/platform rather than route geometry.
STOP_ROLES = frozenset(
    {"stop", "platform", "stop_position", "boarding_position", "stop_area"}
)

_Member = Tuple[str, int, str]  # (type 'n'|'w'|'r', ref, role)


@dataclass(frozen=True)
class RouteRelation(RouteDef):
    """A parsed route relation: a RouteDef plus its OSM identity and skip count."""

    osm_id: int = 0
    osm_route: str = ""
    skipped_members: int = 0


@dataclass
class _Candidate:
    """The relation tags and member list copied during the first pass."""

    osm_id: int
    tags: Dict[str, str]
    members: List[_Member]


def route_type_for(osm_route: str) -> int:
    """Map an OSM ``route=*`` value to a GTFS ``route_type``.

    Raises:
        ValueError: if the value is not a supported public-transport mode.
    """
    try:
        return ROUTE_TYPE_BY_OSM_ROUTE[osm_route]
    except KeyError as exc:
        raise ValueError(f"unsupported OSM route value: {osm_route!r}") from exc


def iter_route_relations(path: Path) -> Iterator[RouteRelation]:
    """Read every supported route relation from an OSM extract.

    Args:
        path: ``.osm`` or ``.osm.pbf`` file (the NCR extract in production, the
            committed fixture in tests).

    Returns:
        An iterator over :class:`RouteRelation` in file order. A relation with
        no resolvable geometry is still yielded (with an empty shape) so the
        GTFS builder can count the skip.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        osmium.RuntimeError: if pyosmium cannot parse the file.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"OSM extract not found: {source}")

    candidates = _read_route_candidates(source)
    if not candidates:
        return iter(())

    needed_way_ids: Set[int] = set()
    stop_way_ids: Set[int] = set()
    needed_node_ids: Set[int] = set()
    stop_node_ids: Set[int] = set()
    for candidate in candidates:
        for member_type, ref, role in candidate.members:
            if member_type == "w":
                needed_way_ids.add(ref)
                if role in STOP_ROLES:
                    stop_way_ids.add(ref)
            elif member_type == "n" and role in STOP_ROLES:
                needed_node_ids.add(ref)
                stop_node_ids.add(ref)

    way_nodes, way_names = _read_ways(source, needed_way_ids, stop_way_ids)
    for refs in way_nodes.values():
        needed_node_ids.update(refs)
    node_coords, node_names = _read_nodes(source, needed_node_ids, stop_node_ids)

    relations = [
        _resolve(candidate, way_nodes, way_names, node_coords, node_names)
        for candidate in candidates
    ]
    return iter(relations)


# --------------------------------------------------------------------------
# streaming passes
# --------------------------------------------------------------------------


def _read_route_candidates(source: Path) -> List[_Candidate]:
    """Pass 1: copy tags and members of every supported ``type=route`` relation."""
    candidates: List[_Candidate] = []
    for obj in osmium.FileProcessor(str(source), osmium.osm.RELATION):
        if not obj.is_relation():
            continue
        tags = dict(obj.tags)
        if tags.get("type") != "route":
            continue
        osm_route = tags.get("route", "")
        if osm_route not in ROUTE_TYPE_BY_OSM_ROUTE:
            continue
        members: List[_Member] = [
            (member.type, member.ref, member.role or "") for member in obj.members
        ]
        candidates.append(_Candidate(obj.id, tags, members))
    return candidates


def _read_ways(
    source: Path, needed_way_ids: Set[int], stop_way_ids: Set[int]
) -> Tuple[Dict[int, Tuple[int, ...]], Dict[int, str]]:
    """Pass 2: node refs for needed ways, names for stop/platform ways."""
    way_nodes: Dict[int, Tuple[int, ...]] = {}
    way_names: Dict[int, str] = {}
    if not needed_way_ids:
        return way_nodes, way_names

    for obj in osmium.FileProcessor(str(source), osmium.osm.WAY):
        if obj.id not in needed_way_ids:
            continue
        way_nodes[obj.id] = tuple(node.ref for node in obj.nodes)
        if obj.id in stop_way_ids:
            way_names[obj.id] = dict(obj.tags).get("name", "")
    return way_nodes, way_names


def _read_nodes(
    source: Path, needed_node_ids: Set[int], stop_node_ids: Set[int]
) -> Tuple[Dict[int, Tuple[float, float]], Dict[int, str]]:
    """Pass 3: coordinates for needed nodes, names for stop nodes."""
    node_coords: Dict[int, Tuple[float, float]] = {}
    node_names: Dict[int, str] = {}
    if not needed_node_ids:
        return node_coords, node_names

    for obj in osmium.FileProcessor(str(source), osmium.osm.NODE):
        if obj.id not in needed_node_ids:
            continue
        if not obj.location.valid():
            continue
        node_coords[obj.id] = (obj.location.lat, obj.location.lon)
        if obj.id in stop_node_ids:
            node_names[obj.id] = dict(obj.tags).get("name", "")
    return node_coords, node_names


# --------------------------------------------------------------------------
# relation resolution
# --------------------------------------------------------------------------


def _resolve(
    candidate: _Candidate,
    way_nodes: Mapping[int, Sequence[int]],
    way_names: Mapping[int, str],
    node_coords: Mapping[int, Tuple[float, float]],
    node_names: Mapping[int, str],
) -> RouteRelation:
    """Turn one copied relation into a RouteRelation, counting dangling members."""
    tags = candidate.tags
    route_id = _route_id(candidate)
    skipped = 0

    # Stops are resolved first: the shape resolver uses them to decide which
    # contiguous chain is the route's main line, and the ordered-stop fallback
    # below needs them. Neither resolver depends on the other's result.
    stops = _resolve_stops(
        candidate.members, route_id, way_nodes, way_names, node_coords, node_names
    )
    skipped += stops.skipped
    unique_stops = _dedupe_stops(stops.stops)

    shape = _resolve_shape(
        candidate.members,
        way_nodes,
        node_coords,
        stop_coords=tuple((stop.lat, stop.lon) for stop in unique_stops),
    )
    skipped += shape.skipped
    shape = _synthesise_shape_from_stops(shape, unique_stops)

    if not unique_stops and shape.points:
        start_name, end_name = _landmark_names(tags)
        unique_stops = (
            StopRef(
                f"{route_id}:landmark:0",
                start_name,
                shape.points[0][0],
                shape.points[0][1],
            ),
            StopRef(
                f"{route_id}:landmark:1",
                end_name,
                shape.points[-1][0],
                shape.points[-1][1],
            ),
        )

    osm_route = tags.get("route", "")
    return RouteRelation(
        route_id=route_id,
        route_type=route_type_for(osm_route),
        name=tags.get("name") or tags.get("ref") or f"OSM route {candidate.osm_id}",
        short_name=tags.get("ref", ""),
        stops=unique_stops,
        shape=shape.points,
        distance_km=None,
        headway_peak_min=DEFAULT_HEADWAY_PEAK_MIN,
        headway_offpeak_min=DEFAULT_HEADWAY_OFFPEAK_MIN,
        osm_id=candidate.osm_id,
        osm_route=osm_route,
        skipped_members=skipped,
    )


#: Mean Earth radius in metres, for the endpoint/stop scoring distances.
_EARTH_RADIUS_M = 6371000.0

#: A stop counts as served by a candidate chain when a chain vertex is this
#: close to it (metres). Stop-position nodes that are part of a way are exact
#: vertices, so this only matters for platform-centroid stops.
_STOP_COVERAGE_M = 100.0

Point = Tuple[float, float]


@dataclass(frozen=True)
class _ShapeResult:
    points: Tuple[Tuple[float, float], ...]
    skipped: int


@dataclass(frozen=True)
class _ShapeSegment:
    """One usable way member: its OSM node refs and resolved coordinates."""

    node_refs: Tuple[int, ...]
    coords: Tuple[Point, ...]
    role: str

    @property
    def start_node(self) -> int:
        return self.node_refs[0]

    @property
    def end_node(self) -> int:
        return self.node_refs[-1]


def _resolve_shape(
    members: Sequence[_Member],
    way_nodes: Mapping[int, Sequence[int]],
    node_coords: Mapping[int, Tuple[float, float]],
    stop_coords: Sequence[Point] = (),
) -> _ShapeResult:
    """Resolve the relation's way members into one stitched contiguous shape.

    Way members are chained by shared endpoints - an identical OSM node id, or
    an identical endpoint coordinate - and reversed when the stored direction
    points the wrong way, so neither relation order nor a way's ``role`` can
    introduce a straight jump. The chain that covers the most stops (then the
    longest) is the route shape; remaining chains are detached fragments and are
    dropped, counted once each in :attr:`_ShapeResult.skipped`.

    Args:
        members: the relation's members in relation order.
        way_nodes: OSM way id -> node refs.
        node_coords: OSM node id -> ``(lat, lon)``.
        stop_coords: the relation's resolved stops in member order, used to score
            which chain is the main line and to orient the result.

    Ways whose geometry cannot be resolved (dangling after the bbox clip, or a
    node without coordinates) are counted as skipped too.
    """
    segments: List[_ShapeSegment] = []
    skipped = 0

    for member_type, ref, role in members:
        if member_type == "r":
            skipped += 1  # nested relations are not resolved in v1
            continue
        if member_type != "w" or role in STOP_ROLES:
            continue
        node_refs = way_nodes.get(ref)
        if not node_refs:
            skipped += 1
            continue
        coords: List[Point] = []
        resolved = True
        for node_ref in node_refs:
            coord = node_coords.get(node_ref)
            if coord is None:
                resolved = False
                break
            coords.append(coord)
        if not resolved:
            skipped += 1
            continue
        if len(coords) < 2:
            skipped += 1  # a one-node way is a point, not a segment
            continue
        segments.append(_ShapeSegment(tuple(node_refs), tuple(coords), role))

    if not segments:
        return _ShapeResult((), skipped)

    chains = _build_shape_chains(segments)
    chain_coords = [_chain_coords(segments, chain) for chain in chains]
    best = max(
        range(len(chains)),
        key=lambda index: (_chain_score(chain_coords[index], stop_coords), -index),
    )
    # Every chain that is not the main line is a detached fragment, counted once:
    # the count says how many pieces were dropped, not how many ways they used.
    skipped += len(chains) - 1

    points = _orient_to_stops(list(chain_coords[best]), stop_coords)
    return _ShapeResult(tuple(points), skipped)


def _build_shape_chains(
    segments: Sequence[_ShapeSegment],
) -> List[List[Tuple[int, bool]]]:
    """Chain way segments into maximal contiguous runs by shared endpoints.

    Returns one chain per connected run; each entry is ``(segment index,
    reversed)`` in travel order. Greedy but deterministic: the longest remaining
    segment seeds a chain, then unused segments are attached to the tail first
    and the head second until nothing connects.
    """
    unused = list(range(len(segments)))
    chains: List[List[Tuple[int, bool]]] = []
    while unused:
        seed = max(unused, key=lambda index: (len(segments[index].coords), -index))
        unused.remove(seed)
        chain: List[Tuple[int, bool]] = [(seed, False)]
        head_node = segments[seed].start_node
        head_coord = segments[seed].coords[0]
        tail_node = segments[seed].end_node
        tail_coord = segments[seed].coords[-1]
        while True:
            attachment = _find_attachment(
                segments, unused, tail_node, tail_coord, append_to_tail=True
            )
            if attachment is not None:
                index, reverse = attachment
                unused.remove(index)
                chain.append((index, reverse))
                segment = segments[index]
                if reverse:
                    tail_node, tail_coord = segment.start_node, segment.coords[0]
                else:
                    tail_node, tail_coord = segment.end_node, segment.coords[-1]
                continue
            attachment = _find_attachment(
                segments, unused, head_node, head_coord, append_to_tail=False
            )
            if attachment is not None:
                index, reverse = attachment
                unused.remove(index)
                chain.insert(0, (index, reverse))
                segment = segments[index]
                if reverse:
                    head_node, head_coord = segment.end_node, segment.coords[-1]
                else:
                    head_node, head_coord = segment.start_node, segment.coords[0]
                continue
            break
        chains.append(chain)
    return chains


def _find_attachment(
    segments: Sequence[_ShapeSegment],
    unused: Sequence[int],
    node_ref: int,
    coord: Point,
    *,
    append_to_tail: bool,
) -> Optional[Tuple[int, bool]]:
    """Find an unused segment touching an endpoint of the chain.

    Args:
        segments: all segments of the relation.
        unused: indexes of segments not yet chained.
        node_ref: OSM node id at the chain endpoint.
        coord: coordinate at the chain endpoint (fallback match).
        append_to_tail: extend the tail when true, prepend to the head otherwise.

    Returns:
        ``(segment index, reverse)`` where ``reverse`` says the segment's stored
        coordinate order must be flipped to join that endpoint, or ``None``.
        A shared OSM node is a stronger match than an identical coordinate;
        among equals the longest segment wins (at a junction it is more likely
        the mainline), then relation order.
    """
    node_matches: List[Tuple[int, bool]] = []
    coord_matches: List[Tuple[int, bool]] = []
    for index in unused:
        segment = segments[index]
        if append_to_tail:
            if segment.start_node == node_ref:
                node_matches.append((index, False))
            elif segment.end_node == node_ref:
                node_matches.append((index, True))
            elif segment.coords[0] == coord:
                coord_matches.append((index, False))
            elif segment.coords[-1] == coord:
                coord_matches.append((index, True))
            continue
        if segment.end_node == node_ref:
            node_matches.append((index, False))
        elif segment.start_node == node_ref:
            node_matches.append((index, True))
        elif segment.coords[-1] == coord:
            coord_matches.append((index, False))
        elif segment.coords[0] == coord:
            coord_matches.append((index, True))
    for matches in (node_matches, coord_matches):
        if matches:
            return max(
                matches, key=lambda match: (len(segments[match[0]].coords), -match[0])
            )
    return None


def _chain_coords(
    segments: Sequence[_ShapeSegment], chain: Sequence[Tuple[int, bool]]
) -> Tuple[Point, ...]:
    """Concatenate a chain in travel order, dropping duplicated junction points."""
    points: List[Point] = []
    for index, reversed_segment in chain:
        coords = segments[index].coords
        if reversed_segment:
            coords = tuple(reversed(coords))
        for coord in coords:
            if not points or points[-1] != coord:
                points.append(coord)
    return tuple(points)


def _chain_score(
    points: Sequence[Point], stop_coords: Sequence[Point]
) -> Tuple[int, float]:
    """Main-chain score: stops served, then total length in metres.

    Both components are "bigger is better", so the shape of a relation that
    includes a stray fragment is determined by the stops it serves before its
    length is considered.
    """
    covered = sum(1 for stop in stop_coords if _serves_stop(points, stop))
    length = sum(
        _distance_m(earlier, later) for earlier, later in zip(points, points[1:])
    )
    return covered, length


def _serves_stop(points: Sequence[Point], stop: Point) -> bool:
    """True when a chain vertex lies within :data:`_STOP_COVERAGE_M` of ``stop``."""
    lat_threshold = _STOP_COVERAGE_M / 111320.0
    lon_threshold = lat_threshold / max(math.cos(math.radians(stop[0])), 0.01)
    for vertex in points:
        if abs(vertex[0] - stop[0]) > lat_threshold:
            continue
        if abs(vertex[1] - stop[1]) > lon_threshold:
            continue
        if _distance_m(vertex, stop) <= _STOP_COVERAGE_M:
            return True
    return False


def _distance_m(a: Point, b: Point) -> float:
    """Great-circle distance in metres between two ``(lat, lon)`` pairs."""
    lat1, lon1 = a
    lat2, lon2 = b
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, h)))


def _orient_to_stops(points: List[Point], stop_coords: Sequence[Point]) -> List[Point]:
    """Reverse a shape so it starts at the first stop and ends at the last.

    Relation stop members are usually in travel order (ptv2), so orienting the
    shape the same way keeps a direction-0 trip's geometry monotonic; it changes
    no drawn point and does nothing when the stops are absent or eccentric.
    """
    if len(points) < 2 or len(stop_coords) < 2:
        return points
    forward = _distance_m(points[0], stop_coords[0]) + _distance_m(
        points[-1], stop_coords[-1]
    )
    backward = _distance_m(points[0], stop_coords[-1]) + _distance_m(
        points[-1], stop_coords[0]
    )
    if backward < forward:
        points.reverse()
    return points


def _synthesise_shape_from_stops(
    shape: _ShapeResult, stops: Sequence[StopRef]
) -> _ShapeResult:
    """Use ordered stop coordinates when a relation only yields a two-point line.

    Some relations (older and badly mapped bus routes, clipped relations) have
    almost no way geometry but do carry ordered stop members. Their shape is a
    single straight line between two way endpoints - exactly the beeline through
    buildings the app must not draw. When at least three stops are resolved, the
    stop polyline is measured geometry from the same relation and better than a
    bare two-point line, so it replaces it.

    The fallback is deliberately conservative so it can never make the drawn
    geometry worse: it only fires for a two-point shape, and only when every
    stop-to-stop hop is strictly shorter than the two-point span it replaces. A
    relation whose stop members are not in travel order (the zigzag case) keeps
    the bare line; fewer than three stops leaves nothing to build.
    """
    if len(shape.points) != 2 or len(stops) < 3:
        return shape
    stop_points = tuple((stop.lat, stop.lon) for stop in stops)
    span = _distance_m(shape.points[0], shape.points[-1])
    if span <= 0.0:
        return shape
    hops = [
        _distance_m(earlier, later)
        for earlier, later in zip(stop_points, stop_points[1:])
    ]
    if any(hop >= span for hop in hops):
        return shape
    return _ShapeResult(stop_points, shape.skipped)


@dataclass(frozen=True)
class _StopsResult:
    stops: Tuple[StopRef, ...]
    skipped: int


def _resolve_stops(
    members: Sequence[_Member],
    route_id: str,
    way_nodes: Mapping[int, Sequence[int]],
    way_names: Mapping[int, str],
    node_coords: Mapping[int, Tuple[float, float]],
    node_names: Mapping[int, str],
) -> _StopsResult:
    """Turn stop/platform members into route-namespaced StopRefs."""
    stops: List[StopRef] = []
    skipped = 0

    for member_type, ref, role in members:
        if role not in STOP_ROLES:
            continue
        if member_type == "n":
            coord = node_coords.get(ref)
            if coord is None:
                skipped += 1
                continue
            name = node_names.get(ref) or f"Stop {ref}"
            stops.append(StopRef(f"{route_id}:node:{ref}", name, coord[0], coord[1]))
        elif member_type == "w":
            node_refs = way_nodes.get(ref)
            coords = [
                node_coords[node_ref]
                for node_ref in (node_refs or ())
                if node_ref in node_coords
            ]
            if not coords:
                skipped += 1
                continue
            lat = sum(coord[0] for coord in coords) / len(coords)
            lon = sum(coord[1] for coord in coords) / len(coords)
            name = way_names.get(ref) or f"Platform {ref}"
            stops.append(StopRef(f"{route_id}:way:{ref}", name, lat, lon))
        else:
            skipped += 1  # a relation as a stop member is not resolvable

    return _StopsResult(tuple(stops), skipped)


def _dedupe_stops(stops: Sequence[StopRef]) -> Tuple[StopRef, ...]:
    seen: Set[str] = set()
    unique: List[StopRef] = []
    for stop in stops:
        if stop.stop_id in seen:
            continue
        seen.add(stop.stop_id)
        unique.append(stop)
    return tuple(unique)


# --------------------------------------------------------------------------
# route id derivation
# --------------------------------------------------------------------------


def _route_id(candidate: _Candidate) -> str:
    """Derive the pinned namespaced route id from a relation's tags."""
    tags = candidate.tags
    prefix = _mode_prefix(tags)
    label = tags.get("ref") or tags.get("name") or f"osm{candidate.osm_id}"
    slug = _slug(label) or f"osm{candidate.osm_id}"
    return f"{prefix}-{slug}"


def _mode_prefix(tags: Mapping[str, str]) -> str:
    osm_route = tags.get("route", "")
    if osm_route in ("light_rail", "subway", "train"):
        return "rail"
    if osm_route == "ferry":
        return "ferry"
    if osm_route == "bus":
        return "bus"
    if osm_route in ("share_taxi", "jeepney"):
        haystack = f"{tags.get('name', '')} {tags.get('ref', '')}".lower()
        if "uv express" in haystack or "uv-express" in haystack:
            return "uv"
        return "jeep"
    # Unreachable for candidates (filtered in pass 1), kept explicit.
    raise ValueError(f"unsupported OSM route value: {osm_route!r}")


def _slug(value: str) -> str:
    """Lowercase ASCII alphanumerics only: ``MRT-3`` -> ``mrt3``."""
    return "".join(
        character for character in value.lower() if character.isascii() and character.isalnum()
    )


def _landmark_names(tags: Mapping[str, str]) -> Tuple[str, str]:
    """Name synthesized endpoint stops from ``from``/``to`` tags or the route name."""
    start = tags.get("from", "").strip()
    end = tags.get("to", "").strip()
    if start and end:
        return start, end

    name = tags.get("name", "").strip()
    for separator in (" – ", " — ", " - ", " to ", "→", "–", "-"):
        if separator in name:
            left, right = name.split(separator, 1)
            left, right = left.strip(), right.strip()
            if left and right:
                return left, right
    if name:
        return f"{name} (start)", f"{name} (end)"
    return "Start", "End"
