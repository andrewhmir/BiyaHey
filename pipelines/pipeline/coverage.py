"""Coverage report: curated inventory routes vs the routes the feed actually carries.

Why this module exists
---------------------
Spec §3 criterion 7 measures coverage over the curated jeepney / UV Express
inventory: "≥ 60 % of the NCR jeepney/UV routes listed in the OSM Wiki inventory
are modelled (with the missing list published)".

The publish stage already records why each curated route was skipped, but that
report answers "what happened during the build?". Acceptance needs the narrower,
displayable question: **of the routes the inventory publishes, how many have a
route in the built GTFS feed?** :func:`compute_coverage` answers exactly that,
and names every route that did not make it.

Case-insensitive by ruling R29
------------------------------
The curated inventory keeps the published route code's case (``jeep-T101``,
:func:`pipeline.inventory.route_id_for`), but the publish stage lowercases ids in
the feed (``jeep-t101``) so OSM's lowercased slugs and the curated layer can never
enter twice. Comparing raw strings would therefore report 0 % coverage against a
perfectly good feed. Every comparison here is case-folded, and the reported
reason uses the lowercased id the reader should look for in ``routes.txt``.
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Union

from .inventory import InventoryRoute, route_id_for

__all__ = ["compute_coverage", "read_feed_route_ids"]

#: Anything that can stand in for "the routes written to the feed": an iterable
#: of route ids, or a built feed object exposing ``.routes`` (the Task 6
#: :class:`pipeline.gtfs.GtfsFeed`, whose route rows carry ``route_id``).
FeedRouteSource = Union[Iterable[str], Any]


def _route_ids(feed: FeedRouteSource) -> List[str]:
    """Normalise a feed source into a list of route id strings."""
    routes = getattr(feed, "routes", None)
    if routes is not None and not isinstance(feed, (str, bytes)):
        return [str(getattr(route, "route_id", route)) for route in routes]
    if isinstance(feed, (str, bytes)):
        raise TypeError(
            "feed route ids must be an iterable of ids or a GtfsFeed, "
            f"not a single {type(feed).__name__}"
        )
    return [str(route_id) for route_id in feed]


def compute_coverage(
    inventory: Sequence[InventoryRoute], feed_route_ids: FeedRouteSource
) -> Dict[str, Any]:
    """Curated routes modelled in one feed, with the missing list.

    Args:
        inventory: curated routes, e.g. from :func:`pipeline.inventory.load_inventory`.
        feed_route_ids: the ids written to the feed - typically
            ``{route.route_id for route in feed.routes}`` or
            :func:`read_feed_route_ids` - or a built ``GtfsFeed``.

    Returns:
        ``{total, modelled, pct, missing}`` where ``pct`` is a percentage
        rounded to one decimal and ``missing`` lists ``{code, reason}`` in
        inventory order. A route counts as modelled when
        ``route_id_for(route)`` appears in the feed case-insensitively (R29);
        the reason names the lowercased id to look for.

    Raises:
        TypeError: if ``feed_route_ids`` is a bare string.
    """
    routes = list(inventory)
    present = {route_id.strip().casefold() for route_id in _route_ids(feed_route_ids)}

    modelled = 0
    missing: List[Dict[str, str]] = []
    for route in routes:
        route_id = route_id_for(route)
        if route_id.casefold() in present:
            modelled += 1
            continue
        missing.append(
            {
                "code": route.code,
                "reason": f"no GTFS route {route_id.lower()}",
            }
        )

    total = len(routes)
    pct = round(100.0 * modelled / total, 1) if total else 0.0
    return {"total": total, "modelled": modelled, "pct": pct, "missing": missing}


def read_feed_route_ids(gtfs_zip: Union[Path, str]) -> List[str]:
    """Route ids in a built GTFS zip's ``routes.txt``, in file order.

    The zip is the artifact MOTIS reads, so reading it (rather than trusting the
    build report) is what makes the coverage number an acceptance measurement.

    Raises:
        FileNotFoundError: if ``gtfs_zip`` is not a file.
        zipfile.BadZipFile: if the file is not a zip.
        KeyError: if the archive has no ``routes.txt``.
    """
    source = Path(gtfs_zip)
    if not source.is_file():
        raise FileNotFoundError(f"GTFS feed not found: {source}")
    with zipfile.ZipFile(source) as archive:
        text = archive.read("routes.txt").decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return [row["route_id"] for row in reader if row.get("route_id")]
