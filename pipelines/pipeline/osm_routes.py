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
share_taxi       ``jeep-``, ``uv-``,       3               ``trike-e1``
                 ``trike-``
jeepney          ``jeep-``                 3               ``jeep-t1010``
===============  =======================  ==============  =====================

The slug after the prefix is the relation's ``ref`` tag (falling back to
``name``), lowercased and stripped to ASCII alphanumerics: ``ref=MRT-3`` becomes
``rail-mrt3`` and ``ref=Pasig`` becomes ``ferry-pasig``. ``share_taxi`` is
ambiguous in OSM; relations whose name or ref mentions "UV Express" become
``uv-`` (the curated inventory in Task 7 is authoritative for jeepney/UV
coverage). The UV Express test keeps priority exactly as it always had it, so a
relation naming both stays ``uv-``. A ``share_taxi`` relation whose ``name``,
``ref``, ``operator`` or ``description`` names an e-trike/tricycle/traysikel
service becomes ``trike-`` (ruling R11): that is the only mapped tricycle-class
corridor in OSM (the NCR Wilson E-trike System), and ``share_taxi`` is how it is
tagged. Everything else keeps the historical ``jeep-`` prefix. A label with no
ASCII alphanumerics falls back to the OSM id (``bus-osm7080``). A relation with
neither a ``name`` nor a ``ref`` is still ingested, under ``<family>-osm<id>``
and with no short name (ruling R31): the OSM id is a resolvable identity, so it
is counted in ``relations_without_name`` and treated like every other candidate
(feed-readiness and route-id assignment included) instead of being dropped.

``route=tricycle`` is deliberately **not** an ingestible mode: nationally there
are two such relations and neither carries usable service evidence (one is a
tourist excursion citing a blog, one has only an operator tag). Pass 1 counts
them (``tricycle_relations_seen``) and records each one with an explicit reason
(``excluded_tricycle_relations``); they are never auto-ingested (ruling R11).
The route-value comparison is case-insensitive, so ``route=Tricycle`` is counted
in the same bucket instead of landing in ``unsupported_route_values`` (ruling
R34).

A ``route=bus`` relation whose ``name``/``ref``/``operator``/``description``
names a tricycle/traysikel service is a tricycle TODA corridor mistagged as a
bus. It is **excluded** and recorded in
``excluded_mistagged_tricycle_relations`` with its reason: every ``bus-`` route
id is bound to the city-bus fare matrix, so publishing it would present and
price a tricycle corridor as a bus service (ruling R34). The filter is narrow -
``route=bus`` plus tricycle wording only - so ordinary buses are untouched.

Unique ids at national scale
----------------------------
Nationally the same slug recurs a lot - ``ref=1`` in two cities, one name shared
by a northbound and a southbound relation - and GTFS requires unique
``route_id`` values. Assignment is one deterministic pass over the candidates,
grouped by base id. The keeper of a group is the **lowest OSM id among the
feed-ready candidates** (ruling R30); only a group with no feed-ready candidate
falls back to its lowest OSM id (that relation is skipped later by the GTFS
builder, which counts the skip; ``groups_without_feed_ready_keeper`` records the
fallback). A candidate is feed-ready when the builder can publish it:

* its ``route=*`` family is supported (every candidate is, by the pass-1
  filter) and its id is resolvable (a ``ref``/``name`` slug, else the
  ``osm<id>`` fallback - see ruling R31 for nameless relations);
* it has at least one way member outside the stop roles, which can contribute
  shape geometry; and
* it carries **two or more** stop-ish members (node/way members with a stop
  role), or **none at all** - the latter publishes via the synthesized landmark
  stops. Exactly one stop-ish member is not feed-ready: the stops resolver keeps
  that one stop, landmark synthesis does not fire, and the builder then skips
  the relation as "too few stops". Picking the lowest id without this check is
  how three NCR routes (``bus-p28``/``bus-p31``/``bus-p35``) once disappeared:
  the keeper had one stop member while a later, landmark-publishable relation
  was dropped as a duplicate direction.

``from``/``to`` decide what happens to the rest of the group. Every other
relation - feed-ready or not - is compared with **every relation already kept**
in the same base group, not only the bare keeper (ruling R32):

* when its normalized ``from``/``to`` are exactly a kept relation's
  ``to``/``from`` and all four labels are non-empty, it is the same corridor
  mapped in the opposite direction. It is **dropped** and counted in
  ``routes_skipped_duplicate_direction``: the feed already emits both travel
  directions for one relation (``shape:0``/``shape:1`` and the reversed trip), so
  keeping it would duplicate every trip on the corridor. Checking only the bare
  keeper let a reverse pair whose first relation had been renamed publish both
  directions as two corridors (20 NCR pairs);
* otherwise - a genuinely different corridor, a same-direction duplicate, or a
  missing/blank ``from`` or ``to`` (empty means not comparable) - it gets
  ``<family>-<slug>-osm<osm id>`` and is counted in
  ``routes_renamed_collision`` (legacy field name: ``renamed_route_ids``).

``from``/``to`` normalization lowercases, drops punctuation and collapses
whitespace, so ``"North End"`` and ``" north-end!! "`` are the same endpoint.
OSM id order - not file position - decides the keeper, so writing the extract as
XML or PBF (which may reorder objects) cannot rename a route and re-running the
reader always yields the same ids. A suffixed id can never equal a bare one
because a slug contains no hyphen; the kept relation keeps its id exactly, so an
extract with no collision is untouched.

Stops and shapes
----------------
Member nodes/ways with a role of ``stop``, ``platform``, ``stop_position``,
``boarding_position`` or ``stop_area`` become stops, in relation-member order.
A stop-platform way is represented by the centroid of its nodes. Stop ids are
namespaced by route id (``<route_id>:node:<osm id>``, ``<route_id>:way:<osm id>``
or ``<route_id>:landmark:<n>``) so they are stable and collision-free. Stop
identity is deliberately *not* deduplicated across routes (Lead ruling R16): a
node served by two routes is two stop rows at the same coordinate, which keeps
the pinned NCR feed bytes unchanged, and MOTIS links stops within its
``link_stop_distance`` anyway.

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

