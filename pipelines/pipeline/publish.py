"""Publish stage (Task 8, spec 8.2 stage 05): the build that reaches the router.

Why this stage exists
---------------------
Task 6 turns OSM route relations into a GTFS core. Task 7 curates the jeepney /
UV Express inventory but deliberately ships no coordinates. Nothing in the plan
turned those two layers into the one artifact the router reads (ruling R30), and
nothing normalised the curated route ids against the OSM slugs (ruling R29).
This stage is that link. It:

1. reads named stop features from the NCR extract and resolves every curated
   terminal through :mod:`pipeline.landmarks` (no nearest-neighbour guessing),
   consulting ``data/routes/landmark-aliases.yaml`` (ruling R34) when a curated
   landmark's exact name is not an OSM stop name;
2. lowercases curated ids and merges them with the OSM routes case-insensitively
   so ``jeep-T101`` and ``jeep-t101`` can never both enter the feed (R29), with
   OSM winning the collision because measured geometry beats a transcription;
3. builds the merged GTFS feed and attaches the fare tables from
   :mod:`pipeline.fares`;
4. writes ``<out>/gtfs/gtfs.zip`` (deterministic bytes, with the ODbL notice
   and the CC BY-SA 2.0 inventory attribution inside), ``<out>/manifest.json``
   (sha256 + datasets + attributions) and ``<out>/build-report.json`` (the
   coverage report Task 11 consumes);
5. refuses to publish if the provenance registry names a blocked dataset, or if
   the manifest or the written feed loses the ODbL notice or the CC BY-SA 2.0
   inventory attribution (spec 8.1/8.2; rulings R22, R32).

Build-report contract
---------------------
``build-report.json`` carries at least::

    curated_routes_total        16
    curated_routes_modelled     n
    curated_routes_skipped      [{code, reason}]
    coverage                    {total, modelled, pct, missing: [{code, reason}]}
    landmark_unresolved         [{route_code, landmark}]
    landmark_aliases            {path, total, used: [...], invalid: [...]}
    osm_routes_total            n
    osm_routes_skipped          n
    excluded_routes_total       n
    excluded_routes             [{route_id, reason}]
    blocked_datasets_checked    true

plus per-route records (``curated_routes``) that preserve each inventory row's
``source_url`` and ``needs_verification`` flag - ``to_route_def`` drops them, so
they are read from the :class:`~pipeline.inventory.InventoryRoute` (Task 7
finding). ``curated_routes_modelled`` counts curated entries that entered the
feed themselves; ``coverage`` comes from
:func:`pipeline.coverage.compute_coverage` and counts any inventory row whose
route id the feed carries, including a route OSM already supplies (the Task 8
duplicate skip). Coverage can therefore be *higher* than the curated count, and
the difference is never silent: the skipped record names the duplicate. The brief
spells the OSM counters ``oms_*`` (typo); both spellings are emitted so neither a
literal nor a corrected consumer breaks.

Default paths are resolved against the repository root, so the stage runs from
any working directory; explicit CLI arguments are used as given (relative to the
current directory, as usual).
"""

from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import yaml

from .fares import (
    FARE_ATTRIBUTES_FILENAME,
    FARE_RULES_FILENAME,
    build_gtfs_fare_tables,
    unrepresentable_fares,
)
from .coverage import compute_coverage
from .gtfs import (
    WIKI_INVENTORY_ATTRIBUTION,
    AgencyInfo,
    RouteDef,
    build_feed,
    read_licence_text,
)
from .inventory import (
    InventoryRoute,
    TerminalNotMappedError,
    load_inventory,
    route_id_for,
    to_route_def,
)
from .landmarks import (
    LandmarkAlias,
    alias_coordinates,
    ambiguous_stop_names,
    build_stop_lookup,
    load_landmark_aliases,
    load_named_stops,
    normalise_name,
    resolve_landmarks,
    stop_feature_lookup,
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
    "DEFAULT_ALIASES",
    "DEFAULT_BUILD_DIR",
    "DEFAULT_FARES",
    "DEFAULT_INVENTORY",
    "DEFAULT_PBF",
    "DEFAULT_SOURCES",
    "FEED_END",
    "FEED_START",
    "UNSUPPORTED_RAIL_ROUTE_IDS",
    "exclude_unsupported_routes",
    "merge_curated_routes",
    "normalise_curated_route",
    "run_stage_publish",
    "unsupported_route_reason",
]

