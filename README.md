# BiyaHey!

An open-source, local-first commute planner for Metro Manila. Search a place,
compare the best 3–5 jeepney / bus / rail / ferry options with **honest fares and
visible data provenance**, and see exactly which dataset every number came from.

BiyaHey! is built in the open with [BetterGov](https://bettergov.ph)
conventions: MIT code, open data, Conventional Commits, and an explicit
AI-assisted-work disclosure.

> **Status (2026-11-01):** Plan 1 — the data spine + router + BFF — is complete
> on `feature/data-spine`. The PWA (Plan 2, `apps/web`) does not exist yet, so
> there is no `web` service in `docker compose` and no screenshots. Phase-1
> acceptance is **PARTIAL** by design (criteria 6 and the About-data screen are
> Plan 2); see `docs/runbooks/phase1-acceptance.md`.

## What works today

- `pipelines/` — Python build: Geofabrik PH extract → NCR clip → merged GTFS
  (OSM routes + curated jeepney/UV inventory, landmark aliases) + fare tables +
  manifest + coverage/build report. Licence gate fails the build if the ODbL
  notice or the CC BY-SA 2.0 inventory attribution is lost.
- `services/routing/` — pinned MOTIS 2.11.4 in Docker, importing that feed.
- `services/api/` — Fastify BFF: `/search`, `/plan` (fares, provenance, ranking,
  plausibility guard, 3–5 option cap), `/sources`, `/fares/quote`,
  `/fares/status`, `/health`, CORS for the PWA origin.
- `packages/shared/` — browser-safe DTOs, the 2026 fare engine, and
  `joinAttributions` for the PWA; the Node-only registry loader is a separate
  subpath so it never enters the browser bundle.

## Quick start

### Prerequisites

- **Node 22+** (this repo was built on Node 24) and **npm 10+**
- **Docker Desktop** (MOTIS + the API image)
- **Python 3.10+** for the data pipeline
- **Java 21+** only if you want to run MobilityData `gtfs-validator` locally
  (CI also runs it; see `.github/workflows/data.yml`)

### 1. Install dependencies

```powershell
npm ci
```

### 2. Create the pipeline virtualenv (once)

```powershell
cd pipelines
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
```

### 3. Build the data (one-time, ~90 minutes on this machine)

```powershell
npm run data:build
```

That runs `download → osm → publish` from the repository root, passing the
documented landmark aliases. The Geofabrik download is ~612 MB; the NCR clip is
the slow part (~72 min; see `docs/runbooks/data-build.md` for measured timings
and every generated artifact). Subsequent iterations can reuse inputs:

```powershell
npm run data:build -- --skip-download    # reuse the PH extract, re-clip + publish
npm run data:build -- --publish-only     # reuse the NCR clip, rebuild the feed
```

`data/build/` and `data/snapshots/` are gitignored — **never commit generated
data**.

### 4. Start the stack

```powershell
npm run dev
```

This runs `docker compose up -d --wait routing api`:
`routing` on **http://localhost:8080** and `api` on **http://localhost:8787**
(`/health`, `/sources`, `/search`, `/plan`, `/fares/quote`, `/fares/status`).
The PWA will join on **http://localhost:5173** in Plan 2; that origin is already
in the API's CORS allowlist (`CORS_ORIGINS`).

### 5. Verify

```powershell
npm run ci                    # lint + typecheck + offline tests + data schemas + fare staleness
npm run smoke:routing         # live MOTIS geocode + plan
npm run verify:phase1         # full phase-1 acceptance (expect PARTIAL)
```

## Repository layout

```
apps/web/            # Plan 2: React 19 PWA (not created yet)
services/api/        # Fastify BFF (TypeScript)
services/routing/    # pinned MOTIS Docker image + config
packages/shared/     # browser-safe DTOs, fare engine, attribution helper
pipelines/           # Python data build (download/osm/publish/coverage/licence-gate)
data/                # provenance registry, fares, curated routes (build output gitignored)
docs/                # research, specs, plans, runbooks, handoff
scripts/             # dev/data:build/checks/smoke/acceptance harnesses
```

## Data provenance and licences

Every dataset is registered in `data/provenance/sources.yaml` and returned by
`/sources`; `/plan` only cites datasets the returned itineraries actually used.

| Asset | Licence | Notes |
|---|---|---|
| Repository code (`packages/`, `services/`, `pipelines/`, `scripts/`) | **MIT** (`LICENSE`) | |
| Generated GTFS database (`data/build/gtfs/gtfs.zip`) | **ODbL 1.0** | derived from OpenStreetMap; the notice ships inside the zip (`LICENSE-DATA.txt`) |
| Curated jeepney/UV inventory (`data/routes/jeepney-inventory.yaml`) | **CC BY-SA 2.0** | OSM Wiki; any GTFS derived from it states the attribution inside the artifact |
| Fare matrices (`data/fares/`) | Government public information, transcribed | LTFRB / LRTA / LRMC / MMDA; effectivity dates are always displayed |
| Documentation (`docs/`, `README.md`, `CONTRIBUTING.md`) | **CC BY 4.0** | |

Details: `data/LICENSE-DATA.md`, `data/provenance/PROVENANCE_NOTES.md`, and the
runbook's known-gaps section. Sakay/PTAC 2014 GTFS, BusMaps and any feed without
a reuse grant are **never shipped**.

Known data gaps (recorded, not hidden): coverage 12/16 curated routes; PNR and
non-PRFS ferries excluded from the v1 feed and counted; P2P formally deferred;
LRT-2 fare band provisional (`needs_verification: true`); a plausibility guard
mitigates bad OSM shapes until the GTFS is rebuilt. See
`docs/runbooks/phase1-acceptance.md` §8.

## Contributing

Read `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`. AI-assisted contributions are
welcome and must be disclosed (see `AI_DISCLOSURE.md` and the PR template).
Data changes must pass `npm run validate:data`, the licence gate, and (when they
touch the feed) the pipeline tests.

## Licence

Code is MIT. Derived transit data is ODbL 1.0 with attribution; the wiki-derived
route inventory is CC BY-SA 2.0. Screenshots and UI documentation will be added
with Plan 2.
