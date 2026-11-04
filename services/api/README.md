# `@biyahey/api` — the BiyaHey! BFF

Fastify 5 + TypeScript service that sits between the PWA and the MOTIS router.
It is the only component that prices fares and assembles provenance, so every
response can carry the datasets it actually used (spec §7, §10).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness probe used by the compose healthcheck |
| `GET` | `/sources` | the provenance registry, in canonical order (10 rows) |
| `GET` | `/search?q=…&near=lat,lon` | grouped typeahead (`stops`, `landmarks`, `routes`, `saved`); optional `near` adds `distanceM` to every row |
| `POST` | `/plan` | MOTIS itineraries → ranked best 3–5 options with fares and `sources[]` |
| `POST` | `/fares/quote` | price one leg (2026 matrix, rail bands, free-ride overrides); adds `stale` |
| `GET` | `/fares/status` | fare matrix `effective_from` + `stale` (183-day rule) |

`POST /plan` sets diagnostic headers: `x-biyahey-motis-calls` (every logical MOTIS
`/plan` call the request made — the fan-out, plus the fallback's walk-route call when
one was needed), `x-biyahey-implausible-dropped` (bad-geometry guard, R10),
`x-biyahey-unsupported-dropped` (PNR / non-PRFS ferry / other unpriced modes) and
`x-biyahey-fallback` (`walk` only when the response is the labelled walking estimate
returned because the router had no usable itinerary).
It returns at most 5 itineraries (spec §9), after ranking and dedupe; when there are
none it returns one `fallback: 'walk'` estimate instead of an empty list (see
`src/routing/walk-fallback.ts`).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | listen port |
| `BIYAHEY_DATA_DIR` | repo `data/` resolved by the shared loader | provenance registry, fares and curated inventory |
| `MOTIS_URL` | `http://localhost:8080` | router base URL (compose sets `http://routing:8080`) |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated browser origins allowed to call the API |

### CORS (browser boundary)

The PWA is served by Vite on **http://localhost:5173**, which is a different
origin from the API on **:8787**; without CORS a browser cannot POST `/plan`.
`@fastify/cors` is registered with an explicit allowlist:

- defaults: `http://localhost:5173` and `http://127.0.0.1:5173` (both spellings,
  because browsers treat them as distinct origins);
- `CORS_ORIGINS=https://app.example` overrides the list in a deployment;
- `POST`, `GET`, `OPTIONS` and the `Content-Type` header are allowed; no
  wildcard and no credentials, so an unrelated page cannot read responses;
- an origin outside the list gets **no** `Access-Control-Allow-Origin` header
  (the request may still be served, but the browser blocks the response).

Tests in `test/app.test.ts` pin the preflight (`OPTIONS /plan` from an allowed
origin → 204 with `Access-Control-Allow-Origin/Methods/Headers`, a disallowed
origin gets none) and a real `POST` with an `Origin` header.

## Run it

```powershell
# From the repository root, with the data build present:
npm run dev            # docker compose up -d --wait routing api
# or directly (tsx is a runtime dependency):
npm run start --workspace @biyahey/api
```

The image is built from the repository root (`services/api/Dockerfile`) because
the API consumes the `@biyahey/shared` sources in v1 (ruling R19); `tsx` is a
**dependency** so `npm ci --omit=dev` still starts the server.

## Tests

```powershell
npx vitest run services/api --tagsFilter=!integration   # unit, offline
$env:API_URL = 'http://localhost:8787'
npx vitest run services/api/test/golden.test.ts         # live golden acceptance
```

The golden suite is tagged `integration`, so `npm run ci` never depends on a
running stack. Runbook: `docs/runbooks/phase1-acceptance.md`.
