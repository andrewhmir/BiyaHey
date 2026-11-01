"""Publish stage (Task 8, spec 8.2 stage 05): the build that reaches the router.

Why this stage exists
---------------------
Task 6 turns OSM route relations into a GTFS core. Task 7 curates the jeepney /
UV Express inventory but deliberately ships no coordinates. Nothing in the plan
turned those two layers into the one artifact the router reads (ruling R30), and
nothing normalised the curated route ids against the OSM slugs (ruling R29).
This stage is that link. It:

1. reads named stop features from the NCR extract and resolves every curated
   terminal through :mod:`pipeline.landmarks` (no nearest-neighbour guessing);
2. lowercases curated ids and merges them with the OSM routes case-insensitively
   so ``jeep-T101`` and ``jeep-t101`` can never both enter the feed (R29), with
   OSM winning the collision because measured geometry beats a transcription;
3. builds the merged GTFS feed and attaches the fare tables from
   :mod:`pipeline.fares`;
4. writes ``<out>/gtfs/gtfs.zip`` (deterministic bytes, with the ODbL notice),
   ``<out>/manifest.json`` (sha256 + datasets + attributions) and
   ``<out>/build-report.json`` (the coverage report Task 11 consumes);
5. refuses to publish if the provenance registry names a blocked dataset or
   loses the ODbL notice (spec 8.1; ruling R22).

Build-report contract
---------------------
``build-report.json`` carries at least::

    curated_routes_total        16
    curated_routes_modelled     n
    curated_routes_skipped      [{code, reason}]
    landmark_unresolved         [{route_code, landmark}]
    osm_routes_total            n
    osm_routes_skipped          n
    blocked_datasets_checked    true

plus per-route records (``curated_routes``) that preserve each inventory row's
``source_url`` and ``needs_verification`` flag - ``to_route_def`` drops them, so
they are read from the :class:`~pipeline.inventory.InventoryRoute` (Task 7
finding). The brief spells the OSM counters ``oms_*`` (typo); both spellings are
emitted so neither a literal nor a corrected consumer breaks.

Default paths are resolved against the repository root, so the stage runs from
any working directory; explicit CLI arguments are used as given (relative to the
current directory, as usual).
"""

from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import yaml

from .fares import (
    FARE_ATTRIBUTES_FILENAME,
    FARE_RULES_FILENAME,
    build_gtfs_fare_tables,
    unrepresentable_fares,
)
from .gtfs import AgencyInfo, RouteDef, build_feed
from .inventory import (
    InventoryRoute,
    TerminalNotMappedError,
    load_inventory,
    route_id_for,
    to_route_def,
)
from .landmarks import (
    ambiguous_stop_names,
    build_stop_lookup,
    load_named_stops,
    normalise_name,
    resolve_landmarks,
)
from .manifest import (
    build_manifest,
    gate_manifest,
    gate_sources,
    load_sources,
    sha256_file,
)
from .osm_routes import iter_route_relations

__all__ = [
    "DEFAULT_BUILD_DIR",
    "DEFAULT_FARES",
    "DEFAULT_INVENTORY",
    "DEFAULT_PBF",
    "DEFAULT_SOURCES",
    "FEED_END",
    "FEED_START",
    "merge_curated_routes",
    "normalise_curated_route",
    "run_stage_publish",
]

#: Service window of the generated feed. Pinned to the 2026-11 v1 data vintage
#: (the fare matrix is effective 2026-09-28; Task 6's tests use the same range).
FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_BUILD_DIR = REPO_ROOT / "data" / "build"
DEFAULT_PBF = DEFAULT_BUILD_DIR / "osm" / "ncr.osm.pbf"
DEFAULT_INVENTORY = REPO_ROOT / "data" / "routes" / "jeepney-inventory.yaml"
DEFAULT_FARES = REPO_ROOT / "data" / "fares" / "fares-2026-09-28.yaml"
DEFAULT_SOURCES = REPO_ROOT / "data" / "provenance" / "sources.yaml"

#: Provenance registry ids the publish stage reads, in attribution order.
USED_SOURCE_IDS: Tuple[str, ...] = (
    "osm",
    "osm-wiki-jeepney",
    "ltfrb-fares",
    "mmda-ferry",
)


def normalise_curated_route(route: RouteDef) -> RouteDef:
    """Apply ruling R29 to one curated route: lowercase route and stop ids.

    ``to_route_def`` keeps the published code's case (``jeep-T101``) because
    Task 7 pins that behaviour. The feed, however, must compare against OSM's
    lowercased slugs (``jeep-t101``), so the publish stage lowercases both the
    route id and its namespaced stop ids. Stop ids are rebuilt too, otherwise a
    stop would be namespaced by a route id that is not in ``routes.txt``.
    """
    return replace(
        route,
        route_id=route.route_id.lower(),
        stops=tuple(
            replace(stop, stop_id=stop.stop_id.lower()) for stop in route.stops
        ),
    )


