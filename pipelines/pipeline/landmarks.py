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

Documented aliases (ruling R34)
-------------------------------
Some curated terminals are named the way the OSM Wiki names them, not the way
OSM stops are named ("SM Fairview" vs "SM City Fairview"). ``data/routes/
landmark-aliases.yaml`` records a hand-checked pointer from such a landmark to a
*specific* OSM stop feature: :func:`load_landmark_aliases` validates the file,
:func:`alias_coordinates` pins the coordinate to that feature (re-checking the
name it carries in the extract), and :func:`resolve_landmarks` only consults an
alias when the direct exact-name lookup misses. An alias therefore adds no
coordinates and no fuzzy matching - it changes the *name* that is matched, never
the honesty of the match.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

import osmium
import yaml
from jsonschema.validators import validator_for

from .inventory import InventoryRoute

__all__ = [
    "ALIASES_SCHEMA_PATH",
    "LandmarkAlias",
    "NamedStop",
    "alias_coordinates",
    "ambiguous_stop_names",
    "build_stop_lookup",
    "is_stop_feature",
    "load_landmark_aliases",
    "load_named_stops",
    "normalise_name",
    "resolve_landmarks",
    "stop_feature_lookup",
]

#: Schema shipped with the repository for ``data/routes/landmark-aliases.yaml``.
#: ``npm run validate:data`` validates the same file; publish re-validates so a
#: hand edit cannot enter a build unvalidated.
ALIASES_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "routes"
    / "schema"
    / "landmark-aliases.schema.json"
)

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


@dataclass(frozen=True)
class LandmarkAlias:
    """One hand-checked curated-landmark -> OSM-stop pointer (ruling R34).

    ``osm_stop`` is the exact stop feature (``node/123`` or ``way/123``) whose
    own coordinate is used, and ``stop_name`` is that feature's name in the
    extract - re-checked at publish time so a renamed or deleted feature is
    reported instead of silently resolving to the wrong place. ``source`` is the
    built feed's ``stops.txt`` line that proves the stop is in the artifact.
    """

    landmark: str
    osm_stop: str
    stop_name: str
    source: str
    note: str = ""


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


def stop_feature_lookup(stops: Iterable[NamedStop]) -> Dict[str, NamedStop]:
    """``"node/123"`` -> the stop feature itself.

    Aliases pin a feature id, not a name, so the coordinate they resolve to is
    the one belonging to the exact stop a reviewer checked in the feed - never
    "whichever stop happened to share the name first".
    """
    return {stop.feature: stop for stop in stops}


def load_landmark_aliases(path: Path) -> List[LandmarkAlias]:
    """Read and schema-validate ``data/routes/landmark-aliases.yaml``.

    Args:
        path: the aliases YAML file.

    Returns:
        The aliases in file order.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        ValueError: if the YAML does not parse, violates
            :data:`ALIASES_SCHEMA_PATH`, or maps the same normalised landmark
            twice (which would make resolution order-dependent).
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"landmark aliases not found: {source}")

    try:
        document = yaml.safe_load(source.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{source}: not valid YAML: {exc}") from exc

    _validate_aliases(source, document)

    aliases = [
        LandmarkAlias(
            landmark=entry["landmark"],
            osm_stop=entry["osm_stop"],
            stop_name=entry["stop_name"],
            source=entry["source"],
            note=entry.get("note", ""),
        )
        for entry in document["aliases"]
    ]

    seen: Dict[str, str] = {}
    for alias in aliases:
        key = normalise_name(alias.landmark)
        if key in seen:
            raise ValueError(
                f"{source}: landmarks {seen[key]!r} and {alias.landmark!r} "
                f"normalise to the same key {key!r}; keep exactly one alias"
            )
        seen[key] = alias.landmark
    return aliases


def _validate_aliases(source: Path, document: object) -> None:
    """Validate a parsed aliases document, naming what is wrong."""
    try:
        schema = json.loads(ALIASES_SCHEMA_PATH.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(
            f"{source}: cannot read aliases schema {ALIASES_SCHEMA_PATH}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"{source}: aliases schema {ALIASES_SCHEMA_PATH} is not JSON: {exc}"
        ) from exc

    validator = validator_for(schema)(schema)
    errors = sorted(
        validator.iter_errors(document),
        key=lambda error: [str(part) for part in error.absolute_path],
    )
    if not errors:
        return
    details = []
    for error in errors:
        location = "/".join(str(part) for part in error.absolute_path)
        details.append(f"{location or '<document>'}: {error.message}")
    raise ValueError(
        f"{source}: aliases do not match {ALIASES_SCHEMA_PATH.name}:\n  "
        + "\n  ".join(details)
    )


def alias_coordinates(
    aliases: Iterable[LandmarkAlias],
    stop_features: Mapping[str, NamedStop],
) -> Tuple[Dict[str, Tuple[float, float]], List[Dict[str, str]]]:
    """Coordinates for the aliases whose pinned OSM feature checks out.

    An alias is only usable when its ``osm_stop`` is a named stop feature in the
    extract *and* that feature's name still normalises to ``stop_name``. A
    feature that vanished or was renamed is returned as an invalid entry (with a
    reason) so the publish report can show it instead of silently resolving to a
    different place.

    Args:
        aliases: parsed aliases.
        stop_features: output of :func:`stop_feature_lookup` for the extract
            being published.

    Returns:
        ``({landmark: (lat, lon)}, [{landmark, osm_stop, reason}])`` - the
        usable aliases keyed by the published landmark string, and the invalid
        ones in file order.
    """
    coordinates: Dict[str, Tuple[float, float]] = {}
    invalid: List[Dict[str, str]] = []

    for alias in aliases:
        stop = stop_features.get(alias.osm_stop)
        if stop is None:
            invalid.append(
                {
                    "landmark": alias.landmark,
                    "osm_stop": alias.osm_stop,
                    "reason": "no named stop feature with that id in the extract",
                }
            )
            continue
        if normalise_name(stop.name) != normalise_name(alias.stop_name):
            invalid.append(
                {
                    "landmark": alias.landmark,
                    "osm_stop": alias.osm_stop,
                    "reason": (
                        f"extract feature is named {stop.name!r}, "
                        f"alias records {alias.stop_name!r}"
                    ),
                }
            )
            continue
        coordinates[alias.landmark] = (float(stop.lat), float(stop.lon))

    return coordinates, invalid


def resolve_landmarks(
    routes: Iterable[InventoryRoute],
    stop_lookup: Mapping[str, Tuple[float, float]],
    aliases: Optional[Mapping[str, Tuple[float, float]]] = None,
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
        aliases: optional ``{landmark: (lat, lon)}`` from
            :func:`alias_coordinates`. A direct exact-name match always wins;
            an alias is only consulted when the direct lookup misses (ruling
            R34 - aliases change which name is matched, never the matching
            rule).

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
            if coordinate is None and aliases is not None:
                coordinate = aliases.get(landmark)
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
