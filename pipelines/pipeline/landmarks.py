"""Landmark -> coordinate resolver for the curated inventory (ruling R30).

Why this module exists
----------------------
The curated jeepney / UV Express inventory (Task 7) records the terminals the
OSM Wiki publishes as *names* and deliberately stores no coordinates - the wiki
publishes none, and inventing them would turn a transcription into a
fabrication. ``to_route_def`` therefore needs a ``stop_lookup`` the plan never
supplied, so without this resolver curated routes could never reach the router
(R30).

What counts as a named stop
---------------------------
A node or way in the NCR extract carrying a ``name`` and any of:

* ``public_transport=platform|station|stop_position``;
* ``highway=bus_stop``;
* ``railway=station|halt``.

Platform ways are represented by the centroid of their nodes (the same
convention ``pipeline.osm_routes`` uses for stop/platform way members). Named
roads, tracks and ferry route ways are geometry, not stops, and are ignored.

Matching rules (honest ones)
----------------------------
Matching is **exact after normalisation** - case-folded, diacritics folded
(``Biñan`` -> ``binan``), apostrophes removed, other punctuation treated as
whitespace and whitespace collapsed. There is no fuzzy, substring or
nearest-neighbour matching: a landmark either names an OSM stop or it stays
unresolved. Unresolved landmarks are surfaced by
``pipeline.inventory.TerminalNotMappedError`` and recorded in the publish build
report, never silently dropped and never guessed.

When several OSM stops share a normalised name, the first in file order wins so
the build is deterministic; :func:`ambiguous_stop_names` reports the collision
and the publish report lists the ones that affect the inventory. Choosing the
first is *labelled*, which is the difference between a documented tie-break and
a hidden guess.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Tuple

import osmium

from .inventory import InventoryRoute

__all__ = [
    "NamedStop",
    "ambiguous_stop_names",
    "build_stop_lookup",
    "is_stop_feature",
    "load_named_stops",
    "normalise_name",
    "resolve_landmarks",
]

#: ``public_transport=*`` values that describe a stop/platform (ptv2 tagging).
STOP_PUBLIC_TRANSPORT_VALUES = frozenset({"platform", "station", "stop_position"})
#: ``railway=*`` values that are stations (rail stops the wiki terminals name).
STOP_RAILWAY_VALUES = frozenset({"station", "halt"})
#: ``highway=*`` values that are stops (the older, still common tagging).
STOP_HIGHWAY_VALUES = frozenset({"bus_stop"})


@dataclass(frozen=True)
class NamedStop:
    """One named stop feature read from the OSM extract."""

    name: str
    lat: float
    lon: float
    osm_type: str  # "node" or "way"
    osm_id: int

    @property
    def feature(self) -> str:
        """Stable ``"node/123"`` style identity for reports."""
        return f"{self.osm_type}/{self.osm_id}"


def normalise_name(value: str) -> str:
    """Fold a stop name to its comparison key.

    ``"Biñan Población"`` -> ``"binan poblacion"``;
    ``"EDSA/Shaw Boulevard"`` -> ``"edsa shaw boulevard"``;
    ``"O'Donnell"`` -> ``"odonnell"``.

    Raises:
        ValueError: if ``value`` is not a string.
    """
    if not isinstance(value, str):
        raise ValueError(f"stop name must be a string, got {value!r}")
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    folded = without_marks.casefold().replace("'", "").replace("\u2019", "")
    spaced = "".join(
        character if character.isalnum() else " " for character in folded
    )
    return " ".join(spaced.split())


def is_stop_feature(tags: Mapping[str, str]) -> bool:
    """True when OSM tags describe a named-stop feature this resolver accepts."""
    public_transport = tags.get("public_transport")
    if isinstance(public_transport, str) and public_transport in STOP_PUBLIC_TRANSPORT_VALUES:
        return True
    railway = tags.get("railway")
    if isinstance(railway, str) and railway in STOP_RAILWAY_VALUES:
        return True
    highway = tags.get("highway")
    if isinstance(highway, str) and highway in STOP_HIGHWAY_VALUES:
        return True
    return False


def load_named_stops(path: Path) -> List[NamedStop]:
    """Read every named stop feature from an ``.osm``/``.osm.pbf`` extract.

    Args:
        path: the NCR extract (production) or a committed fixture (tests).

    Returns:
        Named stops in file order. Stop-platform ways carry the centroid of
        their (valid) node locations.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        osmium.RuntimeError: if pyosmium cannot parse the extract.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"OSM extract not found for landmark lookup: {source}")

    collector = _StopCollector()
    collector.apply_file(str(source), locations=True)
    return collector.stops


