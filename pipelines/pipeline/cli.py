"""Command-line entry point: ``python -m pipeline.cli <stage>``.

Stages (run from the ``pipelines/`` directory with the venv interpreter):

* ``download`` — fetch the Geofabrik Philippines extract. Network access; it is
  a separate, explicit action so no build or test ever downloads implicitly.
* ``osm`` — clip an existing extract to the NCR bbox and write
  ``<out>/osm/ncr.osm.pbf`` plus the schema-validated ``<out>/osm/coverage.json``.
  Offline: it only reads local files.
* ``publish`` — resolve the curated terminals against the clipped extract (with
  the documented landmark aliases, ruling R34), merge OSM + curated routes,
  build the GTFS feed with fare tables, and write ``<out>/gtfs/gtfs.zip``,
  ``<out>/manifest.json`` and ``<out>/build-report.json``. Offline.
* ``coverage`` — compare the curated inventory with a built feed and print the
  coverage percentage plus the missing routes (spec §3 criterion 7, ruling R29's
  case-insensitive ids). Exits 1 when coverage is below ``--threshold``.
* ``licence-gate`` — check a built ``manifest.json`` (``--manifest``) together
  with the feed it names, or, with no manifest, the committed provenance
  registry (``--sources``): fails on a blocked dataset, a missing ODbL notice,
  or a published feed that lost the CC BY-SA 2.0 inventory attribution. Reads
  local files only, so CI can gate ``data/**`` changes without a build.

Example (the runbook's sequence)::

    python -m pipeline.cli download --dest data/build/philippines-latest.osm.pbf
    python -m pipeline.cli osm --pbf data/build/philippines-latest.osm.pbf \\
        --out data/build --taginfo tests/fixtures/taginfo_philippines.json
    python -m pipeline.cli publish --pbf data/build/osm/ncr.osm.pbf --out data/build
    python -m pipeline.cli coverage --inventory data/routes/jeepney-inventory.yaml \\
        --feed data/build/gtfs/gtfs.zip --threshold 60
    python -m pipeline.cli licence-gate --manifest data/build/manifest.json
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Sequence

from jsonschema import ValidationError

from .coverage import compute_coverage, read_feed_route_ids
from .inventory import load_inventory
from .manifest import (
    BlockedDatasetError,
    LicenceGateError,
    artifact_licence_text,
    carries_wiki_inventory,
    gate_manifest,
    gate_sources,
    load_sources,
)
from .osm import CoverageError, download_geofabrik, run_stage_osm
from .publish import (
    DEFAULT_ALIASES,
    DEFAULT_BUILD_DIR,
    DEFAULT_FARES,
    DEFAULT_INVENTORY,
    DEFAULT_PBF,
    DEFAULT_SOURCES,
    run_stage_publish,
)

#: Default download target, relative to the repository root (data/build is gitignored).
DEFAULT_DOWNLOAD_DEST = Path("data/build/philippines-latest.osm.pbf")


def build_parser() -> argparse.ArgumentParser:
    """Build the argparse parser for all pipeline stages."""
    parser = argparse.ArgumentParser(
        prog="python -m pipeline.cli",
        description="BiyaHey! data pipeline stages (OSM, GTFS publish, licence gate).",
    )
    stages = parser.add_subparsers(dest="stage", required=True)

    download = stages.add_parser(
        "download",
        help="download the pinned Geofabrik Philippines extract (network)",
        description=(
            "Download the Geofabrik Philippines extract to --dest. Network access is "
            "required; the snapshot date is printed so the build is reproducible."
        ),
    )
    download.add_argument(
        "--dest",
        default=str(DEFAULT_DOWNLOAD_DEST),
        help="destination .osm.pbf path (default: %(default)s)",
    )

    osm = stages.add_parser(
        "osm",
        help="clip an extract to the NCR bbox and write the coverage report (offline)",
        description=(
            "Clip an existing Philippines extract to the NCR bbox (ruling R5) and write "
            "coverage.json from the pinned taginfo snapshot. Offline: reads local files only."
        ),
    )
    osm.add_argument(
        "--pbf",
        required=True,
        help="input .osm.pbf (the downloaded Philippines extract)",
    )
    osm.add_argument(
        "--out",
        required=True,
        help="build directory, e.g. data/build (writes <out>/osm/)",
    )
    osm.add_argument(
        "--taginfo",
        required=True,
        help="taginfo snapshot JSON for the coverage report, e.g. tests/fixtures/taginfo_philippines.json",
    )

    publish = stages.add_parser(
        "publish",
        help="build the merged GTFS feed, fares, manifest and build report (offline)",
        description=(
            "Resolve the curated jeepney/UV terminals against the NCR extract, merge "
            "them with the OSM routes (R29/R30), build the GTFS feed with the fare "
            "tables and write gtfs/gtfs.zip, manifest.json and build-report.json. "
            "Offline: reads local files only; fails on a blocked dataset or a lost "
            "ODbL notice."
        ),
    )
    publish.add_argument(
        "--pbf",
        default=str(DEFAULT_PBF),
        help="NCR OSM extract (default: %(default)s)",
    )
    publish.add_argument(
        "--out",
        default=str(DEFAULT_BUILD_DIR),
        help="build directory (default: %(default)s)",
    )
    publish.add_argument(
        "--inventory",
        default=str(DEFAULT_INVENTORY),
        help="curated jeepney/UV inventory YAML (default: %(default)s)",
    )
    publish.add_argument(
        "--fares",
        default=str(DEFAULT_FARES),
        help="hand-curated fare matrix YAML (default: %(default)s)",
    )
    publish.add_argument(
        "--sources",
        default=str(DEFAULT_SOURCES),
        help="provenance registry YAML (default: %(default)s)",
    )
    publish.add_argument(
        "--aliases",
        default=str(DEFAULT_ALIASES),
        help="documented landmark aliases YAML (default: %(default)s)",
    )
    publish.add_argument(
        "--no-aliases",
        action="store_true",
        help="resolve curated landmarks by exact OSM stop name only (ignore --aliases)",
    )
    publish.add_argument(
        "--built-at",
        default=None,
        help="ISO-8601 UTC build timestamp (default: now)",
    )

    coverage = stages.add_parser(
        "coverage",
        help="report curated-inventory coverage of a built GTFS feed (offline)",
        description=(
            "Compare the curated jeepney/UV inventory with the routes in a built "
            "gtfs.zip (ids compared case-insensitively, ruling R29), print the "
            "percentage and the missing list, and exit 1 when coverage is below "
            "--threshold (spec §3 criterion 7). Exit 2 = missing/invalid input."
        ),
    )
    coverage.add_argument(
        "--inventory",
        default=str(DEFAULT_INVENTORY),
        help="curated jeepney/UV inventory YAML (default: %(default)s)",
    )
    coverage.add_argument(
        "--feed",
        default=str(DEFAULT_BUILD_DIR / "gtfs" / "gtfs.zip"),
        help="built GTFS zip to measure (default: %(default)s)",
    )
    coverage.add_argument(
        "--threshold",
        type=float,
        default=60.0,
        help="minimum modelled percentage that passes (default: %(default)s)",
    )
    coverage.add_argument(
        "--json",
        action="store_true",
        help="print the coverage report as JSON instead of a summary",
    )

    licence = stages.add_parser(
        "licence-gate",
        help="fail on a blocked dataset or a missing licence attribution (offline)",
        description=(
            "With --manifest, gate a built manifest and read the GTFS artifact it "
            "names: the feed must state the ODbL notice and, when wiki-derived routes "
            "are present, the CC BY-SA 2.0 inventory attribution. Without --manifest, "
            "gate the committed provenance registry, which needs no data/build "
            "artifacts and is how CI polices data/** changes. "
            "Exit 1 = gate failed, 2 = missing/invalid input."
        ),
    )
    licence.add_argument(
        "--manifest",
        default=None,
        help="built manifest JSON to gate (omit to gate the provenance registry)",
    )
    licence.add_argument(
        "--sources",
        default=str(DEFAULT_SOURCES),
        help="provenance registry for the no-manifest mode (default: %(default)s)",
    )
    return parser


def _one_line(message: object) -> str:
    """Collapse a message onto a single line, whatever the underlying exception prints."""
    return " ".join(str(message).split())


def _fail(message: object) -> int:
    """Print one ``error:`` line to stderr and return the documented input-error code."""
    print(f"error: {_one_line(message)}", file=sys.stderr)
    return 2


def _gate_fail(message: object) -> int:
    """Print one licence-gate failure line and return the documented gate code."""
    print(f"licence-gate: FAIL: {_one_line(message)}", file=sys.stderr)
    return 1


def _run_licence_gate(args: argparse.Namespace) -> int:
    """``licence-gate``: gate a manifest, or the provenance registry when omitted."""
    if args.manifest:
        manifest_path = Path(args.manifest)
        if not manifest_path.is_file():
            return _fail(f"manifest not found: {manifest_path}")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return _fail(
                f"invalid manifest JSON: {manifest_path} "
                f"({exc.msg} at line {exc.lineno} column {exc.colno})"
            )
        try:
            # Manifest mode gates the artifact too: read the feed the manifest
            # names so a published zip that lost an attribution fails here
            # (spec 8.2; ruling R32).
            artifact_text = artifact_licence_text(manifest)
        except (OSError, ValueError) as exc:
            return _fail(f"invalid manifest {manifest_path}: {exc}")
        try:
            gate_manifest(manifest, artifact_text=artifact_text)
        except (BlockedDatasetError, LicenceGateError) as exc:
            return _gate_fail(exc)
        except ValueError as exc:
            return _fail(f"invalid manifest {manifest_path}: {exc}")
        datasets = len(manifest.get("datasets") or [])
        checks = "ODbL-1.0 notice present"
        if artifact_text is not None and carries_wiki_inventory(
            manifest.get("datasets") or []
        ):
            checks += ", CC BY-SA 2.0 inventory attribution present in artifact"
        print(
            f"licence-gate: ok ({datasets} datasets, {checks}, no blocked dataset)"
        )
        return 0

    try:
        sources = load_sources(Path(args.sources))
    except (FileNotFoundError, ValueError) as exc:
        return _fail(exc)
    try:
        gate_sources(sources)
    except (BlockedDatasetError, LicenceGateError) as exc:
        return _gate_fail(exc)
    print(
        f"licence-gate: ok ({len(sources)} registered sources, "
        "ODbL-1.0 notice present, no blocked dataset)"
    )
    return 0


def _run_publish(args: argparse.Namespace) -> int:
    """``publish``: build the merged GTFS feed, manifest and build report."""
    aliases_path = None if args.no_aliases else Path(args.aliases)
    try:
        report = run_stage_publish(
            Path(args.pbf),
            Path(args.out),
            Path(args.inventory),
            Path(args.fares),
            Path(args.sources),
            aliases_path,
            built_at=args.built_at,
        )
    except (BlockedDatasetError, LicenceGateError) as exc:
        return _gate_fail(exc)
    except (FileNotFoundError, ValueError) as exc:
        return _fail(exc)

    feed = report["feed"]
    print(
        f"publish: {feed['routes']} routes, {feed['trips']} trips, "
        f"{feed['stops']} stops"
    )
    print(
        f"curated: {report['curated_routes_modelled']}/"
        f"{report['curated_routes_total']} modelled, "
        f"{len(report['curated_routes_skipped'])} skipped, "
        f"{len(report['landmark_unresolved'])} unresolved landmarks"
    )
    coverage = report["coverage"]
    print(
        f"coverage: {coverage['modelled']}/{coverage['total']} curated routes in the "
        f"feed ({coverage['pct']:.1f}%)"
    )
    aliases = report["landmark_aliases"]
    print(
        f"aliases: {len(aliases['used'])} used, "
        f"{len(aliases['invalid'])} invalid ({aliases['path'] or 'disabled'})"
    )
    fares = report["fare_tables"]
    print(
        f"fare tables: {fares['fare_attributes_rows']} fares, "
        f"{fares['fare_rules_rows']} route rules, "
        f"{len(fares['unrepresentable'])} unrepresentable"
    )
    print(f"gtfs: {feed['path']}")
    print(f"manifest: {report['manifest_path']} (sha256 {feed['sha256']})")
    print(f"report: {report['report_path']}")
    print(
        "licence gate: ok (blocked datasets checked, ODbL-1.0 and "
        "CC BY-SA 2.0 notices present in artifact)"
    )
    return 0


def _run_coverage(args: argparse.Namespace) -> int:
    """``coverage``: curated inventory vs a built feed, with a pass threshold."""
    try:
        inventory = load_inventory(Path(args.inventory))
        feed_ids = read_feed_route_ids(Path(args.feed))
    except (FileNotFoundError, ValueError, zipfile.BadZipFile, KeyError) as exc:
        return _fail(exc)

    report = compute_coverage(inventory, feed_ids)
    passed = report["pct"] >= args.threshold
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if passed else 1

    print(
        f"coverage: {report['modelled']}/{report['total']} curated routes modelled "
        f"({report['pct']:.1f}%)"
    )
    for entry in report["missing"]:
        print(f"missing: {entry['code']} ({entry['reason']})")
    print(
        f"threshold: {args.threshold:.1f}% -> {'PASS' if passed else 'FAIL'}"
    )
    return 0 if passed else 1


def main(argv: Sequence[str] | None = None) -> int:
    """Run one stage. Returns a process exit code (0 ok, 1 gate failed, 2 bad input)."""
    args = build_parser().parse_args(argv)

    if args.stage == "licence-gate":
        return _run_licence_gate(args)
    if args.stage == "publish":
        return _run_publish(args)
    if args.stage == "coverage":
        return _run_coverage(args)
    if args.stage == "download":
        destination = download_geofabrik(Path(args.dest))
        print("next: python -m pipeline.cli osm "
              f"--pbf {destination} --out <build-dir> --taginfo <snapshot.json>")
        return 0

    pbf = Path(args.pbf)
    if not pbf.is_file():
        return _fail(
            f"OSM extract not found: {pbf} "
            f"(download it first: python -m pipeline.cli download --dest {pbf})"
        )

    # Documented contract (runbook §1.2): every missing or invalid input returns
    # exit code 2 with a one-line stderr message, never a traceback. run_stage_osm
    # validates the taginfo snapshot before clipping, so a bad snapshot never
    # leaves a partial build directory behind.
    try:
        report = run_stage_osm(pbf, Path(args.out), Path(args.taginfo))
    except json.JSONDecodeError as exc:
        return _fail(
            f"invalid taginfo JSON: {args.taginfo} "
            f"({exc.msg} at line {exc.lineno} column {exc.colno})"
        )
    except CoverageError as exc:
        return _fail(f"invalid taginfo snapshot: {args.taginfo} ({exc})")
    except ValidationError as exc:
        return _fail(
            f"taginfo snapshot fails the coverage schema: {args.taginfo} "
            f"({exc.message} at {exc.json_path})"
        )
    except FileNotFoundError as exc:
        return _fail(exc)

    print(f"route_relations: {report['route_relations']}  by_mode: {report['by_mode']}")
    print(
        f"ptv2_share: {report['ptv2_share']}  data_until: {report['data_until']} "
        f"({report['coverage_source']})"
    )
    print(f"coverage report: {Path(args.out) / 'osm' / 'coverage.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
