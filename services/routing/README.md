# Routing service — MOTIS

[MOTIS](https://github.com/motis-project/motis) v2.11.4 provides the BiyaHey!
routing, geocoding and timetable API. This directory packages it for the
`routing` service in the repository-root `docker-compose.yml`.

The service serves `http://localhost:8080` and exposes (verified against the
v2.11.4 OpenAPI spec and the running container):

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/geocode?text=Cubao` | geocoding / autocomplete (also the healthcheck) |
| `GET /api/v6/plan?fromPlace=…&toPlace=…&time=…` | journey planning |
| `GET /api/v1/health` | MOTIS's own health endpoint |

## Inputs (generated, never committed)

The container mounts `./data/build` **read-only** at `/data` and expects:

- `/data/osm/ncr.osm.pbf` — NCR clip from the OSM stage
- `/data/gtfs/gtfs.zip` — merged feed from the publish stage

Build them with the data pipeline first (see
[`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md)); `data/build/` is gitignored.

## Build and run

```powershell
docker compose build routing
docker compose up -d --wait routing   # --wait blocks until the healthcheck passes
docker compose logs -f routing
```

Every start runs `motis import` (graph preprocessing) into the container-local,
writable `/var/lib/motis/data` before running `motis server` from that
directory. MOTIS records a completion hash for each import task in
`/var/lib/motis/data/meta/*.json` and re-runs only the tasks whose inputs
changed:

- unchanged graph → `running tasks: []`, about 1.5 s, then the server starts;
- fresh or interrupted graph → the missing tasks run (about 20 s for the NCR
  inputs on the Task 9 verification machine; the compose healthcheck allows a
  600 s `start_period` for slower machines);
- rebuilt inputs → only the affected tasks re-run.

The entrypoint deliberately does **not** use the presence of
`/var/lib/motis/data/config.yml` as an "already imported" marker. MOTIS writes
that file at the very start of the import, before any preprocessing, so an
interrupted import (bad GTFS, OOM, reboot) leaves it behind. Using it as the
marker made the next start skip the import and `motis server` exit with
`[VERIFY FAIL] tt: no existing version found … please re-run import` — a crash
loop under `restart: unless-stopped`. Running the import unconditionally closes
that gap: an interrupted import is resumed on the next start, and no manual
`down`/`up` is needed to recover.

The graph is still container-local: a new container re-imports from scratch,
which guarantees the served graph matches the mounted inputs. After rebuilding
the inputs, `docker compose restart routing` (or
`docker compose up -d --force-recreate routing`) is enough — the import detects
the new hashes. The inputs must stay mounted: the import reads them on every
start, so a missing `data/build` fails fast instead of serving a stale graph.

To verify:

```powershell
docker compose ps                      # routing … (healthy)
curl.exe -fsS "http://localhost:8080/api/v1/geocode?text=Cubao"
```

Expected smoke output:

```
geocode: <n> result(s) for "Cubao"
plan: <n> itinerary/itineraries, <n> with a transit leg (14.619,121.053 -> 14.554,121.024 at 2026-11-02T08:00:00+08:00)
ok: <n> geocode hits, <n> transit itineraries
```

`MOTIS_URL` overrides the endpoint (default `http://localhost:8080`).

## Configuration

`config/config.yml` is the MOTIS config, baked into the image at
`/etc/motis/config.yml`. It was generated inside the pinned container with the
binary's own generator:

```sh
motis config /data/osm/ncr.osm.pbf /data/gtfs/gtfs.zip
```

and then edited for this deployment only:

- added `server.port: 8080` (`server.port` is documented in MOTIS
  `docs/setup.md`; the default is 8080, pinned here explicitly);
- removed the generated `tiles:` block — this service is routing-only and map
  tiles are not part of the MVP. Keeping it would add a long, memory-hungry tile
  import; `osm:` also serves street routing and geocoding without it.

## Pinned release and checksum

| Asset | Size | SHA-256 |
|---|---|---|
| `motis-linux-amd64.tar.bz2` (used by the image) | 52,862,254 B | `b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc` |
| `motis-windows.zip` (fallback, see below) | 52,231,908 B | `5617760d47c1828f11a45bc9d034d719dd1dded1e1ac694fd14a3cf757450ad0` |

The Dockerfile downloads
`https://github.com/motis-project/motis/releases/download/v2.11.4/motis-linux-amd64.tar.bz2`
and fails the build unless the SHA-256 matches
`b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc` (the digest
published on the v2.11.4 release asset). Bump `MOTIS_VERSION` and
`MOTIS_SHA256` together.

## Windows fallback (documented, not implemented)

If Docker is unavailable, the same release ships `motis-windows.zip`
(SHA-256 above). It is **not** wired into the repo or CI; use it only to debug a
build locally:

```powershell
Invoke-WebRequest https://github.com/motis-project/motis/releases/download/v2.11.4/motis-windows.zip -OutFile motis-windows.zip
Expand-Archive motis-windows.zip -DestinationPath motis
# work directory holding osm\ncr.osm.pbf and gtfs\gtfs.zip
.\motis\motis.exe config osm\ncr.osm.pbf gtfs\gtfs.zip
.\motis\motis.exe import
.\motis\motis.exe server
```

The Windows binary defaults to the same port 8080; stop it before using the
Docker service.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| container exits with `path /data/... does not exist` | inputs missing — build them and check `data/build/osm/ncr.osm.pbf` and `data/build/gtfs/gtfs.zip` |
| container logs `motis: import failed; refusing to serve…` then restarts | import failed (invalid/absent inputs); fix `data/build` — the service will not serve a stale graph |
| healthcheck failing for the first several minutes | expected while `motis import` runs; watch `docker compose logs -f routing` |
| healthcheck/geocode fails (`connection refused`) | service not up yet or not listening on 8080; check `docker compose ps` |
| `geocode failed: no results for Cubao` | graph imported without the NCR extract (wrong `/data` mount) |
| `plan failed: no transit itinerary` | timetable empty or its service days do not cover 2026-11-02; rebuild the feed |