A resolved shape is then **trimmed to the served stops**: vertices before the
first served stop and after the last served stop are dropped, so a shape never
begins with a multi-kilometre spur before its first stop (6B defect 3b; the real
``rail-1`` shape began 3.0 km east of Balintawak and MOTIS included the spur in
the adjacent-station leg). A stop is located at the nearest chain vertex within
100 m; if either endpoint stop cannot be located, the shape is left untrimmed and
counted in ``shapes_untrimmed_stop_not_found``. Relations with fewer than two
resolved stops are not trimmed (the builder skips them anyway). Shapes that are
still exactly two points after resolution are counted by
``BuildStats.two_point_shapes`` - 6B defect 3c is a known gap, not repaired here.

The reader is offline by construction: it only opens the path it is given.

National counters
-----------------
:func:`read_route_relations` returns a :class:`RouteIngest`: the relations plus
:class:`RouteIngestStats`, which accounts for every relation in the extract:

* ``relations_read`` splits into non-route relations and ``route_relations``;
* ``route_relations`` splits into ``unsupported_route`` (counted by value),
  ``tricycle_relations_seen``, ``excluded_mistagged_tricycle_relations`` and
  ``candidates``;
* ``relations_without_name`` is a sub-count of ``candidates`` (ruling R31: they
  are ingested under ``<family>-osm<id>``, so they are not a separate bucket);
* ``candidates`` splits into ``accepted`` and
  ``routes_skipped_duplicate_direction``;
* the GTFS builder then splits ``accepted`` into written routes, routes with no
  geometry, routes with too few stops and duplicate ids, and publish excludes
  unsupported mode families, so every relation is explainable in the build
  report.

Collision composition is reported by ``route_id_collisions`` (groups with more
than one candidate), ``routes_skipped_duplicate_direction`` (exact reverse
pairs), ``renamed_route_ids`` / ``routes_renamed_collision`` (non-reverse pairs)
and ``groups_without_feed_ready_keeper`` (groups whose keeper had to fall back
to the lowest OSM id because no candidate was feed-ready; ruling R30).
:func:`read_route_relation_composition` computes the same counters from a
relation-only pass (no way/node scan), which is how the NCR and national
composition is measured without a full feed build.

``skipped_members`` is the total number of relation members that could not be
resolved, split by reason: ``dangling_way``, ``dangling_stop_node``,
``dangling_stop_way``, ``stop_relation_member``, ``nested_relation``,
``way_missing_node``, ``degenerate_way`` and ``detached_fragment``. The GTFS
builder contributes the feed-level counters it already had (no geometry, too
few stops, duplicate id, dangling members, trimmed/untrimmed/two-point shapes);
between them every relation is explainable in the build report. Per relation the
same breakdown is available as :attr:`RouteRelation.skipped_member_reasons`,
whose values sum to ``skipped_members``. Only the candidate list is held in
memory (one entry per supported-family relation with a name); all coordinates
are read in the existing three streaming passes.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence, Set, Tuple

import osmium
import osmium.filter

from .gtfs import (
    AgencyInfo,
    DEFAULT_HEADWAY_OFFPEAK_MIN,
    DEFAULT_HEADWAY_PEAK_MIN,
    RouteDef,
    StopRef,
)

