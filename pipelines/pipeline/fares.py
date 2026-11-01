"""Fare matrix -> GTFS ``fare_attributes.txt`` / ``fare_rules.txt`` (Task 8).

Source of truth
---------------
``data/fares/fares-2026-09-28.yaml`` is the hand-curated LTFRB/MMDA matrix
(spec 8.3). The BFF computes the displayed fare from that matrix
(``packages/shared/src/fares.ts``); the GTFS fare tables generated here are
*best effort for engine-level filtering* (spec 8.2 stage 03), not a second
pricing implementation.

What GTFS can and cannot express
--------------------------------
``fare_attributes.txt`` has one flat ``price`` column per fare. The matrix has
three shapes of row:

* ``fare: <amount>``            -> a flat fare (Pasig River Ferry is free: 0);
* ``base_fare: <amount>``       -> the minimum trip fare; the matrix adds
  ``per_km`` beyond ``base_km``, which GTFS cannot represent, so the flat
  boarding fare is emitted (and the matrix remains the authority for the rest);
* ``per_km`` only, or
  ``multiplier`` only           -> **no flat amount exists**. UV Express is
  priced purely per kilometre and P2P is a multiplier on the route fare. Such
  rows are deliberately *not* invented as flat GTFS prices; they are reported by
  :func:`unrepresentable_fares` for the build report instead. The BFF prices
  them from the matrix.

Route binding
-------------
``fare_rules.txt`` binds a fare to actual GTFS route ids. The route families
the feed uses are namespaced by ``pipeline.osm_routes`` / ``pipeline.inventory``
(``jeep-``, ``bus-``, ``uv-``, ``rail-``, ``ferry-``). Only families whose class
is unambiguous and flat-representable get a rule:

============  =========================  =====================
route prefix  matrix row                 why
============  =========================  =====================
``jeep``      ``jeepney-traditional``    feed carries no class; traditional is
                                         the LTFRB default
``bus``       ``city-bus-ordinary``      the feed's ``bus-`` routes are NCR city
                                         buses; ordinary is the default class
``ferry``     ``ferry-pasig-river``      fixed (free) fare
``uv``        (none)                     per-kilometre pricing
``rail``      (none)                     rail fares live in
                                         ``data/fares/rail-tables.yaml``
============  =========================  =====================

Without a ``route_ids`` argument the fare attributes are still emitted and
``fare_rules.txt`` contains only its header; the publish stage always passes the
route ids of the feed it just built.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

__all__ = [
    "DEFAULT_CLASS_BY_ROUTE_PREFIX",
    "FARE_ATTRIBUTES_FILENAME",
    "FARE_ATTRIBUTE_COLUMNS",
    "FARE_RULE_COLUMNS",
    "FARE_RULES_FILENAME",
    "FareRow",
    "FareRule",
    "attribute_rows",
    "build_gtfs_fare_tables",
    "rule_rows",
    "unrepresentable_fares",
]

FARE_ATTRIBUTES_FILENAME = "fare_attributes.txt"
FARE_RULES_FILENAME = "fare_rules.txt"

FARE_ATTRIBUTE_COLUMNS: Tuple[str, ...] = (
    "fare_id",
    "price",
    "currency_type",
    "payment_method",
    "transfers",
    "agency_id",
)
FARE_RULE_COLUMNS: Tuple[str, ...] = (
    "fare_id",
    "route_id",
    "origin_id",
    "destination_id",
    "contains_id",
)

#: Route-id prefix -> (matrix mode, default class) for flat-representable fares.
#: ``uv`` and ``rail`` are deliberately absent: see the module docstring.
DEFAULT_CLASS_BY_ROUTE_PREFIX: Dict[str, Tuple[str, str]] = {
    "jeep": ("jeepney", "traditional"),
    "bus": ("city-bus", "ordinary"),
    "ferry": ("ferry", "pasig-river"),
}

#: GTFS constant: fare is paid on board.
PAYMENT_METHOD_ON_BOARD = 0
#: A generated single-leg fare permits no free transfers.
NO_TRANSFERS = 0

_CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True)
class FareRow:
    """One ``fare_attributes.txt`` row (a flat fare only)."""

    fare_id: str
    mode: str
    fare_class: str
    price: Decimal
    currency_type: str


@dataclass(frozen=True)
class FareRule:
    """One ``fare_rules.txt`` row: a flat fare bound to a feed route id."""

    fare_id: str
    route_id: str


def fare_id_for(mode: str, fare_class: str) -> str:
    """The stable GTFS ``fare_id`` for a matrix row: ``jeepney-traditional``."""
    return f"{mode}-{fare_class}"


def attribute_rows(fares_yaml: Mapping[str, Any]) -> List[FareRow]:
    """Flat-representable fare rows, in matrix order.

    Args:
        fares_yaml: the parsed ``data/fares/*.yaml`` document.

    Returns:
        One :class:`FareRow` per matrix row that has a flat amount
        (``fare`` or ``base_fare``). Distance-only and multiplier rows are
        omitted; see :func:`unrepresentable_fares`.

    Raises:
        ValueError: if the document is not a fare matrix, the currency is not a
            three-letter ISO code, a row lacks ``mode``/``class``, a price is
            not a finite non-negative number, or a mode/class pair repeats.
    """
    currency, entries = _validated_entries(fares_yaml)
    rows: List[FareRow] = []
    for mode, fare_class, entry in entries:
        price = _flat_price(mode, fare_class, entry)
        if price is None:
            continue
        rows.append(
            FareRow(
                fare_id=fare_id_for(mode, fare_class),
                mode=mode,
                fare_class=fare_class,
                price=price,
                currency_type=currency,
            )
        )
    if not rows:
        raise ValueError(
            "fare matrix contains no flat fare that GTFS fare_attributes can "
            "represent (every row is per-km or multiplier based)"
        )
    return rows


def unrepresentable_fares(fares_yaml: Mapping[str, Any]) -> List[Dict[str, str]]:
    """Matrix rows that cannot become a flat GTFS fare, with the honest reason.

    Returns:
        ``[{"fare_id", "mode", "class", "reason"}]`` in matrix order. The
        publish build report carries this list so a reader can see that UV
        Express / P2P were excluded on purpose, not forgotten.
    """
    _, entries = _validated_entries(fares_yaml)
    unrepresentable: List[Dict[str, str]] = []
    for mode, fare_class, entry in entries:
        if _flat_price(mode, fare_class, entry) is not None:
            continue
        if "per_km" in entry:
            reason = (
                f"distance-based fare (per_km {entry['per_km']}) has no flat "
                "GTFS price; the BFF computes it from the matrix"
            )
        elif "multiplier" in entry:
            reason = (
                f"multiplier-based fare (x{entry['multiplier']}) is relative to "
                "a route fare and has no flat GTFS price"
            )
        else:
            reason = (
                "row has no fare, base_fare, per_km or multiplier, so there is "
                "nothing GTFS can price"
            )
        unrepresentable.append(
            {
                "fare_id": fare_id_for(mode, fare_class),
                "mode": mode,
                "class": fare_class,
                "reason": reason,
            }
        )
    return unrepresentable


def rule_rows(
    rows: Sequence[FareRow], route_ids: Iterable[str]
) -> List[FareRule]:
    """Bind flat fares to the route families they apply to.

    Args:
        rows: output of :func:`attribute_rows`.
        route_ids: GTFS route ids from the built feed, in feed order. Unknown
            families (``rail-``) and families with no flat fare (``uv-``) are
            skipped; a repeated route id yields one rule.

    Returns:
        One :class:`FareRule` per matched route id, in ``route_ids`` order.
    """
    by_mode_class = {(row.mode, row.fare_class): row for row in rows}
    rules: List[FareRule] = []
    seen: set = set()
    for route_id in route_ids:
        if not isinstance(route_id, str):
            raise ValueError(f"route id must be a string, got {route_id!r}")
        route_id = route_id.strip()
        if not route_id or route_id in seen:
            continue
        family = route_id.split("-", 1)[0].lower()
        target = DEFAULT_CLASS_BY_ROUTE_PREFIX.get(family)
        if target is None:
            continue
        row = by_mode_class.get(target)
        if row is None:
            continue
        seen.add(route_id)
        rules.append(FareRule(fare_id=row.fare_id, route_id=route_id))
    return rules


def build_gtfs_fare_tables(
    fares_yaml: Mapping[str, Any], route_ids: Iterable[str] = ()
) -> Dict[str, str]:
    """Render the GTFS fare tables as CSV text.

    Args:
        fares_yaml: the parsed fare matrix document.
        route_ids: route ids of the generated feed used to write
            ``fare_rules.txt``. Optional so the fare attributes can be built on
            their own; without it the rules table is a header only.

    Returns:
        ``{"fare_attributes.txt": <csv text>, "fare_rules.txt": <csv text>}``.
        Prices are formatted with exactly two decimals. The text is UTF-8
        without a BOM; :meth:`pipeline.gtfs.GtfsFeed.write` adds the BOM when it
        writes the zip, exactly like the core tables.
    """
    rows = attribute_rows(fares_yaml)
    rules = rule_rows(rows, route_ids)

    attributes = _render(
        FARE_ATTRIBUTE_COLUMNS,
        [
            (
                row.fare_id,
                f"{row.price:.2f}",
                row.currency_type,
                PAYMENT_METHOD_ON_BOARD,
                NO_TRANSFERS,
                "",
            )
            for row in rows
        ],
    )
    rule_rows_text = _render(
        FARE_RULE_COLUMNS,
        [(rule.fare_id, rule.route_id, "", "", "") for rule in rules],
    )
    return {
        FARE_ATTRIBUTES_FILENAME: attributes,
        FARE_RULES_FILENAME: rule_rows_text,
    }


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _validated_entries(
    fares_yaml: Mapping[str, Any],
) -> Tuple[str, List[Tuple[str, str, Mapping[str, Any]]]]:
    """Validate the matrix envelope and return (currency, [(mode, class, row)])."""
    if not isinstance(fares_yaml, Mapping):
        raise ValueError("fare matrix must be a mapping with 'currency' and 'fares'")

    entries = fares_yaml.get("fares")
    if not isinstance(entries, list) or not entries:
        raise ValueError("fare matrix must contain a non-empty 'fares' list")

    currency = fares_yaml.get("currency")
    if not isinstance(currency, str) or not _CURRENCY_PATTERN.match(currency.strip()):
        raise ValueError(
            f"fare matrix currency must be a 3-letter ISO 4217 code, got {currency!r}"
        )
    currency = currency.strip()

    validated: List[Tuple[str, str, Mapping[str, Any]]] = []
    seen: set = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            raise ValueError(f"fares[{index}] must be a mapping")
        mode = entry.get("mode")
        fare_class = entry.get("class")
        if not isinstance(mode, str) or not mode.strip():
            raise ValueError(f"fares[{index}].mode must be a non-empty string")
        if not isinstance(fare_class, str) or not fare_class.strip():
            raise ValueError(f"fares[{index}].class must be a non-empty string")
        mode = mode.strip()
        fare_class = fare_class.strip()
        if (mode, fare_class) in seen:
            raise ValueError(
                f"duplicate fare row for mode {mode!r} class {fare_class!r}"
            )
        seen.add((mode, fare_class))
        validated.append((mode, fare_class, entry))
    return currency, validated


def _flat_price(
    mode: str, fare_class: str, entry: Mapping[str, Any]
) -> Optional[Decimal]:
    """The flat GTFS price for a matrix row, or ``None`` when it has none."""
    if "fare" in entry:
        return _decimal_price(entry["fare"], mode, fare_class, "fare")
    if "base_fare" in entry:
        return _decimal_price(entry["base_fare"], mode, fare_class, "base_fare")
    return None


def _decimal_price(
    value: Any, mode: str, fare_class: str, field_name: str
) -> Decimal:
    try:
        price = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(
            f"fare {mode}/{fare_class}: {field_name} is not a number: {value!r}"
        ) from exc
    if not price.is_finite():
        raise ValueError(
            f"fare {mode}/{fare_class}: {field_name} must be finite, got {value!r}"
        )
    if price < 0:
        raise ValueError(
            f"fare {mode}/{fare_class}: {field_name} must not be negative, got {value!r}"
        )
    return price


def _render(columns: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
    """Render a GTFS table as CSV text (``\\n`` line endings, no BOM)."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()