def merge_curated_routes(
    osm_routes: Sequence[RouteDef], curated_routes: Sequence[RouteDef]
) -> List[RouteDef]:
    """Merge OSM and curated routes with a case-insensitive id comparison (R29).

    OSM wins a collision: a curated entry may fill a coverage gap but can never
    replace measured geometry, stops or naming. The returned list has route ids
    that are unique case-insensitively, so the GTFS builder cannot admit both
    ``jeep-T101`` and ``jeep-t101``.
    """
    merged: List[RouteDef] = list(osm_routes)
    claimed = {route.route_id.casefold() for route in merged}
    for route in curated_routes:
        key = route.route_id.casefold()
        if key in claimed:
            continue
        claimed.add(key)
        merged.append(route)
    return merged


def run_stage_publish(
    pbf: Path,
    out_dir: Path,
    inventory_path: Path = DEFAULT_INVENTORY,
    fares_path: Path = DEFAULT_FARES,
    sources_path: Path = DEFAULT_SOURCES,
    *,
    built_at: Optional[str] = None,
    agency: AgencyInfo = AgencyInfo.SYNTHETIC,
) -> Dict[str, Any]:
    """Run the publish stage and return the build report.

    Args:
        pbf: NCR OSM extract (``data/build/osm/ncr.osm.pbf`` in production, a
            committed fixture in tests).
        out_dir: build directory; writes ``gtfs/gtfs.zip``, ``manifest.json`` and
            ``build-report.json`` below it.
        inventory_path: curated inventory YAML.
        fares_path: hand-curated fare matrix YAML.
        sources_path: provenance registry YAML.
        built_at: ISO-8601 UTC timestamp recorded in the manifest/report;
            defaults to the current UTC time.
        agency: GTFS publisher metadata (the committed synthetic agency).

    Returns:
        The build report mapping (also written to ``build-report.json``).

    Raises:
        FileNotFoundError: an input file (or the OSM extract) is missing.
        ValueError: an input is malformed (inventory schema, fare matrix,
            registry) or the build cannot produce a valid feed.
        BlockedDatasetError: the registry names a blocked dataset (spec 8.1).
        LicenceGateError: the ODbL licence/attribution would be lost.
    """
    pbf = Path(pbf)
    out_dir = Path(out_dir)
    inventory_path = Path(inventory_path)
    fares_path = Path(fares_path)
    sources_path = Path(sources_path)

    for label, path in (
        ("OSM extract", pbf),
        ("curated inventory", inventory_path),
        ("fare matrix", fares_path),
        ("provenance registry", sources_path),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"{label} not found: {path}")

    built_at = built_at or _utc_now()

    # Gate the provenance registry before doing any work: a blocked dataset or a
    # lost ODbL notice must fail before a single artifact is written.
    sources = load_sources(sources_path)
    missing_sources = [source_id for source_id in USED_SOURCE_IDS if source_id not in sources]
    if missing_sources:
        raise ValueError(
            f"{sources_path}: provenance registry is missing source(s) the "
            f"publish stage requires: {missing_sources}"
        )
    gate_sources(sources)

    # Resolve curated terminals against named stop features in the extract.
    named_stops = load_named_stops(pbf)
    stop_lookup = build_stop_lookup(named_stops)
    inventory = load_inventory(inventory_path)
    resolved_landmarks = resolve_landmarks(inventory, stop_lookup)
    osm_routes = list(iter_route_relations(pbf))

    claimed = {route.route_id.casefold() for route in osm_routes}
    curated_routes: List[RouteDef] = []
    records: List[Dict[str, Any]] = []
    unresolved: List[Dict[str, str]] = []

    for entry in inventory:
        record: Dict[str, Any] = {
            "code": entry.code,
            "route_id": route_id_for(entry).lower(),
            "name": entry.name,
            "mode": entry.mode,
            "source_url": entry.source_url,
            "needs_verification": entry.needs_verification,
            "status": "modelled",
        }
        records.append(record)

        try:
            route_def = normalise_curated_route(to_route_def(entry, resolved_landmarks))
        except TerminalNotMappedError as exc:
            reason = "unresolved landmark(s): " + ", ".join(exc.missing)
            record.update(status="skipped", reason=reason)
            unresolved.extend(
                {"route_code": entry.code, "landmark": landmark}
                for landmark in exc.missing
            )
            continue

        if len(route_def.stops) < 2:
            record.update(
                status="skipped",
                reason="fewer than two resolved stop landmarks",
            )
            continue

        key = route_def.route_id.casefold()
        if key in claimed:
            record.update(
                status="skipped",
                reason=(
                    f"duplicate route id: OSM already supplies route "
                    f"{route_def.route_id}"
                ),
            )
            continue

        claimed.add(key)
        curated_routes.append(route_def)

    merged = merge_curated_routes(osm_routes, curated_routes)
    feed = build_feed(merged, agency, FEED_START, FEED_END)
    written_route_ids = {route.route_id for route in feed.routes}

    # The builder is the last word on what entered the feed. Reconcile the
    # records so a curated route it had to skip is reported, never counted as
    # modelled.
    for record in records:
        if record["status"] == "modelled" and record["route_id"] not in written_route_ids:
            record.update(
                status="skipped",
                reason=(
                    "GTFS builder skipped the route (no usable geometry or fewer "
                    "than two stops)"
                ),
            )
    skipped = [
        {"code": record["code"], "reason": record["reason"]}
        for record in records
        if record["status"] == "skipped"
    ]
    modelled = sum(1 for record in records if record["status"] == "modelled")

    fares_document = _load_yaml(fares_path, "fare matrix")
    fare_tables = build_gtfs_fare_tables(
        fares_document, [route.route_id for route in feed.routes]
    )
    zip_path = out_dir / "gtfs" / "gtfs.zip"
    feed.write(zip_path, extra_tables=fare_tables)

    manifest = build_manifest(
        [zip_path],
        _manifest_sources(sources, pbf, inventory_path, fares_path, zip_path),
        built_at,
    )
    gate_manifest(manifest)
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    used_names = {
        normalise_name(landmark)
        for entry in inventory
        for landmark in entry.stop_landmarks
    }
    ambiguous_landmarks = [
        {
            "name": normalised,
            "candidates": [
                {
                    "name": stop.name,
                    "lat": stop.lat,
                    "lon": stop.lon,
                    "osm_feature": stop.feature,
                }
                for stop in stops
            ]
        }
        for normalised, stops in ambiguous_stop_names(named_stops).items()
        if normalised in used_names
    ]

    osm_total = len(osm_routes)
    osm_skipped = len({route.route_id for route in osm_routes} - written_route_ids)

    report_path = out_dir / "build-report.json"
    report: Dict[str, Any] = {
        "built_at": built_at,
        "report_path": str(report_path),
        "feed": {
            "path": str(zip_path),
            "start_date": FEED_START.isoformat(),
            "end_date": FEED_END.isoformat(),
            "routes": len(feed.routes),
            "stops": len(feed.stops),
            "trips": len(feed.trips),
            "stop_times": len(feed.stop_times),
            "sha256": sha256_file(zip_path),
            "route_ids": sorted(written_route_ids),
        },
        "curated_routes_total": len(inventory),
        "curated_routes_modelled": modelled,
        "curated_routes_skipped": skipped,
        "landmark_unresolved": unresolved,
        "curated_routes": records,
        "osm_routes_total": osm_total,
        "oms_routes_total": osm_total,  # literal spelling of the Task 8 brief
        "osm_routes_skipped": osm_skipped,
        "oms_routes_skipped": osm_skipped,  # literal spelling of the Task 8 brief
        "blocked_datasets_checked": True,
        "datasets_used": [dataset["id"] for dataset in manifest["datasets"]],
        "attributions": manifest["attributions"],
        "ambiguous_landmarks": ambiguous_landmarks,
        "fare_tables": {
            "fare_attributes_rows": _row_count(fare_tables[FARE_ATTRIBUTES_FILENAME]),
            "fare_rules_rows": _row_count(fare_tables[FARE_RULES_FILENAME]),
            "unrepresentable": unrepresentable_fares(fares_document),
        },
        "build_stats": asdict(feed.stats),
        "manifest_path": str(manifest_path),
    }

    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _manifest_sources(
    sources: Dict[str, Dict[str, Any]],
    pbf: Path,
    inventory_path: Path,
    fares_path: Path,
    zip_path: Path,
) -> Dict[str, Dict[str, Any]]:
    """Registry metadata for the four sources used, with local paths bound.

    ``osm`` also licenses the generated zip (the feed is a derived database of
    ODbL content). ``mmda-ferry`` rides in the same fare matrix file, so it
    contributes attribution only rather than a duplicate dataset hash.
    """
    local_paths: Dict[str, Optional[Path]] = {
        "osm": pbf,
        "osm-wiki-jeepney": inventory_path,
        "ltfrb-fares": fares_path,
        "mmda-ferry": None,
    }
    manifest_sources: Dict[str, Dict[str, Any]] = {}
    for source_id in USED_SOURCE_IDS:
        metadata = dict(sources[source_id])
        path = local_paths[source_id]
        if path is not None:
            metadata["path"] = path
        if source_id == "osm":
            metadata["artifact"] = zip_path.name
        manifest_sources[source_id] = metadata
    return manifest_sources


def _load_yaml(path: Path, label: str) -> Dict[str, Any]:
    """Parse a YAML input, naming it in the error message."""
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{path}: {label} is not valid YAML: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError(f"{path}: {label} must be a YAML mapping")
    return document


def _row_count(table_text: str) -> int:
    """Data rows in a rendered GTFS table (header excluded)."""
    lines = [line for line in table_text.splitlines() if line.strip()]
    return max(0, len(lines) - 1)


def _utc_now() -> str:
    """The build timestamp format the manifest pins: ``YYYY-MM-DDTHH:MM:SSZ``."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
