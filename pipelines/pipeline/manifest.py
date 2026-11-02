"""Provenance manifest and licence gate (Task 8, spec 8.1/8.2 stage 05, ruling R22).

Purpose
-------
Every published build ships a machine-readable manifest that answers "what data
did this come from, under which licence, and what was the exact file we
shipped?". It is the build-time counterpart of the API's ``sources[]`` array and
it is what the licence gate checks before anything is published.

Manifest shape
--------------
::

    {
      "built_at":  "<ISO-8601 UTC>",
      "engine":    {"name": "motis", "version": "v2.11.4"},
      "datasets":  [{"id", "path", "sha256", "licence_spdx"}, ...],
      "attributions": ["<required attribution text>", ...]
    }

``datasets`` records what the build used *and* what it produced:

* a source that declares a local ``path`` in its provenance metadata becomes a
  dataset with that file's sha256 (the OSM extract, the wiki inventory, the fare
  matrix);
* each ``artifact`` (the generated ``gtfs.zip``) becomes a dataset whose id is
  its file stem and whose licence is the licence of the source that licenses it.
  Binding is explicit (``"artifact": "gtfs.zip"`` on the source), then by id/stem
  match, then - for a single-source manifest - the only source. The generated
  feed is a derived database of ODbL content, so the OSM source licenses it.

``attributions`` lists every used source's attribution string in registry order
(ruling R6's ordering convention), deduplicated.

Two gates, both enforced here
-----------------------------
``assert_no_blocked_dataset``
    Sakay/PTAC 2014 GTFS, BusMaps and any feed without a reuse grant are
    internal-exploration only and must never be shipped (spec 8.1; see
    ``data/provenance/PROVENANCE_NOTES.md``). ``BLOCKED_DATASET_IDS`` is the
    canonical list; ids are compared case- and punctuation-insensitively so
    ``BusMaps``, ``bus_maps`` and ``busmaps`` are all refused.
``assert_licence_notice``
    A published manifest must carry an ``ODbL-1.0`` dataset *and* the exact spec
    Appendix A OpenStreetMap attribution. When it also lists the CC BY-SA 2.0
    wiki inventory (``osm-wiki-jeepney``), the manifest attributions *and* the
    published ``gtfs.zip`` must state the exact inventory attribution (spec 8.2;
    ruling R32).

``build_manifest`` refuses to build from a blocked source at all, so a blocked
dataset cannot even reach the manifest-writing code path.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import yaml

from .gtfs import ODBL_ATTRIBUTION, WIKI_INVENTORY_ATTRIBUTION, read_licence_text

__all__ = [
    "BLOCKED_DATASET_IDS",
    "BLOCKED_DATASET_REASON",
    "ENGINE",
    "BlockedDatasetError",
    "LicenceGateError",
    "WIKI_INVENTORY_DATASET_ID",
    "WIKI_INVENTORY_LICENCE_SPDX",
    "artifact_licence_text",
    "assert_licence_notice",
    "assert_no_blocked_dataset",
    "build_manifest",
    "carries_wiki_inventory",
    "gate_manifest",
    "gate_sources",
    "load_sources",
    "sha256_file",
]

#: Pinned routing engine of the v1 stack (plan Task 9 / spec 9).
ENGINE: Dict[str, str] = {"name": "motis", "version": "v2.11.4"}

#: Datasets that are internal-exploration only and must never be shipped
#: (spec 8.1 "Never shipped"; data/provenance/PROVENANCE_NOTES.md).
BLOCKED_DATASET_IDS = frozenset({"sakay-gtfs", "ptac-2014", "busmaps"})

BLOCKED_DATASET_REASON = (
    "Sakay/PTAC 2014 GTFS, BusMaps and any feed without a reuse grant are "
    "internal-exploration only and must never be shipped "
    "(spec 8.1; data/provenance/PROVENANCE_NOTES.md)"
)

#: Comparison key for blocked ids: lowercase alphanumerics only, so ``BusMaps``,
#: ``bus_maps``, ``bus-maps`` and ``busmaps`` are the same dataset.
_SQUASH = re.compile(r"[^a-z0-9]+")
_BLOCKED_KEYS = frozenset(_SQUASH.sub("", blocked) for blocked in BLOCKED_DATASET_IDS)

#: Registry id and SPDX licence of the wiki-derived route inventory (spec 8.1).
#: A published feed that lists either one must state its CC BY-SA 2.0
#: attribution inside the artifact (spec 8.2; ruling R32).
WIKI_INVENTORY_DATASET_ID = "osm-wiki-jeepney"
WIKI_INVENTORY_LICENCE_SPDX = "CC-BY-SA-2.0"
_WIKI_INVENTORY_KEY = _SQUASH.sub("", WIKI_INVENTORY_DATASET_ID)


class BlockedDatasetError(RuntimeError):
    """The manifest names a dataset that must never be published."""


class LicenceGateError(RuntimeError):
    """The manifest is missing the ODbL licence or the required attribution."""


def sha256_file(path: Path) -> str:
    """SHA-256 of a file, read in chunks (the OSM extract is hundreds of MB)."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(
    artifacts: Sequence[Path],
    sources: Mapping[str, Mapping[str, Any]],
    built_at: str,
) -> Dict[str, Any]:
    """Build the provenance manifest for one publish run.

    Args:
        artifacts: files produced by the build (the GTFS zip). Each is hashed and
            recorded as a dataset licensed by the source bound to it.
        sources: dataset id -> provenance metadata. Required keys: ``licence_spdx``
            (non-empty). Optional: ``attribution`` (recorded in ``attributions``),
            ``path`` (a local input file to hash as its own dataset), ``artifact``
            (name of the build artifact this source licenses). Entries are kept
            in mapping order.
        built_at: ISO-8601 UTC build timestamp, recorded verbatim.

    Returns:
        ``{built_at, engine, datasets, attributions}``.

    Raises:
        ValueError: if ``built_at`` is empty, ``sources`` is empty or a source
            has no ``licence_spdx``, an artifact cannot be attributed to a
            source, or two datasets would share an id.
        FileNotFoundError: if an artifact or a source ``path`` does not exist.
        BlockedDatasetError: if any source id is a blocked dataset.
    """
    if not isinstance(built_at, str) or not built_at.strip():
        raise ValueError("built_at must be a non-empty ISO-8601 timestamp string")
    if not isinstance(sources, Mapping) or not sources:
        raise ValueError(
            "sources must be a non-empty mapping of dataset id -> provenance metadata"
        )

    validated: Dict[str, Mapping[str, Any]] = {}
    for source_id, metadata in sources.items():
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError("source ids must be non-empty strings")
        if not isinstance(metadata, Mapping):
            raise ValueError(f"source {source_id!r}: provenance metadata must be a mapping")
        source_id = source_id.strip()
        _licence_for(metadata, source_id)  # fail before writing anything
        validated[source_id] = metadata

    # Defence in depth: a blocked dataset can never reach a written manifest.
    assert_no_blocked_dataset(
        {"datasets": [{"id": source_id} for source_id in validated]}
    )

    datasets: List[Dict[str, str]] = []
    dataset_ids: set = set()

    def add_dataset(entry: Dict[str, str]) -> None:
        if entry["id"] in dataset_ids:
            raise ValueError(f"duplicate dataset id in manifest: {entry['id']!r}")
        dataset_ids.add(entry["id"])
        datasets.append(entry)

    # Inputs that the build actually read (recorded with their own hashes).
    for source_id, metadata in validated.items():
        if metadata.get("path") is None:
            continue
        path = Path(str(metadata["path"]))
        add_dataset(
            {
                "id": source_id,
                "path": _posix(path),
                "sha256": sha256_file(path),
                "licence_spdx": _licence_for(metadata, source_id),
            }
        )

    for artifact in artifacts:
        path = Path(artifact)
        if not path.is_file():
            raise FileNotFoundError(f"manifest artifact not found: {path}")
        source_id = _source_for_artifact(path, validated)
        add_dataset(
            {
                "id": path.stem,
                "path": _posix(path),
                "sha256": sha256_file(path),
                "licence_spdx": _licence_for(validated[source_id], source_id),
            }
        )

    if not datasets:
        raise ValueError(
            "manifest would have no datasets: pass at least one artifact or give "
            "a source a local 'path'"
        )

    attributions: List[str] = []
    for metadata in validated.values():
        attribution = str(metadata.get("attribution") or "").strip()
        if attribution and attribution not in attributions:
            attributions.append(attribution)

    return {
        "built_at": built_at.strip(),
        "engine": dict(ENGINE),
        "datasets": datasets,
        "attributions": attributions,
    }


