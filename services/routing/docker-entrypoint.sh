#!/bin/sh
# MOTIS entrypoint: import/verify the graph, then serve it.
#
# The OSM/GTFS inputs are mounted read-only at /data. `motis import` copies the
# config and writes the preprocessed graph to $MOTIS_DATA_DIR (container-local
# and writable); `motis server` afterwards needs only that directory.
#
# The import runs on EVERY start, never behind a "config.yml already exists"
# check. MOTIS writes $DATA_DIR/config.yml at the very start of the import,
# before any preprocessing, so an interrupted or failed import (bad GTFS, OOM,
# reboot) leaves that file behind; keying off it made the next start skip the
# import and `motis server` die with `[VERIFY FAIL] ... please re-run import`
# (a crash loop under `restart: unless-stopped`). Running the import
# unconditionally is cheap: MOTIS keeps a completion hash per task in
# $DATA_DIR/meta/*.json and re-runs only the tasks whose inputs changed, so an
# unchanged graph costs ~1.5 s ("running tasks: []") and an interrupted one is
# simply resumed.
set -eu

CONFIG="${MOTIS_CONFIG:-/etc/motis/config.yml}"
DATA_DIR="${MOTIS_DATA_DIR:-/var/lib/motis/data}"

mkdir -p "$DATA_DIR"

echo "motis: importing/verifying graph in $DATA_DIR (no-op when unchanged)"
if ! motis import -c "$CONFIG" -d "$DATA_DIR"; then
    echo "motis: import failed; refusing to serve a stale or incomplete graph" >&2
    exit 1
fi
echo "motis: graph ready"

exec motis server -d "$DATA_DIR"
