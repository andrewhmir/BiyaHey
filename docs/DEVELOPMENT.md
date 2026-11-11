# Development

How to run, build and test BiyaHey! locally. Integration story:
[INTEGRATION.md](INTEGRATION.md); contribution rules: [../CONTRIBUTING.md](../CONTRIBUTING.md).

## Repository layout

```
apps/web/          React 19 + Vite PWA (map shell, screens, theme, PWA manifest)
services/api/      Fastify BFF (TypeScript): fares, provenance, MOTIS adapter
services/routing/  pinned MOTIS 2.11.4 Docker image + NCR/national configs
packages/shared/   browser-safe DTOs, fare engine, attribution helpers
pipelines/         Python data build: download → osm clip → publish
data/              provenance registry, fare matrices, curated routes (no build output)
scripts/           dev, data-build, validate-data, check-fares helpers
docs/              this page, integration guide, screenshots
```

`data/build/` and `data/snapshots/` are generated and gitignored — never commit
them.

## Local stack

| Piece | Process | URL | Started by |
|---|---|---|---|
| `routing` (MOTIS 2.11.4) | Docker Compose | <http://localhost:8080> | `docker compose up -d --wait` or `npm run dev` |
| `api` (Fastify BFF) | Docker Compose | <http://localhost:8787> | same |
| `web` (Vite dev server) | host Node | <http://localhost:5173> | `npm run dev --workspace @biyahey/web` |

The app is **not** a compose service. The browser origin `http://localhost:5173`
is in the BFF's CORS allow-list by default (both `localhost` and `127.0.0.1`
spellings); a deployment must set `CORS_ORIGINS` to its real web origin.
Health checks: `curl http://localhost:8787/health` and
`curl 'http://localhost:8080/api/v1/geocode?text=Cubao'`.

## Data build

The pipeline is Python 3.10+ and needs a virtualenv (once). `scripts/data-build.mjs`
resolves it itself (`pipelines/.venv/bin/python`; on Windows
`pipelines\.venv\Scripts\python.exe`):

```bash
python -m venv pipelines/.venv
pipelines/.venv/bin/pip install -r pipelines/requirements.txt
```

Then, from the repository root:

```bash
npm run data:build                     # download → NCR clip → publish
npm run data:build -- --skip-download  # reuse the PH extract, re-clip + publish
npm run data:build -- --publish-only   # reuse the NCR clip, rebuild the feed
npm run data:build -- --region ph      # national feed into data/build/gtfs/ph
```

Measured timings on the dev machine (also in `scripts/data-build.mjs`): the
Geofabrik PH download is ~612 MB and network-bound; the NCR clip takes
**~72 minutes**; publish takes **~6 minutes**. The first build is therefore
about 90 minutes — not a per-request cost. MOTIS imports the graph once per
container start; after a rebuild, recreate the router so it re-imports:

```bash
docker compose up -d --force-recreate --wait routing
```

## Environment variables

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `VITE_API_URL` | web (build/dev) | `http://localhost:8787` | BFF origin; inlined at build time |
| `CORS_ORIGINS` | api | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated browser origins allowed to call the BFF |
| `MOTIS_URL` | api | `http://localhost:8080` | router base URL (compose sets `http://routing:8080`) |
| `BIYAHEY_DATA_DIR` | api | repository `data/` | provenance registry, fares, curated inventory (compose mounts it at `/data`) |
| `PORT` | api | `8787` | BFF listen port |
| `BIYAHEY_ROUTING_CONFIG` | routing (compose) | `/etc/motis/config.yml` | set `/etc/motis/config.ph.yml` to serve the national graph |

## Checks

| Command | Needs the stack? | What it covers |
|---|---|---|
| `npm run lint` | no | ESLint |
| `npm run typecheck` | no | shared + API (`tsc -b`) and web (`tsc -p apps/web --noEmit`) |
| `npm test` | no | offline unit tests; `integration`-tagged suites filtered out |
| `npm run test:integration` | yes (`API_URL`, `MOTIS_URL`) | live API/router golden and MOTIS suites |
| `npm run validate:data` | no | JSON-Schema validation of every `data/**` file |
| `npm run check:fares` | no | fare-matrix staleness (183-day rule) |
| `npm run ci` | no | all of the above in CI order |
| `npm run build` | no | production PWA in `apps/web/dist` |

The Vite dev server has no service worker, so installability and offline
behaviour are tested against the production build. `apps/web/vite.config.ts`
pins `preview` to port 5173 for parity with dev, and the BFF only allows the
origins in `CORS_ORIGINS`, so a preview on another port needs both sides moved
together, e.g.:

```bash
cd apps/web
VITE_API_URL=http://localhost:8788 npx vite build
npx vite preview --port 4173 --strictPort        # or override preview.port
CORS_ORIGINS=http://localhost:4173 PORT=8788 npm run start --workspace @biyahey/api
```

`apps/web/e2e/pwa.spec.ts` runs exactly this pattern (build, preview child
process, CORS-configured BFF child) and proves the offline reload plus the
offline `/saved` snapshot. Playwright browser flows live in `apps/web/e2e/` and
need the live stack (`npx playwright test` from `apps/web`).

## How screens route

The app shell renders one persistent map plus a panel; screens only fill the
panel. Routes are declared in `apps/web/src/app.tsx`:

| Path | Screen | File |
|---|---|---|
| `/` | Home / map | `apps/web/src/screens/Home.tsx` |
| `/search` | Directions form + typeahead | `apps/web/src/screens/Search.tsx` |
| `/plan` | Route options | `apps/web/src/screens/Results.tsx` |
| `/trip/:id` | Trip detail | `apps/web/src/screens/Trip.tsx` |
| `/trip/:id/live` | Leg-by-leg walkthrough | `apps/web/src/screens/Live.tsx` |
| `/saved` | Saved trips + recents | `apps/web/src/screens/Saved.tsx` |
| `/sources` | About data / provenance | `apps/web/src/screens/AboutData.tsx` |

Shared context: `src/i18n.tsx` (`t()`, Taglish default), `src/copy.ts` (all
copy), `src/lib/api.ts` (BFF client), `src/map/store.ts` (`mapActions`,
`useMapState`).