def assert_no_blocked_dataset(manifest: Mapping[str, Any]) -> None:
    """Raise :class:`BlockedDatasetError` if any dataset id is blocked.

    Args:
        manifest: a manifest mapping with a ``datasets`` list (each entry a
            mapping with an ``id``).

    Raises:
        ValueError: if the object is not a manifest with a ``datasets`` list.
        BlockedDatasetError: naming every blocked id found.
    """
    if not isinstance(manifest, Mapping):
        raise ValueError("manifest must be a mapping with a 'datasets' list")
    datasets = manifest.get("datasets")
    if not isinstance(datasets, list):
        raise ValueError("manifest has no 'datasets' list")

    blocked: List[str] = []
    for dataset in datasets:
        if not isinstance(dataset, Mapping):
            raise ValueError(f"manifest dataset entry must be a mapping, got {dataset!r}")
        identifier = str(dataset.get("id") or "")
        if _SQUASH.sub("", identifier.casefold()) in _BLOCKED_KEYS:
            blocked.append(identifier)
    if blocked:
        listed = ", ".join(sorted(set(blocked)))
        raise BlockedDatasetError(
            f"blocked dataset id(s) in the manifest: {listed} - {BLOCKED_DATASET_REASON}"
        )


def carries_wiki_inventory(datasets: Sequence[Mapping[str, Any]]) -> bool:
    """True when the manifest/registry lists the CC BY-SA 2.0 wiki inventory.

    A published build that used ``data/routes/jeepney-inventory.yaml`` lists
    ``osm-wiki-jeepney`` (``CC-BY-SA-2.0``) among its datasets, which means the
    feed may contain routes derived from that file and must state its
    attribution (spec 8.2; ruling R32). Detection is by SPDX licence or by the
    registry id, so neither a renamed id nor a missing licence can skip the
    check.
    """
    for dataset in datasets:
        if not isinstance(dataset, Mapping):
            continue
        if dataset.get("licence_spdx") == WIKI_INVENTORY_LICENCE_SPDX:
            return True
        dataset_id = _SQUASH.sub("", str(dataset.get("id") or "").casefold())
        if dataset_id == _WIKI_INVENTORY_KEY:
            return True
    return False


