# Local development runbook

How to run the complete BiyaHey! stack on one Windows machine — data pipeline,
MOTIS router, Fastify BFF and the React PWA — plus the commands that test and
accept it. This is the everyday developer guide; the acceptance runbooks record
what a green run looks like.

- Phase-2 acceptance (PWA, spec §3 criteria 2–6): [`phase2-acceptance.md`](phase2-acceptance.md)
- Phase-1 acceptance (data spine, router, BFF): [`phase1-acceptance.md`](phase1-acceptance.md)
- Data build in depth: [`data-build.md`](data-build.md)

## 0. What runs where

| Piece | Process | URL / port | Started by |
|---|---|---|---|
| `routing` — pinned MOTIS 2.11.4 | Docker Compose service | <http://localhost:8080> | `docker compose up -d --wait` or `npm run dev` |
| `api` — Fastify BFF | Docker Compose service | <http://localhost:8787> (`/health`, `/search`, `/plan`, `/sources`, `/fares/*`) | same |
| `web` — React 19 + Vite PWA | host Node process | <http://localhost:5173> | `npm run dev --workspace @biyahey/web` |
| `pipelines/` — Python data build | host Python process (one-off) | writes `data/build/` | `npm run data:build` |

The PWA is **not** a compose service: `docker compose` owns only the two
computer-side services, and the browser app runs from the host on **:5173**,
which is the origin in the BFF CORS allow-list (R40). `npm run dev` starts the
compose services; it does not start the Vite server.

## 1. Prerequisites

| Tool | What this machine has | Minimum |
|---|---|---|
| Windows + Windows PowerShell | Windows 11, **PowerShell 5.1** | PowerShell 5.1; `pwsh`/PowerShell 7 is not installed here |
| Node | **24.19.0** | 22+ (`package.json` `engines.node >=22`; CI `ci.yml` uses 22) |
| npm | **11.17.0** | 10+ |
| Python | **3.10.11** | 3.10 for `pipelines/` (CI uses 3.10) |
| Docker Desktop | **29.0.1**, Compose **v2.40.3** | Docker Desktop with the Compose v2 plugin and the WSL 2 backend |
| Playwright Chromium | installed | `npx playwright install chromium` (needed by E2E, `perf:web` and the screenshot script) |
| Java | 21 | only for the optional MobilityData `gtfs-validator` (CI runs it) |

No bash, WSL or Git-Bash is required. Every command below is PowerShell and is
run from the repository root (`C:\Users\Andrew\Desktop\BiyaHey!` in this
checkout) unless stated otherwise.

Disk and time: the Geofabrik PH extract is ~612 MB, the first `npm run
data:build` is ~90 minutes on this machine, and the MOTIS import can take tens
of seconds after a republish. `data/build/` and `data/snapshots/` are
gitignored — never commit generated data.

## 2. First-time setup

```powershell
cd C:\Users\Andrew\Desktop\BiyaHey!

npm ci

# Python virtualenv for the data pipeline (once)
cd pipelines
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..

# Build the GTFS + fare + provenance artifacts (one-time, ~90 min)
npm run data:build
```

`npm run data:build` chains `download → osm → publish` and writes
`data/build/manifest.json`, `data/build/gtfs/gtfs.zip`,
`data/build/build-report.json` and the OSM artefacts. `data-build.md` §6 lists
every generated file. Re-runs can reuse inputs:

```powershell
npm run data:build -- --skip-download    # reuse the PH extract, re-clip + publish
npm run data:build -- --publish-only     # reuse the NCR clip, rebuild the feed
```

## 3. Start the stack

```powershell
# MOTIS + BFF, waiting for both healthchecks (data/build must exist)
docker compose up -d --wait
# or the checked wrapper: validates data/build first, prints the URL summary
npm run dev
```

Then start the PWA in a **second terminal**:

```powershell
npm run dev --workspace @biyahey/web     # Vite dev server → http://localhost:5173
```

Open <http://localhost:5173>. The app talks to the BFF at
`http://localhost:8787` by default; override with `VITE_API_URL` before starting
Vite (R40):

```powershell
$env:VITE_API_URL = 'http://localhost:8787'
npm run dev --workspace @biyahey/web
```

Quick checks:

```powershell
(Invoke-WebRequest http://localhost:8787/health).Content          # {"status":"ok"}
(Invoke-WebRequest 'http://localhost:8080/api/v1/geocode?text=Cubao').StatusCode  # 200
```

MOTIS 2.11.4 has no `/health` route — its compose healthcheck (and the honest
liveness probe) is `/api/v1/geocode?text=Cubao`.

## 4. Everyday commands

All from the repository root.

