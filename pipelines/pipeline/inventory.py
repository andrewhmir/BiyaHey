"""Curated jeepney / UV Express inventory: the seed, its schema, and the merge.

Why this stage exists
---------------------
OSM coverage of Metro Manila's jeepney network is thin and uneven. The route
relations Task 6 can read give geometry and stops where mappers have done the
work, and nothing at all where they have not. Task 7 adds a *curated* layer:
a hand-transcribed list of LTFRB route numbers, names, terminals and roads,
sourced from the OpenStreetMap Wiki. A route therefore enters the feed with
either real geometry (OSM, preferred) or a coarse landmark-only placeholder
(curated), and never silently disappears.

:func:`merge_routes` is the join: OSM identifiers win, so a curated entry can
never overwrite measured geometry. The curated layer only fills the gaps.

The honesty rules (spec §8.1 provenance)
----------------------------------------
The seed is not "data we made up to fill a table". It is a transcription, and
the module keeps that distinction visible:

* the YAML carries ``needs_verification: true`` on every row until an
  independent source corroborates it;
* every row carries the ``source_url`` of the wiki section it came from;
* a field the source does not publish is ``null`` in the YAML and ``None``
  here. It is never estimated or defaulted at load time, so a reader can tell
  "nobody publishes a headway" from "the headway is 4 minutes".

The OSM Wiki publishes route numbers, names, road sequences, operators for some
routes and lengths for some routes. It publishes **no headways** and **no
stop-level stop list**, so ``headway_*`` is ``None`` throughout the seed and
``stop_landmarks`` holds named terminals only.

What a curated route becomes
----------------------------
:func:`to_route_def` produces a :class:`~pipeline.gtfs.RouteDef`:

* ``route_id`` is ``jeep-<code>`` or ``uv-<code>`` (the prefix mirrors the
  namespacing Task 6 pins for OSM ids, so the BFF can map an id back to an app
  mode without a lookup table);
* ``route_type`` is 3 (GTFS "bus"): a jeepney and a UV Express van are road
  public-utility vehicles, and 3 is the type the GTFS builder already prices
  and schedules for jeepneys;
* ``distance_km`` is the published length, else ``None``;
* ``stops`` are the named landmarks, resolved through a caller-supplied
  ``stop_lookup`` (``landmark -> (lat, lon)``). Coordinates are **not** stored
  in the seed: the source has none, and inventing them would turn a
  transcription into a fabrication;
* ``shape`` is the straight polyline through those resolved landmarks. It is a
  coarse placeholder, honest about being one, and is exactly why OSM geometry
  wins the merge;
* ``headway_*`` fall back to the GTFS defaults when the source is silent, which
  is the documented behaviour of :func:`pipeline.gtfs.build_feed`.

When a landmark has no coordinate the route is *not* silently dropped and the
run does not crash: :class:`TerminalNotMappedError` names the route and every
missing landmark, so the coverage report can list what still needs mapping.

Caveat for the merge (carried into the Task 7 report)
-----------------------------------------------------
Route ids are compared **exactly**, as the brief specifies, and the curated id
keeps the published code's case (``jeep-T101``). ``pipeline.osm_routes``
slugifies OSM refs to lowercase (``ref=T101`` -> ``jeep-t101``), so an OSM
relation and a curated entry for the same corridor collide only when the cases
match. That is a Task 10 reconciliation question, not something to paper over
here by loosening the pinned id format.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import yaml
from jsonschema.validators import validator_for

from .gtfs import (
    DEFAULT_HEADWAY_OFFPEAK_MIN,
    DEFAULT_HEADWAY_PEAK_MIN,
    RouteDef,
    StopRef,
)

__all__ = [
    "MODE_JEEPNEY",
    "MODE_UV_EXPRESS",
    "InventoryRoute",
    "TerminalNotMappedError",
    "load_inventory",
    "merge_routes",
    "route_id_for",
    "to_route_def",
]

#: Curated vehicle families and the route-id prefix each one contributes.
MODE_JEEPNEY = "jeepney"
MODE_UV_EXPRESS = "uv-express"
MODE_PREFIX: Dict[str, str] = {MODE_JEEPNEY: "jeep", MODE_UV_EXPRESS: "uv"}

#: GTFS route_type for both curated families. 3 is "bus": a jeepney and a UV
#: Express van are road PUVs, and it is the type the GTFS builder already has
#: segment timings for.
CURATED_ROUTE_TYPE = 3

#: The schema that ships with the repository. ``load_inventory`` prefers a
#: schema sitting next to the data file (``<dir>/schema/<stem>.schema.json``)
#: and falls back to this one, so a caller validating a scratch file still gets
#: the real contract instead of a silent pass.
DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "routes"
    / "schema"
    / "jeepney-inventory.schema.json"
)


class TerminalNotMappedError(LookupError):
    """A curated route names a landmark the stop lookup cannot place.

    Raised by :func:`to_route_def` instead of dropping the stop or the route,
    so the coverage report can list precisely what still needs mapping.

    Attributes:
        route_code: the LTFRB route number whose landmark is missing.
        missing: every unmapped landmark name, in the route's travel order.
    """

    def __init__(self, route_code: str, missing: Sequence[str]) -> None:
        self.route_code = route_code
        self.missing: Tuple[str, ...] = tuple(missing)
        listed = ", ".join(repr(name) for name in self.missing)
        super().__init__(
            f"route {route_code}: no coordinates for stop landmark(s) {listed}; "
            f"map them or drop them from the inventory entry"
        )


@dataclass(frozen=True)
class InventoryRoute:
    """One curated route, exactly as the source publishes it.

    ``headway_peak_min``, ``headway_offpeak_min``, ``typical_length_km`` and
    ``operator`` are required arguments with no defaults on purpose: a curated
    entry has to state its gaps explicitly (``None``) rather than inherit a
    plausible-looking value. ``needs_verification`` defaults to ``True``
    because an entry is untrusted until someone corroborates it.
    """

    code: str
    name: str
    mode: str
    endpoints: Tuple[str, str]
    via_roads: Tuple[str, ...]
    stop_landmarks: Tuple[str, ...]
    headway_peak_min: Optional[int]
    headway_offpeak_min: Optional[int]
    typical_length_km: Optional[float]
    operator: Optional[str]
    source_url: str
    needs_verification: bool = True


def route_id_for(route: InventoryRoute) -> str:
    """The namespaced GTFS route id for a curated route: ``jeep-T101``, ``uv-C20``.

    Raises:
        ValueError: if the route's mode has no pinned prefix.
    """
    try:
        prefix = MODE_PREFIX[route.mode]
    except KeyError as exc:
        raise ValueError(
            f"route {route.code}: unknown mode {route.mode!r}; "
            f"expected one of {sorted(MODE_PREFIX)}"
        ) from exc
    return f"{prefix}-{route.code}"


def load_inventory(path: Union[Path, str]) -> List[InventoryRoute]:
    """Read and schema-validate a curated inventory file.

    Args:
        path: YAML file (the committed seed, or a scratch file in a test). The
            schema is looked up next to the file first
            (``<dir>/schema/<stem>.schema.json``) and otherwise from
            :data:`DEFAULT_SCHEMA_PATH`.

    Returns:
        The routes in file order.

    Raises:
        FileNotFoundError: if ``path`` is not a file.
        ValueError: if the YAML does not parse, violates the schema, or repeats
            a route code. Schema errors name the offending route code, so the
            message points at a row rather than at a JSON pointer.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"inventory not found: {source}")

    try:
        document = yaml.safe_load(source.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{source}: not valid YAML: {exc}") from exc

    schema_path = _schema_path_for(source)
    _validate(source, document, schema_path)

    routes = [_to_inventory_route(entry) for entry in document["routes"]]

    seen = set()
    for route in routes:
        if route.code in seen:
            raise ValueError(f"{source}: duplicate route code {route.code!r}")
        seen.add(route.code)
    return routes


def to_route_def(
    route: InventoryRoute, stop_lookup: Mapping[str, Tuple[float, float]]
) -> RouteDef:
    """Turn a curated route into a :class:`~pipeline.gtfs.RouteDef`.

    Args:
        route: the curated entry.
        stop_lookup: landmark name -> ``(lat, lon)``. Supplied by the caller
            because the seed stores no coordinates.

    Returns:
        A RouteDef whose stops follow ``route.stop_landmarks`` in order, whose
        ``shape`` is the straight polyline through those stops, and whose
        ``distance_km`` is the published length (or ``None``).

    Raises:
        TerminalNotMappedError: if any landmark is absent from ``stop_lookup``.
            The exception lists every missing landmark for the route.
    """
    missing = tuple(name for name in route.stop_landmarks if name not in stop_lookup)
    if missing:
        raise TerminalNotMappedError(route.code, missing)

    route_id = route_id_for(route)
    stops = tuple(
        StopRef(
            stop_id=f"{route_id}:landmark:{index}",
            name=name,
            lat=float(stop_lookup[name][0]),
            lon=float(stop_lookup[name][1]),
        )
        for index, name in enumerate(route.stop_landmarks)
    )
    shape = tuple((stop.lat, stop.lon) for stop in stops)

    return RouteDef(
        route_id=route_id,
        route_type=CURATED_ROUTE_TYPE,
        name=route.name,
        short_name=route.code,
        stops=stops,
        shape=shape,
        distance_km=route.typical_length_km,
        headway_peak_min=(
            DEFAULT_HEADWAY_PEAK_MIN
            if route.headway_peak_min is None
            else route.headway_peak_min
        ),
        headway_offpeak_min=(
            DEFAULT_HEADWAY_OFFPEAK_MIN
            if route.headway_offpeak_min is None
            else route.headway_offpeak_min
        ),
    )


def merge_routes(
    osm: Sequence[RouteDef], inventory: Sequence[RouteDef]
) -> List[RouteDef]:
    """Join measured OSM routes with curated inventory routes.

    OSM wins on a duplicate ``route_id``: a curated entry can fill a gap but
    can never replace measured geometry, stops or naming. Curated routes whose
    id OSM already supplies are dropped rather than duplicated, because a
    duplicate id would be skipped by the GTFS builder anyway and would only
    inflate the build's skip counters.

    Args:
        osm: routes read from OSM by Task 6, in OSM order.
        inventory: routes produced by :func:`to_route_def`, in seed order.

    Returns:
        The OSM routes in their original order, followed by the curated routes
        OSM does not cover, in seed order. The result has unique route ids.
    """
    merged: List[RouteDef] = list(osm)
    claimed = {route.route_id for route in merged}
    for route in inventory:
        if route.route_id in claimed:
            continue
        claimed.add(route.route_id)
        merged.append(route)
    return merged


# --------------------------------------------------------------------------
# loading helpers
# --------------------------------------------------------------------------


def _schema_path_for(source: Path) -> Path:
    """Prefer a schema beside the data file; fall back to the shipped one."""
    local = source.parent / "schema" / f"{source.stem}.schema.json"
    return local if local.is_file() else DEFAULT_SCHEMA_PATH


def _validate(source: Path, document: Any, schema_path: Path) -> None:
    """Validate a parsed inventory document, naming route codes in failures."""
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"{source}: cannot read inventory schema {schema_path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{source}: inventory schema {schema_path} is not JSON: {exc}") from exc

    # Dispatch on the schema's own ``$schema`` (draft-07, like every other
    # data schema in this repo) instead of pinning a draft here, so bumping the
    # schema does not silently validate against the wrong vocabulary.
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
        where = f"{location}: " if location else ""
        details.append(f"{_offending_code(document, error)}: {where}{error.message}")
    raise ValueError(
        f"{source}: inventory does not match {schema_path.name}:\n  "
        + "\n  ".join(details)
    )