def artifact_licence_text(manifest: Mapping[str, Any]) -> Optional[str]:
    """Read the licence/attribution text from the GTFS artifacts a manifest names.

    This is the manifest-mode input to :func:`assert_licence_notice`: every
    dataset path ending in ``.zip`` is opened and its ``LICENSE-DATA.txt`` /
    ``attributions.txt`` read. Registry-mode gating has no artifacts and gets
    ``None``.

    Raises:
        FileNotFoundError: a named artifact does not exist.
        ValueError: an artifact is not a readable zip or has no licence table.
    """
    datasets = manifest.get("datasets")
    if not isinstance(datasets, list):
        return None
    texts: List[str] = []
    for dataset in datasets:
        if not isinstance(dataset, Mapping):
            continue
        raw_path = dataset.get("path")
        if not isinstance(raw_path, str) or not raw_path.lower().endswith(".zip"):
            continue
        texts.append(read_licence_text(Path(raw_path)))
    return "\n".join(texts) if texts else None


def assert_licence_notice(
    datasets: Sequence[Mapping[str, Any]],
    attributions: Sequence[Any],
    *,
    artifact_text: Optional[str] = None,
) -> None:
    """Require the ODbL notice and, when applicable, the CC BY-SA 2.0 notice.

    Args:
        datasets: manifest dataset entries (``licence_spdx`` and ``id`` are read).
        attributions: attribution strings; one must contain the exact
            :data:`pipeline.gtfs.ODBL_ATTRIBUTION` text.
        artifact_text: licence/attribution text read from the published feed zip
            (see :func:`artifact_licence_text`). When a wiki-derived
            (``CC-BY-SA-2.0``) dataset is listed, this text must also contain
            :data:`pipeline.gtfs.WIKI_INVENTORY_ATTRIBUTION`. ``None`` means no
            artifact was supplied (registry-mode gating), so only the manifest
            attributions are checked.

    Raises:
        ValueError: if the inputs are not sequences of mappings/strings.
        LicenceGateError: if no ODbL-1.0 licence, a required attribution notice
            is missing, or the published artifact lost the CC BY-SA
            attribution.
    """
    if isinstance(datasets, (str, bytes)) or not isinstance(datasets, Sequence):
        raise ValueError("datasets must be a sequence of manifest dataset mappings")
    if isinstance(attributions, (str, bytes)) or not isinstance(attributions, Sequence):
        raise ValueError("attributions must be a sequence of strings")

    licences = set()
    for dataset in datasets:
        if not isinstance(dataset, Mapping):
            raise ValueError(f"manifest dataset entry must be a mapping, got {dataset!r}")
        licence = dataset.get("licence_spdx")
        if isinstance(licence, str) and licence.strip():
            licences.add(licence.strip())
    if "ODbL-1.0" not in licences:
        raise LicenceGateError(
            "licence gate: no published dataset is licensed ODbL-1.0; the "
            "generated GTFS is a derived database of ODbL content and must be "
            "published under ODbL 1.0 (spec 8.2)"
        )

    texts = [str(attribution) for attribution in attributions]
    if not any(ODBL_ATTRIBUTION in text for text in texts):
        raise LicenceGateError(
            "licence gate: the ODbL notice is missing from the manifest "
            f"attributions; expected exactly: {ODBL_ATTRIBUTION!r}"
        )

    if not carries_wiki_inventory(datasets):
        return
    if not any(WIKI_INVENTORY_ATTRIBUTION in text for text in texts):
        raise LicenceGateError(
            "licence gate: the CC BY-SA 2.0 attribution for the wiki-derived "
            "route inventory is missing from the manifest attributions; "
            f"expected exactly: {WIKI_INVENTORY_ATTRIBUTION!r}"
        )
    if artifact_text is not None and WIKI_INVENTORY_ATTRIBUTION not in artifact_text:
        raise LicenceGateError(
            "licence gate: the published GTFS artifact does not state the "
            "CC BY-SA 2.0 attribution for its wiki-derived route inventory; "
            f"expected exactly: {WIKI_INVENTORY_ATTRIBUTION!r} inside the "
            "feed's LICENSE-DATA.txt (spec 8.2; ruling R32)"
        )