| Command | What it does | Needs the stack? |
|---|---|---|
| `npm run lint` | ESLint 9 flat config | no |
| `npm run typecheck` | `tsc -b` across the workspace | no |
| `npm test` | offline Vitest: shared fares/DTOs, API unit, web unit + a11y + bundle; integration-tagged suites filtered out | no |
| `npm test --workspace @biyahey/web -- bundle` | paint-only first-screen payload vs the 250 KB gzip budget (requires a fresh `apps/web/dist`) | no |
| `npm run build --workspace @biyahey/web` | `tsc -b && vite build`; emits `sw.js` + `manifest.webmanifest` | no |
| `npm run test:e2e` | builds the web app, then Playwright: dev trip flow (live `/search` + `/plan`) and preview offline/service-worker/worker-asset projects | **yes** (:8080 + :8787) |
| `npm run perf:web` | builds, then Lighthouse CI (mobile, 4× CPU, 5-run median) against `vite preview` on :5173 | no API, but port 5173 must be free |
| `npm run smoke:routing` | live MOTIS geocode + plan smoke | **yes** (:8080) |
| `npm run test:integration` | live golden + MOTIS suites (`API_URL`/`MOTIS_URL` exported) | **yes** |
| `npm run verify:phase1` | Plan-1 acceptance harness (brings compose services up itself, starts a temporary API on a free port) | **yes** (Docker) |
| `npm run verify:phase2` | Plan-2 acceptance harness (unit, build, bundle, E2E, Lighthouse; `--with-phase1` optionally re-runs Plan 1) | **yes** (:8080 + :8787 + `data/build`) |
| `node apps/web/scripts/screenshots.mjs` | capture the README screenshots from the built app (starts its own `vite preview` on :5173) | **yes** (:8787 for real data) |

`npm run test:e2e` and `npm run perf:web` each build first; the bundle suite
refuses a stale `dist/` on purpose, so rebuild after changing web sources. Do
not run Lighthouse while another browser (including the DSH GUI) is busy — the
five-run median is designed to absorb noise, not a pegged CPU.

## 5. Windows / PowerShell notes

- This machine has **Windows PowerShell 5.1**. Commands copied from
  Unix-oriented docs that start with `pwsh` will fail; use `powershell` or the
  `pwsh`-named command runner your harness provides, not a PowerShell 7 install.
- Set environment variables with `$env:NAME = 'value'`; they last for the
  session. The Phase-1 harness strips `API_URL`/`MOTIS_URL` for its offline check;
  Phase 2's offline suite is `--tagsFilter=!integration` instead, so it does not
  need env stripping.
- PowerShell does not expand wildcards for native commands (`git mv dir/* …`
  fails); enumerate files explicitly.
- `npm run` scripts that call Node work in PowerShell 5.1, but colours/Unicode
  can render as mojibake when output is piped to a file. That is display-only;
  the tests compare strings in-process. (Use `cmd /d /s /c "npm … > log 2>&1"`
  when you need a raw transcript.)
- Docker Desktop must be running before `docker compose up`. Do not stop or
  restart the stack while a test/E2E run is in flight.
- Paths with spaces or `!` are fine in PowerShell 5.1 double quotes; this
  checkout's root contains `!`.

## 6. Troubleshooting

**Port already in use (5173/4173/8080/8787).**

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5173,4173,8080,8787 |
  Select-Object LocalPort, OwningProcess
```

Stop the other Vite/dev/preview server. Playwright's preview project uses
**:4173** and runs even when the dev server is already on :5173, so both ports
must be free for `npm run test:e2e`. `vite preview` (Lighthouse and screenshots)
uses **:5173** because that is the CORS-allowed origin.

**CORS / API requests fail from the browser.** Use `http://localhost:5173` (or
`http://127.0.0.1:5173`), not `:4173`, for a manual session against the API. The
BFF allows only `CORS_ORIGINS` (defaults to the two :5173 origins) and
`GET/POST/OPTIONS` + `Content-Type`. The E2E preview project deliberately needs
no API: it seeds a saved trip and exercises offline behaviour.

**Blank map in the built app.** The built app must emit
`apps/web/dist/assets/maplibre-gl-worker-*.mjs` (the `?url` import in
`MapCanvas`). The E2E preview project asserts the worker is served as
JavaScript from the hashed `/assets/` path. A missing worker, a blocked
`tiles.openfreemap.org`, or WebGL being unavailable leaves the map blank; the
sheet and saved/offline screens still work. The dev server resolves MapLibre's
worker differently, so "works in dev, blank in preview" points at the emitted
asset.

**Offline/PWA behaviour differs between dev and preview.** The Workbox service
worker is generated only by the production build and registers only under
`vite preview` (or a deployed static host). The Vite dev server has no service
worker, so offline reloads must be tested with
`npm run build --workspace @biyahey/web` + `npm run preview --workspace @biyahey/web`
(or `npm run test:e2e`, which builds first).

**Lighthouse fails or looks erratic.** `npm run perf:web` exits 1 when a strict
assertion fails; the known local failure is TBT above 2500 ms and LCP is
host-sensitive. Close other browsers/Electron apps, keep the five-run median,
and treat the CI `perf` job in `.github/workflows/web.yml` as authoritative.
Acceptance records performance as PARTIAL with the measured numbers — never as
a green line (R87/R88).

**`data/build` missing / stale feed.** `npm run data:build` builds it; after a
republish, recreate the router container so MOTIS imports the new feed:
`docker compose up -d --force-recreate --wait routing` (this is the one
documented recreate; acceptance never does it for you).

**Node 24 locally vs Node 22 in CI.** The lockfile is validated with `npm ci
--dry-run`; if CI reports an npm version/lockfile mismatch, check the first run
of `.github/workflows/web.yml` (Node 24) against `ci.yml` (Node 22).

## 7. Where to go next

- **Acceptance:** `npm run verify:phase2` and
  [`phase2-acceptance.md`](phase2-acceptance.md); Plan 1's harness is
  `npm run verify:phase1` and [`phase1-acceptance.md`](phase1-acceptance.md).
- **UI, provenance and test conventions:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- **Data pipeline details, artefact list and licences:** [`data-build.md`](data-build.md).
- **Product scope and success criteria:** `docs/superpowers/specs/2026-11-01-biyahey-design.md`.
