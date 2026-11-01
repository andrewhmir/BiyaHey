"""Command-line entry point: ``python -m pipeline.cli <stage>``.

Stages (run from the ``pipelines/`` directory with the venv interpreter):

* ``download`` — fetch the Geofabrik Philippines extract. Network access; it is
  a separate, explicit action so no build or test ever downloads implicitly.
* ``osm`` — clip an existing extract to the NCR bbox and write
  ``<out>/osm/ncr.osm.pbf`` plus the schema-validated ``<out>/osm/coverage.json``.
  Offline: it only reads local files.

Example (the runbook's sequence)::

    python -m pipeline.cli download --dest data/build/philippines-latest.osm.pbf
    python -m pipeline.cli osm --pbf data/build/philippines-latest.osm.pbf \\
        --out data/build --taginfo tests/fixtures/taginfo_philippines.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from .osm import download_geofabrik, run_stage_osm

#: Default download target, relative to the repository root (data/build is gitignored).
DEFAULT_DOWNLOAD_DEST = Path("data/build/philippines-latest.osm.pbf")


def build_parser() -> argparse.ArgumentParser:
    """Build the argparse parser for all pipeline stages."""
    parser = argparse.ArgumentParser(
        prog="python -m pipeline.cli",
        description="BiyaHey! data pipeline stages (OSM stage in Task 5).",
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
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run one stage. Returns a process exit code (0 ok, 2 missing input)."""
    args = build_parser().parse_args(argv)

    if args.stage == "download":
        destination = download_geofabrik(Path(args.dest))
        print("next: python -m pipeline.cli osm "
              f"--pbf {destination} --out <build-dir> --taginfo <snapshot.json>")
        return 0

    pbf = Path(args.pbf)
    if not pbf.is_file():
        print(f"error: OSM extract not found: {pbf}", file=sys.stderr)
        print(
            "       download it first: "
            f"python -m pipeline.cli download --dest {pbf}",
            file=sys.stderr,
        )
        return 2

    report = run_stage_osm(pbf, Path(args.out), Path(args.taginfo))
    print(f"route_relations: {report['route_relations']}  by_mode: {report['by_mode']}")
    print(
        f"ptv2_share: {report['ptv2_share']}  data_until: {report['data_until']} "
        f"({report['coverage_source']})"
    )
    print(f"coverage report: {Path(args.out) / 'osm' / 'coverage.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
