"""JSON Schema contracts for pipeline artifacts.

Task 5 defines one artifact: the OSM coverage report written by the ``osm``
stage (``data/build/osm/coverage.json``). Every generated artifact under
``data/build/**`` is validated against a schema before it is used, per the
plan's global constraints.

``validate_coverage`` raises ``jsonschema.ValidationError`` (never returns a
bool) so a malformed report cannot silently pass a gate.
"""

from __future__ import annotations

from typing import Any, Mapping

import jsonschema

# Fields and their provenance:
#   exact   — route_relations, by_mode, ptv2_relations, ptv2_tagged_relations,
#             data_until: copied from the taginfo snapshot (a synthesized
#             snapshot of the researched figures for now).
#   derived — ptv2_share: ptv2_relations / ptv2_tagged_relations, rounded to 4 dp.
#   context — bbox, bbox_text, output, extract: added by the osm stage.
COVERAGE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://biyahey.local/schema/coverage.schema.json",
    "title": "OSM coverage report",
    "description": (
        "Coverage of OSM public-transport mapping in the Philippines, as carried by the "
        "pinned taginfo snapshot, plus the context of the NCR bbox extract."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": ["route_relations", "by_mode", "ptv2_share", "data_until"],
    "properties": {
        "route_relations": {
            "type": "integer",
            "minimum": 0,
            "description": "Exact count of type=route relations in the snapshot.",
        },
        "by_mode": {
            "type": "object",
            "description": (
                "Exact route=* value counts. Partial by design: the snapshot lists only the "
                "values the research note reported, so the sum may be below route_relations."
            ),
            "additionalProperties": {"type": "integer", "minimum": 0},
        },
        "ptv2_share": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Derived: ptv2_relations / ptv2_tagged_relations, rounded to 4 dp.",
        },
        "ptv2_relations": {
            "type": "integer",
            "minimum": 0,
            "description": "Exact count of relations tagged public_transport:version=2.",
        },
        "ptv2_tagged_relations": {
            "type": "integer",
            "minimum": 0,
            "description": "Exact count of relations carrying public_transport:version at all.",
        },
        "data_until": {
            "type": "string",
            "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$",
            "description": "Snapshot timestamp from taginfo (UTC, ISO 8601).",
        },
        "coverage_source": {
            "type": "string",
            "minLength": 1,
            "description": "Where the numbers came from; states that it is a snapshot, not a live query.",
        },
        "bbox": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {"type": "number"},
            "description": "NCR bbox as (min_lat, min_lon, max_lat, max_lon).",
        },
        "bbox_text": {
            "type": "string",
            "description": "osmium/GeoJSON bbox text form: lon,lat,lon,lat (ruling R5).",
        },
        "output": {
            "type": "string",
            "minLength": 1,
            "description": "Path of the written NCR extract (build artifact, never committed).",
        },
        "extract": {
            "type": "object",
            "additionalProperties": False,
            "required": ["nodes", "ways", "relations"],
            "description": "Objects written to the NCR extract.",
            "properties": {
                "nodes": {"type": "integer", "minimum": 0},
                "ways": {"type": "integer", "minimum": 0},
                "relations": {"type": "integer", "minimum": 0},
            },
        },
    },
}


def validate_coverage(report: Mapping[str, Any]) -> None:
    """Validate a coverage report against :data:`COVERAGE_SCHEMA`.

    Raises:
        jsonschema.ValidationError: if the report is missing a required field,
            has a wrong type, or carries an unknown field.
    """
    jsonschema.validate(instance=dict(report), schema=COVERAGE_SCHEMA)