__all__ = [
    "AgencyInfo",
    "RouteIngest",
    "RouteIngestStats",
    "RouteRelation",
    "iter_route_relations",
    "read_route_relation_composition",
    "read_route_relations",
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

#: ``share_taxi`` tags that can name an e-trike/tricycle/traysikel service
#: (ruling R11: OSM maps the Wilson E-trike System as ``route=share_taxi``).
TRIKE_SERVICE_TAGS: Tuple[str, ...] = ("name", "ref", "operator", "description")

#: E-trike/tricycle/traysikel wording in any :data:`TRIKE_SERVICE_TAGS` value.
TRIKE_SERVICE_PATTERN = re.compile(r"tricycl|traysikel|trike|e-?trike", re.IGNORECASE)

#: ``route=tricycle`` is counted and excluded, never ingested (ruling R11).
TRICYCLE_ROUTE_VALUE = "tricycle"

#: The exclusion reason recorded for every ``route=tricycle`` relation.
TRICYCLE_EXCLUSION_REASON = (
    "route=tricycle has no usable service evidence in OSM (no stops, schedule "
    "or verifiable source); counted and excluded, never auto-ingested (ruling R11)"
)

#: ``route=bus`` is the only route value the mistagged-tricycle filter applies to.
BUS_ROUTE_VALUE = "bus"

#: The exclusion reason recorded for a tricycle corridor mistagged as a bus.
MISTAGGED_TRICYCLE_BUS_REASON = (
    "tricycle TODA corridor mistagged as route=bus in OSM; publishing it as a "
    "bus would misprice it against the city-bus fare matrix, so it is counted "
    "and excluded (ruling R34)"
)

#: Member roles that describe a stop/platform rather than route geometry.
STOP_ROLES = frozenset(
    {"stop", "platform", "stop_position", "boarding_position", "stop_area"}
)

_Member = Tuple[str, int, str]  # (type 'n'|'w'|'r', ref, role)


@dataclass(frozen=True)
class RouteRelation(RouteDef):
    """A parsed route relation: a RouteDef plus its OSM identity and skip counts.

    ``skipped_members`` is the total number of relation members that could not
    be resolved; ``skipped_member_reasons`` is the same count split by reason
    (sorted by reason, so two reads of one file compare equal).

    ``shape_trimmed`` is true when the shape was cut back to the first/last
    served stop (6B defect 3b). ``shape_untrimmed_stop_not_found`` is true when
    trimming was attempted but an endpoint stop was not within
    :data:`_STOP_COVERAGE_M` of a chain vertex, so the shape was left intact.
    The GTFS builder aggregates both into :class:`~pipeline.gtfs.BuildStats`.
    """

    osm_id: int = 0
    osm_route: str = ""
    skipped_members: int = 0
    skipped_member_reasons: Tuple[Tuple[str, int], ...] = ()
    shape_trimmed: bool = False
    shape_untrimmed_stop_not_found: bool = False


@dataclass(frozen=True)
class RouteIngestStats:
    """National accounting for one OSM extract scan (JSON-ready via :meth:`as_dict`).

    The counters account for every relation: ``relations_read`` splits into
    non-route relations and ``route_relations``; ``route_relations`` splits into
    ``unsupported_route``, ``tricycle_relations_seen`` and ``candidates``;
    ``relations_without_name`` is a sub-count of ``candidates`` (they are
    ingested under ``<family>-osm<id>``, ruling R31); ``candidates`` splits into
    ``accepted`` and ``routes_skipped_duplicate_direction``. The GTFS builder
    then splits ``accepted`` into written routes and its own skip reasons.
    Nothing is dropped silently.
    """

    #: Every relation object read from the file (``type=route`` or not).
    relations_read: int = 0
    #: ``type=route`` relations.
    route_relations: int = 0
    #: ``type=route`` relations whose ``route=*`` value is not a transit mode.
    unsupported_route: int = 0
    #: The unsupported values themselves, sorted by value (``""`` = no route tag).
    unsupported_route_values: Tuple[Tuple[str, int], ...] = ()
    #: Candidates with neither a ``name`` nor a ``ref``. They are still ingested,
    #: under ``<family>-osm<id>`` with no short name (ruling R31), so this is a
    #: sub-count of :attr:`candidates`, not a skip bucket.
    relations_without_name: int = 0
    #: ``route=tricycle`` relations seen. Unusable service evidence, so excluded.
    tricycle_relations_seen: int = 0
    #: The excluded ``route=tricycle`` relations with the documented reason.
    excluded_tricycle_relations: Tuple[Dict[str, Any], ...] = ()
    #: ``route=bus`` relations whose wording names a tricycle TODA corridor
    #: (mistagged). Excluded with the documented reason: publishing one as a bus
    #: would price it against the city-bus fare matrix (ruling R34).
    excluded_mistagged_tricycle_relations: Tuple[Dict[str, Any], ...] = ()
    #: Transit relations yielded by pass 1 (the candidate list size).
    candidates: int = 0
    #: Candidates emitted after the duplicate-direction drop.
    accepted: int = 0
    #: Base-id groups with more than one relation.
    route_id_collisions: int = 0
    #: Candidates dropped as the exact reverse direction of an already-kept
    #: relation in the same base group (R19/R32).
    routes_skipped_duplicate_direction: int = 0
    #: Relations that got the ``-osm<id>`` suffix (legacy name).
    renamed_route_ids: int = 0
    #: Relations whose label has no ASCII slug and used the ``osm<id>`` fallback.
    fallback_route_ids: int = 0
    #: Base-id groups whose keeper is not feed-ready (R30 fallback: the lowest
    #: OSM id kept the bare id; the GTFS builder counts the later skip).
    groups_without_feed_ready_keeper: int = 0
    #: Candidates with no stop/platform member (landmark stops get synthesized).
    candidates_without_stop_members: int = 0
    #: Total skipped members across all candidates.
    skipped_members: int = 0
    #: :attr:`skipped_members` split by reason, sorted by reason.
    skipped_member_reasons: Tuple[Tuple[str, int], ...] = ()

    @property
    def routes_renamed_collision(self) -> int:
        """R19 name for :attr:`renamed_route_ids` (the same non-reverse count)."""
        return self.renamed_route_ids

    @property
    def excluded_mistagged_tricycle_count(self) -> int:
        """Number of tricycle corridors mistagged ``route=bus`` (ruling R34)."""
        return len(self.excluded_mistagged_tricycle_relations)

    def as_dict(self) -> Dict[str, Any]:
        """Serialise for ``build-report.json`` (nested counts become objects)."""
        return {
            "relations_read": self.relations_read,
            "route_relations": self.route_relations,
            "unsupported_route": self.unsupported_route,
            "unsupported_route_values": dict(self.unsupported_route_values),
            "relations_without_name": self.relations_without_name,
            "tricycle_relations_seen": self.tricycle_relations_seen,
            "excluded_tricycle_relations": [
                dict(entry) for entry in self.excluded_tricycle_relations
            ],
            "excluded_mistagged_tricycle_relations": [
                dict(entry) for entry in self.excluded_mistagged_tricycle_relations
            ],
            "excluded_mistagged_tricycle_count": self.excluded_mistagged_tricycle_count,
            "candidates": self.candidates,
            "accepted": self.accepted,
            "route_id_collisions": self.route_id_collisions,
            "routes_skipped_duplicate_direction": self.routes_skipped_duplicate_direction,
            "routes_renamed_collision": self.routes_renamed_collision,
            "renamed_route_ids": self.renamed_route_ids,
            "fallback_route_ids": self.fallback_route_ids,
            "groups_without_feed_ready_keeper": self.groups_without_feed_ready_keeper,
            "candidates_without_stop_members": self.candidates_without_stop_members,
            "skipped_members": self.skipped_members,
            "skipped_member_reasons": dict(self.skipped_member_reasons),
        }


@dataclass(frozen=True)
class RouteIngest:
    """One extract scan: the route relations and their national counters."""

    relations: Tuple[RouteRelation, ...] = ()
    stats: RouteIngestStats = field(default_factory=RouteIngestStats)

    def __iter__(self) -> Iterator[RouteRelation]:
        return iter(self.relations)

    def __len__(self) -> int:
        return len(self.relations)


@dataclass
class _Candidate:
    """The relation tags and member list copied during the first pass."""

    osm_id: int
    tags: Dict[str, str]
    members: List[_Member]


@dataclass(frozen=True)
class _CandidateScan:
    """Pass-1 result: the candidates plus the counters only that pass can see."""

    candidates: Tuple[_Candidate, ...]
    relations_read: int = 0
    route_relations: int = 0
    unsupported_route: int = 0
    unsupported_route_values: Tuple[Tuple[str, int], ...] = ()
    relations_without_name: int = 0
    tricycle_relations_seen: int = 0
    excluded_tricycle_relations: Tuple[Dict[str, Any], ...] = ()
    excluded_mistagged_tricycle_relations: Tuple[Dict[str, Any], ...] = ()


@dataclass(frozen=True)
class _IdAssignment:
    """The deterministic route ids plus R19/R30/R32 collision composition counters."""

    route_ids: Dict[int, str] = field(default_factory=dict)
    collisions: int = 0
    renamed: int = 0
    duplicate_direction: int = 0
    fallbacks: int = 0
    groups_without_feed_ready_keeper: int = 0


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

    Thin wrapper over :func:`read_route_relations` for callers that do not need
    the national counters (the publish stage consumes this interface).

    Args:
        path: ``.osm`` or ``.osm.pbf`` file (the national/NCR extract in
            production, the committed fixture in tests).

    Returns:
        An iterator over :class:`RouteRelation` in file order. A relation with
        no resolvable geometry is still yielded (with an empty shape) so the
        GTFS builder can count the skip.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        osmium.RuntimeError: if pyosmium cannot parse the file.
    """
    return iter(read_route_relations(path).relations)


def read_route_relations(path: Path) -> RouteIngest:
    """Read an extract once: its route relations plus the national counters.

    Args:
        path: ``.osm`` or ``.osm.pbf`` file.

    Returns:
        A :class:`RouteIngest` carrying the accepted relations **in file order**
        and :class:`RouteIngestStats`. A relation with no resolvable geometry is
        still yielded (with an empty shape) so the GTFS builder can count the
        skip; a transit relation with neither a ``name`` nor a ``ref`` is
        ingested under ``<family>-osm<id>`` with no short name and counted in
        ``relations_without_name`` (ruling R31).

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        osmium.RuntimeError: if pyosmium cannot parse the file.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"OSM extract not found: {source}")

    scan = _read_route_candidates(source)
    assignment = _assign_route_ids(scan.candidates)
    kept = tuple(
        candidate
        for candidate in scan.candidates
        if candidate.osm_id in assignment.route_ids
    )
    if not kept:
        return RouteIngest((), _stats_for(scan, (), assignment))

    needed_way_ids, stop_way_ids, needed_node_ids, stop_node_ids = _member_refs(kept)
    way_nodes, way_names = _read_ways(source, needed_way_ids, stop_way_ids)
    for refs in way_nodes.values():
        needed_node_ids.update(refs)
    node_coords, node_names = _read_nodes(source, needed_node_ids, stop_node_ids)

    relations = tuple(
        _resolve(
            candidate,
            assignment.route_ids[candidate.osm_id],
            way_nodes,
            way_names,
            node_coords,
            node_names,
        )
        for candidate in kept
    )
    stats = _stats_for(scan, relations, assignment)
    return RouteIngest(relations, stats)