def gate_manifest(
    manifest: Mapping[str, Any], *, artifact_text: Optional[str] = None
) -> None:
    """Run both licence gates over a built manifest.

    Args:
        manifest: the manifest mapping.
        artifact_text: licence/attribution text read from the published feed
            (``artifact_licence_text(manifest)``); ``None`` skips the
            artifact-content check (registry-style callers).

    Raises:
        BlockedDatasetError: a blocked dataset is named.
        LicenceGateError: the ODbL licence/attribution, or the CC BY-SA 2.0
            inventory attribution inside the artifact, is missing.
        ValueError: the manifest is malformed.
    """
    assert_no_blocked_dataset(manifest)
    assert_licence_notice(
        manifest.get("datasets", []),
        manifest.get("attributions", []),
        artifact_text=artifact_text,
    )


def gate_sources(sources: Mapping[str, Mapping[str, Any]]) -> None:
    """Run both licence gates over a provenance registry (no build needed).

    This is the CI mode of the licence gate: it proves the *committed register*
    contains no blocked dataset and still carries the ODbL notice, without
    needing ``data/build/`` artifacts (which are gitignored).

    Raises:
        BlockedDatasetError: a blocked source id is registered.
        LicenceGateError: no registered source is ODbL-1.0 or the notice is gone.
    """
    assert_no_blocked_dataset(
        {"datasets": [{"id": source_id} for source_id in sources]}
    )
    assert_licence_notice(
        [
            {"id": source_id, "licence_spdx": metadata.get("licence_spdx")}
            for source_id, metadata in sources.items()
        ],
        [metadata.get("attribution", "") for metadata in sources.values()],
    )


