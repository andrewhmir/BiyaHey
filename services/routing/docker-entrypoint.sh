#!/bin/sh
# MOTIS entrypoint: import the graph on first start, then serve it.
#
# The OSM/GTFS inputs are mounted read-only at /data. `motis import` copies the
# config and writes the preprocessed graph to $MOTIS_DATA_DIR (container-local
# and writable); `motis server` afterwards needs only that directory.
set -eu

CONFIG="${MOTIS_CONFIG:-/etc/motis/config.yml}"
DATA_DIR="${MOTIS_DATA_DIR:-/var/lib/motis/data}"

if [ -f "$DATA_DIR/config.yml" ]; then
    echo "motis: reusing existing graph in $DATA_DIR"
else
    echo "motis: importing graph from $CONFIG into $DATA_DIR (first start; this can take minutes)"
    mkdir -p "$DATA_DIR"
    motis import -c "$CONFIG" -d "$DATA_DIR"
    echo "motis: import complete"
fi

exec motis server -d "$DATA_DIR"