def read_route_relation_composition(path: Path) -> RouteIngestStats:
    """Relation-only pass: the national counters without resolving geometry.

    Runs pass 1 and route-id assignment only, so it measures the collision
    composition (groups, exact reverse pairs, non-reverse pairs) of a large
    extract in seconds instead of scanning its ways and nodes. Used to report the
    NCR/national composition without a feed build; the numbers match
    :func:`read_route_relations` for the fields both can see.

    Args:
        path: ``.osm`` or ``.osm.pbf`` file.

    Returns:
        :class:`RouteIngestStats` with ``accepted``/collision counters populated;
        ``skipped_members`` is zero because members are not resolved.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        osmium.RuntimeError: if pyosmium cannot parse the file.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"OSM extract not found: {source}")
    scan = _read_route_candidates(source)
    return _stats_for(scan, (), _assign_route_ids(scan.candidates))


# --------------------------------------------------------------------------
# streaming passes
# --------------------------------------------------------------------------


def _read_route_candidates(source: Path) -> _CandidateScan:
    """Pass 1: copy tags and members of every ingestible ``type=route`` relation.

    This is the only pass that sees *all* relations, so it also counts the ones
    the reader will not yield: non-route relations, unsupported ``route=*``
    values, ``route=tricycle`` (excluded with a reason, R11, matched
    case-insensitively per R34) and ``route=bus`` relations whose wording names
    a tricycle TODA corridor (excluded with a reason, R34). Relations with
    no ``name``/``ref`` are **not** dropped: they become candidates like any
    other (their id falls back to ``<family>-osm<id>``) and are counted in
    ``relations_without_name`` (ruling R31).
    """
    candidates: List[_Candidate] = []
    relations_read = 0
    route_relations = 0
    unsupported: Dict[str, int] = {}
    relations_without_name = 0
    tricycle_relations_seen = 0
    excluded_tricycle_relations: List[Dict[str, Any]] = []
    excluded_mistagged_tricycle_relations: List[Dict[str, Any]] = []

    for obj in osmium.FileProcessor(str(source), osmium.osm.RELATION):
        relations_read += 1
        if not obj.is_relation():
            continue
        tags = dict(obj.tags)
        if tags.get("type") != "route":
            continue
        route_relations += 1
        osm_route = tags.get("route", "")
        normalised_route = osm_route.strip().lower()
        if normalised_route == TRICYCLE_ROUTE_VALUE:
            # R11/R34: counted and excluded with an explicit reason, never
            # ingested. Matching the normalized value counts route=Tricycle too.
            tricycle_relations_seen += 1
            excluded_tricycle_relations.append(
                {
                    "osm_id": obj.id,
                    "name": tags.get("name") or tags.get("ref") or None,
                    "reason": TRICYCLE_EXCLUSION_REASON,
                }
            )
            continue
        if normalised_route == BUS_ROUTE_VALUE and _is_trike_service(tags):
            # R34: a tricycle TODA corridor mistagged route=bus. Feed-ready or
            # not, a bus- route id is bound to the city-bus fare matrix, so
            # publishing it would present and price a tricycle as a bus.
            excluded_mistagged_tricycle_relations.append(
                {
                    "osm_id": obj.id,
                    "name": tags.get("name") or tags.get("ref") or None,
                    "reason": MISTAGGED_TRICYCLE_BUS_REASON,
                }
            )
            continue
        if osm_route not in ROUTE_TYPE_BY_OSM_ROUTE:
            unsupported[osm_route] = unsupported.get(osm_route, 0) + 1
            continue
        if not _has_name(tags):
            # R31: not a skip. The OSM id gives it a resolvable identity.
            relations_without_name += 1
        members: List[_Member] = [
            (member.type, member.ref, member.role or "") for member in obj.members
        ]
        candidates.append(_Candidate(obj.id, tags, members))

    return _CandidateScan(
        candidates=tuple(candidates),
        relations_read=relations_read,
        route_relations=route_relations,
        unsupported_route=sum(unsupported.values()),
        unsupported_route_values=_sorted_counts(unsupported),
        relations_without_name=relations_without_name,
        tricycle_relations_seen=tricycle_relations_seen,
        excluded_tricycle_relations=tuple(excluded_tricycle_relations),
        excluded_mistagged_tricycle_relations=tuple(
            excluded_mistagged_tricycle_relations
        ),
    )


def _member_refs(
    candidates: Sequence[_Candidate],
) -> Tuple[Set[int], Set[int], Set[int], Set[int]]:
    """Collect the way/node ids the later streaming passes must resolve."""
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
    return needed_way_ids, stop_way_ids, needed_node_ids, stop_node_ids


def _read_ways(
    source: Path, needed_way_ids: Set[int], stop_way_ids: Set[int]
) -> Tuple[Dict[int, Tuple[int, ...]], Dict[int, str]]:
    """Pass 2: node refs for needed ways, names for stop/platform ways.

    The id filter runs in libosmium (C++); only matching ways are materialised in
    Python. ``IdFilter`` requires the ids sorted, which is also deterministic.
    """
    way_nodes: Dict[int, Tuple[int, ...]] = {}
    way_names: Dict[int, str] = {}
    if not needed_way_ids:
        return way_nodes, way_names

    processor = osmium.FileProcessor(str(source), osmium.osm.WAY).with_filter(
        osmium.filter.IdFilter(sorted(needed_way_ids))
    )
    for obj in processor:
        way_nodes[obj.id] = tuple(node.ref for node in obj.nodes)
        if obj.id in stop_way_ids:
            way_names[obj.id] = dict(obj.tags).get("name", "")
    return way_nodes, way_names


def _read_nodes(
    source: Path, needed_node_ids: Set[int], stop_node_ids: Set[int]
) -> Tuple[Dict[int, Tuple[float, float]], Dict[int, str]]:
    """Pass 3: coordinates for needed nodes, names for stop nodes.

    Same native ``IdFilter`` as :func:`_read_ways`: at national scale the node
    section is the expensive pass, and matching in C++ keeps it to one scan
    instead of one Python callback per node in the extract.
    """
    node_coords: Dict[int, Tuple[float, float]] = {}
    node_names: Dict[int, str] = {}
    if not needed_node_ids:
        return node_coords, node_names

    processor = osmium.FileProcessor(str(source), osmium.osm.NODE).with_filter(
        osmium.filter.IdFilter(sorted(needed_node_ids))
    )
    for obj in processor:
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
    route_id: str,
    way_nodes: Mapping[int, Sequence[int]],
    way_names: Mapping[int, str],
    node_coords: Mapping[int, Tuple[float, float]],
    node_names: Mapping[int, str],
) -> RouteRelation:
    """Turn one copied relation into a RouteRelation, counting skipped members.

    ``route_id`` is assigned up front by :func:`_assign_route_ids` (which needs
    every candidate to disambiguate collisions), so it is passed in rather than
    derived here.
    """
    tags = candidate.tags
    reasons: Dict[str, int] = {}

    # Stops are resolved first: the shape resolver uses them to decide which
    # contiguous chain is the route's main line, and the ordered-stop fallback
    # below needs them. Neither resolver depends on the other's result.
    stops = _resolve_stops(
        candidate.members, route_id, way_nodes, way_names, node_coords, node_names
    )
    _add_counts(reasons, stops.reasons)
    unique_stops = _dedupe_stops(stops.stops)

    shape = _resolve_shape(
        candidate.members,
        way_nodes,
        node_coords,
        stop_coords=tuple((stop.lat, stop.lon) for stop in unique_stops),
    )
    _add_counts(reasons, shape.reasons)
    shape = _synthesise_shape_from_stops(shape, unique_stops)

    # 6B defect 3b: a resolved shape can run past the first/last served stop
    # (e.g. a leading spur way); trim it so the feed never starts a trip before
    # its boarding stop. Stops are located by their chain vertex within
    # _STOP_COVERAGE_M; if either endpoint stop cannot be located the shape is
    # left alone and counted (see RouteRelation.shape_* flags).
    trimmed_points, shape_trimmed, untrimmed_stop_not_found = _trim_shape_to_stops(
        shape.points, tuple((stop.lat, stop.lon) for stop in unique_stops)
    )
    shape = _ShapeResult(trimmed_points, shape.reasons)

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
        skipped_members=sum(reasons.values()),
        skipped_member_reasons=_sorted_counts(reasons),
        shape_trimmed=shape_trimmed,
        shape_untrimmed_stop_not_found=untrimmed_stop_not_found,
    )


#: Mean Earth radius in metres, for the endpoint/stop scoring distances.
_EARTH_RADIUS_M = 6371000.0

#: A stop counts as served by a candidate chain when a chain vertex is this
#: close to it (metres). Stop-position nodes that are part of a way are exact
#: vertices, so this only matters for platform-centroid stops.
_STOP_COVERAGE_M = 100.0

Point = Tuple[float, float]


@dataclass
class _ShapeResult:
    """A resolved shape plus the counts of members that could not be used.

    ``reasons`` keys: ``nested_relation``, ``dangling_way``, ``way_missing_node``,
    ``degenerate_way`` and ``detached_fragment``.
    """

    points: Tuple[Tuple[float, float], ...]
    reasons: Dict[str, int] = field(default_factory=dict)


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
    node without coordinates) are counted as skipped too, by reason.
    """
    segments: List[_ShapeSegment] = []
    reasons: Dict[str, int] = {}

    for member_type, ref, role in members:
        if member_type == "r":
            _add_counts(reasons, {"nested_relation": 1})  # not resolved in v1
            continue
        if member_type != "w" or role in STOP_ROLES:
            continue
        node_refs = way_nodes.get(ref)
        if not node_refs:
            _add_counts(reasons, {"dangling_way": 1})
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
            _add_counts(reasons, {"way_missing_node": 1})
            continue
        if len(coords) < 2:
            _add_counts(reasons, {"degenerate_way": 1})  # a point, not a segment
            continue
        segments.append(_ShapeSegment(tuple(node_refs), tuple(coords), role))

    if not segments:
        return _ShapeResult((), reasons)

    chains = _build_shape_chains(segments)
    chain_coords = [_chain_coords(segments, chain) for chain in chains]
    best = max(
        range(len(chains)),
        key=lambda index: (_chain_score(chain_coords[index], stop_coords), -index),
    )
    # Every chain that is not the main line is a detached fragment, counted once:
    # the count says how many pieces were dropped, not how many ways they used.
    if len(chains) > 1:
        _add_counts(reasons, {"detached_fragment": len(chains) - 1})

    points = _orient_to_stops(list(chain_coords[best]), stop_coords)
    return _ShapeResult(tuple(points), reasons)


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
    return _ShapeResult(stop_points, dict(shape.reasons))


