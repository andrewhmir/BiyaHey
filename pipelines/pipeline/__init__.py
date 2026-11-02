"""BiyaHey! data pipeline (Python 3.10 target).

Stages are invoked as ``python -m pipeline.cli <stage>`` from the ``pipelines/``
directory. Task 5 ships the OSM stage only; the GTFS, fares and manifest stages
arrive in later tasks.
"""

from __future__ import annotations

__all__ = ["cli", "osm", "schema"]