def load_sources(path: Path) -> Dict[str, Dict[str, Any]]:
    """Read the provenance registry as an ordered ``id -> metadata`` mapping.

    Structural validation only (ids unique, every source has a ``licence_spdx``
    and an ``attribution``). The full draft-07 schema check of the committed
    registry stays in ``npm run validate:data`` (ruling R24); duplicating it here
    would make the Python gate reject scratch registries used by tests.

    Args:
        path: the registry YAML (``data/provenance/sources.yaml``).

    Returns:
        Datasets in registry (row) order, which is also attribution order (R6).

    Raises:
        FileNotFoundError: if the file does not exist.
        ValueError: if the YAML is unreadable or an entry is malformed.
    """
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"provenance registry not found: {source}")
    try:
        document = yaml.safe_load(source.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{source}: not valid YAML: {exc}") from exc

    if not isinstance(document, Mapping):
        raise ValueError(f"{source}: provenance registry must be a mapping")
    entries = document.get("sources")
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"{source}: 'sources' must be a non-empty list")

    sources: Dict[str, Dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            raise ValueError(f"{source}: sources[{index}] must be a mapping")
        source_id = entry.get("id")
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError(f"{source}: sources[{index}].id must be a non-empty string")
        source_id = source_id.strip()
        if source_id in sources:
            raise ValueError(f"{source}: duplicate source id {source_id!r}")
        licence = entry.get("licence_spdx")
        if not isinstance(licence, str) or not licence.strip():
            raise ValueError(f"{source}: source {source_id!r} has no licence_spdx")
        sources[source_id] = dict(entry)
    return sources


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _licence_for(metadata: Mapping[str, Any], source_id: str) -> str:
    """The source's SPDX licence id, or a ValueError naming the source."""
    licence = metadata.get("licence_spdx")
    if not isinstance(licence, str) or not licence.strip():
        raise ValueError(
            f"source {source_id!r}: licence_spdx is required to publish a "
            "manifest entry (spec 8.1: every dataset has a licence)"
        )
    return licence.strip()


def _source_for_artifact(
    artifact: Path, sources: Mapping[str, Mapping[str, Any]]
) -> str:
    """Resolve which source licenses an artifact (explicit, stem, or sole source)."""
    for source_id, metadata in sources.items():
        bound = metadata.get("artifact")
        candidates: List[str] = []
        if isinstance(bound, str):
            candidates = [bound]
        elif isinstance(bound, (list, tuple)):
            candidates = [str(item) for item in bound]
        if any(
            candidate == artifact.name or Path(candidate).name == artifact.name
            for candidate in candidates
        ):
            return source_id

    stem = _SQUASH.sub("", artifact.stem.casefold())
    for source_id in sources:
        if _SQUASH.sub("", source_id.casefold()) == stem:
            return source_id

    if len(sources) == 1:
        return next(iter(sources))

    raise ValueError(
        f"cannot attribute artifact {artifact.name!r} to a source; add "
        f'"artifact": {artifact.name!r} to its provenance metadata or use a '
        f"source id matching the file stem (sources: {sorted(sources)})"
    )


def _posix(path: Path) -> str:
    """A manifest path in POSIX form so it is stable across Windows/CI."""
    return Path(path).as_posix()