def _trim_shape_to_stops(
    points: Sequence[Point], stop_coords: Sequence[Point]
) -> Tuple[Tuple[Point, ...], bool, bool]:
    """Cut a resolved shape back to its first and last served stop (6B 3b).

    The stitched chain can continue past the terminal stops - most visibly the
    real ``rail-1`` shape, whose first 33 vertices were a 3.0 km spur east of
    Balintawak. MOTIS includes those leading vertices in the boarding leg, so the
    feed must start the shape at the first stop and end it at the last.

    Args:
        points: the stitched, oriented shape.
        stop_coords: the relation's resolved stops in travel order.

    Returns:
        ``(points, trimmed, stop_not_found)``. ``trimmed`` is true when vertices
        were removed; ``stop_not_found`` is true when an endpoint stop has no
        chain vertex within :data:`_STOP_COVERAGE_M`, in which case the original
        points are returned. A trim that would leave fewer than two points is not
        applied.
    """
    if len(points) < 2 or len(stop_coords) < 2:
        return tuple(points), False, False

    first = _shape_index_for_stop(points, stop_coords[0], prefer_last=False)
    last = _shape_index_for_stop(points, stop_coords[-1], prefer_last=True)
    if first is None or last is None:
        return tuple(points), False, True
    if first >= last:
        # Both stop positions resolve to the same/overlapping vertices (a loop or
        # an eccentric stop order): there is no meaningful span to cut.
        return tuple(points), False, False

    trimmed = tuple(points[first : last + 1])
    if len(trimmed) < 2:
        return tuple(points), False, False
    if len(trimmed) == len(points):
        return trimmed, False, False
    return trimmed, True, False