def _offending_code(document: Any, error: Any) -> str:
    """Find the route code a schema error belongs to, for a readable message."""
    parts = list(error.absolute_path)
    for index, part in enumerate(parts):
        if part != "routes" or index + 1 >= len(parts):
            continue
        position = parts[index + 1]
        entries = document.get("routes") if isinstance(document, dict) else None
        if isinstance(entries, list) and isinstance(position, int) and 0 <= position < len(entries):
            entry = entries[position]
            if isinstance(entry, dict):
                code = entry.get("code")
                if isinstance(code, str) and code.strip():
                    return code
        return f"routes[{position}]"
    return "<inventory>"


def _to_inventory_route(entry: Mapping[str, Any]) -> InventoryRoute:
    """Build an InventoryRoute from a schema-validated mapping."""
    # The schema guarantees exactly two endpoints, so indexing is safe here.
    endpoints = entry["endpoints"]
    return InventoryRoute(
        code=entry["code"],
        name=entry["name"],
        mode=entry["mode"],
        endpoints=(endpoints[0], endpoints[1]),
        via_roads=tuple(entry["via_roads"]),
        stop_landmarks=tuple(entry["stop_landmarks"]),
        headway_peak_min=entry["headway_peak_min"],
        headway_offpeak_min=entry["headway_offpeak_min"],
        typical_length_km=entry["typical_length_km"],
        operator=entry["operator"],
        source_url=entry["source_url"],
        needs_verification=entry["needs_verification"],
    )