#: Service window of the generated feed. Pinned to the 2026-11 v1 data vintage
#: (the fare matrix is effective 2026-09-28; Task 6's tests use the same range).
FEED_START = date(2026, 11, 1)
FEED_END = date(2027, 10, 31)

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_BUILD_DIR = REPO_ROOT / "data" / "build"
DEFAULT_PBF = DEFAULT_BUILD_DIR / "osm" / "ncr.osm.pbf"
DEFAULT_INVENTORY = REPO_ROOT / "data" / "routes" / "jeepney-inventory.yaml"
DEFAULT_ALIASES = REPO_ROOT / "data" / "routes" / "landmark-aliases.yaml"
DEFAULT_FARES = REPO_ROOT / "data" / "fares" / "fares-2026-09-28.yaml"
DEFAULT_SOURCES = REPO_ROOT / "data" / "provenance" / "sources.yaml"

#: Provenance registry ids the publish stage reads, in attribution order.
USED_SOURCE_IDS: Tuple[str, ...] = (
    "osm",
    "osm-wiki-jeepney",
    "ltfrb-fares",
    "mmda-ferry",
)

#: Rail lines present in the OSM extract that v1 has no fare mode for.
#: ``rail-ss``/``rail-mnc`` are PNR services (no published v1 fare table) and
#: ``rail-mrt9`` is the proposed Metro Manila Subway; the BFF would have to drop
#: every itinerary that touched them, so the publish stage keeps them out of the
#: feed and reports the exclusion instead of shipping unpriceable options.
UNSUPPORTED_RAIL_ROUTE_IDS = frozenset({"rail-ss", "rail-mnc", "rail-mrt9"})


def unsupported_route_reason(route_id: str) -> Optional[str]:
    """Return why ``route_id`` is excluded from the v1 feed, or ``None``.

    The mode gate mirrors the BFF adapter: only rail lines with a fare mode
    (``rail-1/2/3``) and only the MMDA Pasig River Ferry (``ferry-prfs…``) are
    priceable. Long-distance ferries (``ferry-manilacoron``,
    ``ferry-maniladavao…``) are real services but have no v1 fare source, and
    pricing them as the free PRFS ferry would be false.
    """
    normalized = route_id.strip().lower()
    if normalized in UNSUPPORTED_RAIL_ROUTE_IDS:
        return "unsupported rail line: no v1 fare mode (PNR or proposed MRT-9)"
    if normalized.startswith("ferry-") and not normalized.startswith("ferry-prfs"):
        return "unsupported ferry: not the free MMDA Pasig River Ferry (PRFS)"
    return None