def _shape_index_for_stop(
    points: Sequence[Point], stop: Point, *, prefer_last: bool
) -> Optional[int]:
    """Index of the chain vertex that serves ``stop``, or ``None`` if too far.

    The closest vertex within :data:`_STOP_COVERAGE_M` wins. Ties are broken
    toward the end of the chain for the last stop and toward its start for the
    first stop, so a loop that passes a terminal twice trims the outer occurrence.
    """
    best_index: Optional[int] = None
    best_distance = 0.0
    for index, point in enumerate(points):
        distance = _distance_m(point, stop)
        if distance > _STOP_COVERAGE_M:
            continue
        if best_index is None or distance < best_distance - 1e-9:
            best_index, best_distance = index, distance
        elif abs(distance - best_distance) <= 1e-9:
            if prefer_last and index > best_index:
                best_index = index
            elif not prefer_last and index < best_index:
                best_index = index
    return best_index


@dataclass
class _StopsResult:
    """Resolved stops plus the counts of stop members that could not be used.

    ``reasons`` keys: ``dangling_stop_node``, ``dangling_stop_way`` and
    ``stop_relation_member``.
    """

    stops: Tuple[StopRef, ...]
    reasons: Dict[str, int] = field(default_factory=dict)


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
    reasons: Dict[str, int] = {}

    for member_type, ref, role in members:
        if role not in STOP_ROLES:
            continue
        if member_type == "n":
            coord = node_coords.get(ref)
            if coord is None:
                _add_counts(reasons, {"dangling_stop_node": 1})
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
                _add_counts(reasons, {"dangling_stop_way": 1})
                continue
            lat = sum(coord[0] for coord in coords) / len(coords)
            lon = sum(coord[1] for coord in coords) / len(coords)
            name = way_names.get(ref) or f"Platform {ref}"
            stops.append(StopRef(f"{route_id}:way:{ref}", name, lat, lon))
        else:
            _add_counts(reasons, {"stop_relation_member": 1})

    return _StopsResult(tuple(stops), reasons)


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