def build_stop_lookup(stops: Iterable[NamedStop]) -> Dict[str, Tuple[float, float]]:
    """Normalised stop name -> ``(lat, lon)``.

    The first stop in input order wins when names collide, so the lookup is
    deterministic. Ambiguities are reported separately by
    :func:`ambiguous_stop_names`.

    Args:
        stops: named stops, e.g. from :func:`load_named_stops`.

    Returns:
        Mapping keyed by :func:`normalise_name` output.
    """
    lookup: Dict[str, Tuple[float, float]] = {}
    for stop in stops:
        key = normalise_name(stop.name)
        if not key:
            continue
        lookup.setdefault(key, (float(stop.lat), float(stop.lon)))
    return lookup


def ambiguous_stop_names(
    stops: Iterable[NamedStop],
) -> Dict[str, Tuple[NamedStop, ...]]:
    """Normalised names that map to more than one distinct coordinate.

    Duplicates at the same coordinate (a node and a platform way, say) are not
    ambiguous. The publish report lists the ambiguous names the curated
    inventory actually uses, so a tie-break is never silent.
    """
    grouped: Dict[str, List[NamedStop]] = {}
    for stop in stops:
        key = normalise_name(stop.name)
        if key:
            grouped.setdefault(key, []).append(stop)

    ambiguous: Dict[str, Tuple[NamedStop, ...]] = {}
    for key, group in grouped.items():
        coordinates = {(round(stop.lat, 7), round(stop.lon, 7)) for stop in group}
        if len(coordinates) > 1:
            ambiguous[key] = tuple(group)
    return ambiguous


def resolve_landmarks(
    routes: Iterable[InventoryRoute],
    stop_lookup: Mapping[str, Tuple[float, float]],
) -> Dict[str, Tuple[float, float]]:
    """Translate inventory landmark names into coordinates for ``to_route_def``.

    The returned mapping is keyed by the *published* landmark string (what
    :func:`pipeline.inventory.to_route_def` indexes with), so a landmark whose
    normalised form matches an OSM stop is resolved and one that does not is
    simply absent - which makes ``to_route_def`` raise
    :class:`pipeline.inventory.TerminalNotMappedError` and list it.

    Args:
        routes: curated inventory routes.
        stop_lookup: output of :func:`build_stop_lookup`.

    Returns:
        ``{landmark: (lat, lon)}`` for every resolved landmark of every route.
    """
    resolved: Dict[str, Tuple[float, float]] = {}
    for route in routes:
        for landmark in route.stop_landmarks:
            key = normalise_name(landmark)
            if not key:
                continue
            coordinate = stop_lookup.get(key)
            if coordinate is not None:
                resolved[landmark] = coordinate
    return resolved


class _StopCollector(osmium.SimpleHandler):
    """Collect named stop nodes and stop-platform ways in one pass."""

    def __init__(self) -> None:
        super().__init__()
        self.stops: List[NamedStop] = []

    @staticmethod
    def _name(tags: Mapping[str, str]) -> str:
        name = tags.get("name")
        if isinstance(name, str):
            return name.strip()
        return ""

    def node(self, node: "osmium.osm.Node") -> None:  # noqa: F821 - pyosmium type
        name = self._name(node.tags)
        if not name or not is_stop_feature(node.tags):
            return
        location = node.location
        if not location.valid():
            return
        self.stops.append(
            NamedStop(name, location.lat, location.lon, "node", node.id)
        )

    def way(self, way: "osmium.osm.Way") -> None:  # noqa: F821 - pyosmium type
        name = self._name(way.tags)
        if not name or not is_stop_feature(way.tags):
            return
        coordinates: List[Tuple[float, float]] = []
        for node in way.nodes:
            location = getattr(node, "location", None)
            if location is not None and location.valid():
                coordinates.append((location.lat, location.lon))
        if not coordinates:
            return
        lat = sum(latitude for latitude, _ in coordinates) / len(coordinates)
        lon = sum(longitude for _, longitude in coordinates) / len(coordinates)
        self.stops.append(NamedStop(name, lat, lon, "way", way.id))