def exclude_unsupported_routes(
    routes: Sequence[RouteDef],
) -> Tuple[List[RouteDef], List[Dict[str, str]]]:
    """Split OSM routes into (publishable, excluded) with one reason per exclusion.

    Excluding before :func:`pipeline.gtfs.build_feed` means an unpriceable
    itinerary can never reach MOTIS, and the build report names exactly what was
    left out (final-review item 7). The order of the kept routes is preserved.
    The excluded list is deduplicated by route id: OSM often maps one service to
    several relations (``rail-mnc`` appears twice in the NCR extract), and the
    policy exclusion applies to the id, not to each relation row.
    """
    kept: List[RouteDef] = []
    excluded: List[Dict[str, str]] = []
    excluded_ids: set = set()
    for route in routes:
        reason = unsupported_route_reason(route.route_id)
        if reason is None:
            kept.append(route)
        elif route.route_id not in excluded_ids:
            excluded_ids.add(route.route_id)
            excluded.append({"route_id": route.route_id, "reason": reason})
    return kept, excluded


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
    osm_routes: Sequence[RouteDef],
    curated_routes: Sequence[RouteDef],
    claimed_route_ids: Optional[Iterable[str]] = None,
) -> List[RouteDef]:
    """Merge OSM and curated routes with a case-insensitive id comparison (R29).

    OSM wins a collision: a curated entry may fill a coverage gap but can never
    replace measured geometry, stops or naming. The returned list has route ids
    that are unique case-insensitively, so the GTFS builder cannot admit both
    ``jeep-T101`` and ``jeep-t101``.

    Args:
        osm_routes: measured routes, in OSM order.
        curated_routes: curated routes whose terminals resolved.
        claimed_route_ids: ids the builder actually wrote from OSM (defaults to
            every OSM route id). Publish passes the written set, because an OSM
            relation the GTFS builder cannot write - no geometry, fewer than two
            stops, or a duplicate id it drops - has no measured geometry to win
            a collision with, and must not shadow a usable curated route.
    """
    merged: List[RouteDef] = list(osm_routes)
    if claimed_route_ids is None:
        claimed = {route.route_id.casefold() for route in merged}
    else:
        claimed = {route_id.casefold() for route_id in claimed_route_ids}
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
    aliases_path: Optional[Path] = DEFAULT_ALIASES,
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
        aliases_path: documented landmark aliases YAML (ruling R34), or ``None``
            to resolve by exact OSM stop name only. Invalid aliases (a feature
            id absent from the extract or a renamed feature) are reported in
            ``landmark_aliases.invalid`` and the affected landmark stays
            unresolved; a malformed file fails the build.
        built_at: ISO-8601 UTC timestamp recorded in the manifest/report;
            defaults to the current UTC time.
        agency: GTFS publisher metadata (the committed synthetic agency).

    Returns:
        The build report mapping (also written to ``build-report.json``).

    Raises:
        FileNotFoundError: an input file (or the OSM extract) is missing.
        ValueError: an input is malformed (inventory schema, aliases schema,
            fare matrix, registry) or the build cannot produce a valid feed.
        BlockedDatasetError: the registry names a blocked dataset (spec 8.1).
        LicenceGateError: the ODbL licence/attribution or the CC BY-SA 2.0
            inventory attribution would be lost (spec 8.2; ruling R32).
    """
    pbf = Path(pbf)
    out_dir = Path(out_dir)
    inventory_path = Path(inventory_path)
    fares_path = Path(fares_path)
    sources_path = Path(sources_path)
    aliases: Optional[Path] = None if aliases_path is None else Path(aliases_path)

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

    # Documented aliases are validated before the expensive extract scans, so a
    # hand-edited file fails fast (ruling R34).
    alias_list: List[LandmarkAlias] = (
        load_landmark_aliases(aliases) if aliases is not None else []
    )

    # Resolve curated terminals against named stop features in the extract.
    named_stops = load_named_stops(pbf)
    stop_lookup = build_stop_lookup(named_stops)
    alias_lookup, invalid_aliases = alias_coordinates(
        alias_list, stop_feature_lookup(named_stops)
    )
    inventory = load_inventory(inventory_path)
    resolved_landmarks = resolve_landmarks(inventory, stop_lookup, alias_lookup)
    # Final-review item 7 / ruling-adjacent mode gate: keep route families v1
    # cannot price out of the feed, and report each exclusion. The BFF also
    # guards this at response time (defence in depth), but shipping the routes
    # would silently turn their corridors into dropped-itinerary holes.
    all_osm_routes = list(iter_route_relations(pbf))
    osm_routes, excluded_routes = exclude_unsupported_routes(all_osm_routes)

    # R29 says OSM wins a collision "because measured geometry beats a
    # transcription". An OSM relation the GTFS builder cannot write has no
    # measured geometry to win with, so claim only the ids the builder actually
    # writes; otherwise a malformed OSM relation (e.g. a share_taxi with one
    # stop) shadows a usable curated route and the route is reported as a
    # "duplicate" that no feed row carries.
    osm_feed = build_feed(osm_routes, agency, FEED_START, FEED_END)
    written_osm_ids = {route.route_id.casefold() for route in osm_feed.routes}
    claimed = set(written_osm_ids)
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

    merged = merge_curated_routes(osm_routes, curated_routes, written_osm_ids)
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
    # The coverage module is the Task 11 metric's single implementation. It
    # counts a route as covered when its id is in the feed at all - which can
    # exceed `curated_routes_modelled`, because an OSM relation that already
    # carries the route id (a R29 duplicate skip) models the corridor with real
    # geometry. The two numbers answer different questions and the report keeps
    # both: `curated_routes_modelled` = "did this curated entry enter the feed?",
    # `coverage.modelled` = "does the feed carry a route for this inventory row?".
    coverage = compute_coverage(inventory, written_route_ids)
    modelled = sum(1 for record in records if record["status"] == "modelled")
    alias_usage = _alias_usage(alias_list, inventory, stop_lookup, resolved_landmarks)

    fares_document = _load_yaml(fares_path, "fare matrix")
    fare_tables = build_gtfs_fare_tables(
        fares_document, [route.route_id for route in feed.routes]
    )
    zip_path = out_dir / "gtfs" / "gtfs.zip"
    # Ruling R32: the CC BY-SA 2.0 attribution for the wiki-derived inventory
    # must be stated by the published feed itself, not only by the manifest.
    feed.write(
        zip_path,
        extra_tables=fare_tables,
        wiki_inventory_attribution=WIKI_INVENTORY_ATTRIBUTION,
    )

    manifest = build_manifest(
        [zip_path],
        _manifest_sources(sources, pbf, inventory_path, fares_path, zip_path),
        built_at,
    )
    # Self-check the artifact that was just written: the gate reads the feed's
    # LICENSE-DATA.txt, so losing the inventory attribution fails the build
    # before the manifest can ship (ruling R32).
    gate_manifest(manifest, artifact_text=read_licence_text(zip_path))
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

    osm_total = len(all_osm_routes)
    osm_skipped = len({route.route_id for route in all_osm_routes} - written_route_ids)

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
        "coverage": coverage,
        "landmark_unresolved": unresolved,
        "landmark_aliases": {
            "path": str(aliases) if aliases is not None else None,
            "total": len(alias_list),
            "used": alias_usage,
            "invalid": invalid_aliases,
        },
        "curated_routes": records,
        "osm_routes_total": osm_total,
        "oms_routes_total": osm_total,  # literal spelling of the Task 8 brief
        "osm_routes_skipped": osm_skipped,
        "oms_routes_skipped": osm_skipped,  # literal spelling of the Task 8 brief
        # Final-review item 7: name every route family kept out of the feed so a
        # missing corridor is a documented data gap, not a silent absence.
        "excluded_routes_total": len(excluded_routes),
        "excluded_routes": excluded_routes,
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


def _alias_usage(
    aliases: Sequence[LandmarkAlias],
    inventory: Sequence[InventoryRoute],
    stop_lookup: Mapping[str, Tuple[float, float]],
    resolved_landmarks: Mapping[str, Tuple[float, float]],
) -> List[Dict[str, Any]]:
    """Aliases that actually changed resolution, with the routes they unlocked.

    A direct exact-name match always wins (see ``resolve_landmarks``), so an
    alias whose landmark is also an OSM stop name is *not* reported as used -
    the report names only the aliases that did work, which is what makes the
    coverage improvement auditable.
    """
    used: List[Dict[str, Any]] = []
    for alias in aliases:
        if alias.landmark not in resolved_landmarks:
            continue
        if normalise_name(alias.landmark) in stop_lookup:
            continue
        used.append(
            {
                "landmark": alias.landmark,
                "osm_stop": alias.osm_stop,
                "stop_name": alias.stop_name,
                "source": alias.source,
                "route_codes": [
                    entry.code
                    for entry in inventory
                    if alias.landmark in entry.stop_landmarks
                ],
            }
        )
    return used


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