def _assign_route_ids(candidates: Sequence[_Candidate]) -> _IdAssignment:
    """Assign a unique, deterministic route id to every candidate (R19/R30/R32).

    Grouping is by base id (``<family>-<slug>``). The keeper is the **lowest
    OSM id among the feed-ready candidates** (ruling R30); it keeps the bare
    base id. When no candidate in the group is feed-ready the lowest OSM id
    keeps it anyway - the GTFS builder later skips that relation and counts the
    skip, and ``groups_without_feed_ready_keeper`` records the fallback.

    Every other relation - feed-ready or not - is either:

    * dropped as the same corridor's opposite direction when its normalized
      ``from``/``to`` are exactly the ``to``/``from`` of **any relation already
      kept in this group**, bare keeper or already-renamed (ruling R32), and
      all four labels are non-empty (``routes_skipped_duplicate_direction``);
    * suffixed ``<family>-<slug>-osm<osm id>`` and kept
      (``routes_renamed_collision``).

    OSM id order (not file position) decides the keeper, so rewriting the
    extract as XML or PBF cannot rename a route and re-running the reader always
    yields the same ids. A suffixed id cannot collide with a bare one because a
    slug holds no hyphen, and two suffixed ids differ by construction.

    Args:
        candidates: every ingestible relation copied by pass 1 (file order).

    Returns:
        The per-OSM-id route ids plus the composition counters. An OSM id absent
        from :attr:`_IdAssignment.route_ids` was dropped as a duplicate
        direction.
    """
    bases: Dict[int, str] = {}
    by_id: Dict[int, _Candidate] = {}
    fallbacks = 0
    for candidate in candidates:
        base, used_fallback = _base_route_id(candidate)
        bases[candidate.osm_id] = base
        by_id[candidate.osm_id] = candidate
        fallbacks += int(used_fallback)

    groups: Dict[str, List[int]] = {}
    for osm_id in sorted(bases):
        groups.setdefault(bases[osm_id], []).append(osm_id)

    route_ids: Dict[int, str] = {}
    collisions = 0
    renamed = 0
    duplicate_direction = 0
    without_feed_ready_keeper = 0
    for base, osm_ids in groups.items():
        if len(osm_ids) > 1:
            collisions += 1
        keeper_id, keeper_is_feed_ready = _keeper_for(by_id, osm_ids)
        if not keeper_is_feed_ready:
            without_feed_ready_keeper += 1
        route_ids[keeper_id] = base
        # R32: reverse-dedupe against every kept relation in this group, not only
        # the bare keeper. The keeper is kept before any comparison, so a
        # non-feed-ready lower id can still be dropped as its reverse direction.
        kept_ends: List[Tuple[str, str]] = [_normalised_ends(by_id[keeper_id])]
        for osm_id in osm_ids:
            if osm_id == keeper_id:
                continue
            later_from, later_to = _normalised_ends(by_id[osm_id])
            if any(
                _is_reverse_direction(kept_from, kept_to, later_from, later_to)
                for kept_from, kept_to in kept_ends
            ):
                duplicate_direction += 1
                continue
            route_ids[osm_id] = f"{base}-osm{osm_id}"
            renamed += 1
            kept_ends.append((later_from, later_to))
    return _IdAssignment(
        route_ids=route_ids,
        collisions=collisions,
        renamed=renamed,
        duplicate_direction=duplicate_direction,
        fallbacks=fallbacks,
        groups_without_feed_ready_keeper=without_feed_ready_keeper,
    )


def _keeper_for(
    by_id: Mapping[int, _Candidate], osm_ids: Sequence[int]
) -> Tuple[int, bool]:
    """The group's keeper and whether it is feed-ready (ruling R30).

    Args:
        by_id: OSM id -> candidate.
        osm_ids: the group's OSM ids, ascending.

    Returns:
        ``(lowest feed-ready OSM id, True)`` when the group has a feed-ready
        candidate, else ``(lowest OSM id, False)``.
    """
    for osm_id in osm_ids:
        if _is_feed_ready(by_id[osm_id]):
            return osm_id, True
    return osm_ids[0], False


def _is_feed_ready(candidate: _Candidate) -> bool:
    """True when the GTFS builder can publish this candidate (ruling R30).

    Feed-readiness is decided from the pass-1 member list, before any geometry
    or stop is resolved, so it is a conservative *proxy*: a way member that is
    dangling in the extract still counts here and is caught later by the
    builder's ``routes_skipped_no_geometry`` counter.

    A candidate is feed-ready when:

    * its ``route=*`` family is supported (every candidate passed that filter)
      and its id is resolvable (a ``ref``/``name`` slug, else the ``osm<id>``
      fallback - always true, see :func:`_base_route_id`);
    * it has at least one way member outside :data:`STOP_ROLES`, which is what
      :func:`_resolve_shape` can turn into shape geometry; and
    * it has two or more stop-ish members (``n``/``w`` members with a role in
      :data:`STOP_ROLES`), or none at all. Two stops are what
      :func:`pipeline.gtfs._clean_stops` needs to keep; with none it
      synthesizes the two landmark stops from the shape ends. Exactly one is
      the unpublishable case: the builder keeps that single stop and skips the
      route as "too few stops".
    """
    has_geometry_way = any(
        member_type == "w" and role not in STOP_ROLES
        for member_type, _, role in candidate.members
    )
    stop_members = sum(
        1
        for member_type, _, role in candidate.members
        if member_type in ("n", "w") and role in STOP_ROLES
    )
    return has_geometry_way and (stop_members == 0 or stop_members >= 2)


def _normalised_ends(candidate: _Candidate) -> Tuple[str, str]:
    """The relation's normalized ``(from, to)`` labels (``""`` when absent)."""
    tags = candidate.tags
    return (
        _normalise_endpoint(tags.get("from", "")),
        _normalise_endpoint(tags.get("to", "")),
    )


def _normalise_endpoint(value: str) -> str:
    """Normalize a ``from``/``to`` label: case, punctuation and whitespace.

    ``" north-end!! "`` and ``"North End"`` both become ``"north end"``. This is
    deliberately exact: no fuzzy or terminal-suffix matching is applied, because
    a wrong drop would silently remove a distinct corridor from the feed.
    """
    normalised: List[str] = []
    for character in value.casefold():
        if character.isalnum():
            normalised.append(character)
        else:
            normalised.append(" ")
    return " ".join("".join(normalised).split())


def _is_reverse_direction(
    kept_from: str, kept_to: str, later_from: str, later_to: str
) -> bool:
    """True only for an exact opposite-direction pair with all labels present.

    Empty/missing labels are not comparable (R19): a relation with no ``from``/
    ``to`` data must be renamed, never dropped, because the reader cannot tell
    which corridor it belongs to.
    """
    if not (kept_from and kept_to and later_from and later_to):
        return False
    return later_from == kept_to and later_to == kept_from


def _base_route_id(candidate: _Candidate) -> Tuple[str, bool]:
    """The relation's namespaced id before collision disambiguation.

    Returns:
        ``(base id, used_osm_id_fallback)``. The fallback is used when the label
        has no ASCII alphanumerics (e.g. a name written only in another script).
    """
    tags = candidate.tags
    prefix = _mode_prefix(tags)
    slug = _slug(tags.get("ref") or tags.get("name") or "")
    if slug:
        return f"{prefix}-{slug}", False
    return f"{prefix}-osm{candidate.osm_id}", True


def _has_name(tags: Mapping[str, str]) -> bool:
    """True when the relation carries a non-blank ``ref`` or ``name``."""
    return bool((tags.get("ref") or "").strip() or (tags.get("name") or "").strip())


def _add_counts(counts: Dict[str, int], extra: Mapping[str, int]) -> None:
    """Merge ``extra`` reason counts into ``counts``."""
    for reason, count in extra.items():
        counts[reason] = counts.get(reason, 0) + count


def _sorted_counts(counts: Mapping[str, int]) -> Tuple[Tuple[str, int], ...]:
    """A deterministic, JSON-ready view of a reason/count mapping."""
    return tuple(sorted((reason, count) for reason, count in counts.items() if count))


def _stats_for(
    scan: _CandidateScan,
    relations: Sequence[RouteRelation],
    assignment: Optional[_IdAssignment] = None,
) -> RouteIngestStats:
    """Assemble the national counters for one extract scan (full or pass-1)."""
    assignment = assignment or _IdAssignment()
    reasons: Counter = Counter()
    for relation in relations:
        reasons.update(dict(relation.skipped_member_reasons))
    return RouteIngestStats(
        relations_read=scan.relations_read,
        route_relations=scan.route_relations,
        unsupported_route=scan.unsupported_route,
        unsupported_route_values=scan.unsupported_route_values,
        relations_without_name=scan.relations_without_name,
        tricycle_relations_seen=scan.tricycle_relations_seen,
        excluded_tricycle_relations=scan.excluded_tricycle_relations,
        excluded_mistagged_tricycle_relations=(
            scan.excluded_mistagged_tricycle_relations
        ),
        candidates=len(scan.candidates),
        accepted=len(scan.candidates) - assignment.duplicate_direction,
        route_id_collisions=assignment.collisions,
        routes_skipped_duplicate_direction=assignment.duplicate_direction,
        renamed_route_ids=assignment.renamed,
        fallback_route_ids=assignment.fallbacks,
        groups_without_feed_ready_keeper=assignment.groups_without_feed_ready_keeper,
        candidates_without_stop_members=sum(
            1
            for candidate in scan.candidates
            if not any(role in STOP_ROLES for _, _, role in candidate.members)
        ),
        skipped_members=sum(relation.skipped_members for relation in relations),
        skipped_member_reasons=_sorted_counts(reasons),
    )


def _mode_prefix(tags: Mapping[str, str]) -> str:
    osm_route = tags.get("route", "")
    if osm_route in ("light_rail", "subway", "train"):
        return "rail"
    if osm_route == "ferry":
        return "ferry"
    if osm_route == "bus":
        return "bus"
    if osm_route in ("share_taxi", "jeepney"):
        # Priority is unchanged: a relation that names UV Express stays ``uv-``,
        # even when it also mentions an e-trike. Everything else on share_taxi
        # keeps the historical jeepney prefix unless the service itself is an
        # e-trike/tricycle/traysikel (R11), which is the only mapped
        # tricycle-class corridor OSM carries.
        haystack = f"{tags.get('name', '')} {tags.get('ref', '')}".lower()
        if "uv express" in haystack or "uv-express" in haystack:
            return "uv"
        if osm_route == "share_taxi" and _is_trike_service(tags):
            return "trike"
        return "jeep"
    # Unreachable for candidates (filtered in pass 1), kept explicit.
    raise ValueError(f"unsupported OSM route value: {osm_route!r}")


def _is_trike_service(tags: Mapping[str, str]) -> bool:
    """True when the relation's name/ref/operator/description names a trike.

    The keyword match is deliberately generous (``tricycl|traysikel|trike``):
    OSM has no dedicated tricycle route value, so the service name is the only
    signal that a ``share_taxi`` relation is the e-trike layer. The UV Express
    test is applied *before* this one, so the historical family assignment of an
    ambiguous relation cannot change.
    """
    haystack = " ".join(str(tags.get(tag, "")) for tag in TRIKE_SERVICE_TAGS)
    return bool(TRIKE_SERVICE_PATTERN.search(haystack))


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
