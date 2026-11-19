# Deployment & integration

BiyaHey! is an independent, open-source commute planner PWA — a static React app
plus a small BFF and a routing engine that you host yourself. There is no portal
wrapper, no account system and no affiliation with any other service or
organisation: a deployment is just this repository's services on your own
domains. This page is the contract for deploying and integrating it.

## What the app calls

All data comes from the BiyaHey! BFF (Fastify, default `:8787`); the app never
talks to MOTIS directly and never computes a fare client-side.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness probe (used by the compose healthcheck) |
| `GET` | `/search?q=&near=` | grouped typeahead (stops, landmarks, routes, saved); `near=lat,lon` adds distances |
| `POST` | `/plan` | ranked itineraries with fares, `sources[]` and a labelled walk fallback |
| `GET` | `/sources` | provenance registry rows: dataset, publisher, SPDX licence, URL, coverage, last-checked date, attribution |
| `GET` | `/fares/status` | fare matrix `effective_from` + staleness verdict |

Responses are JSON. `/plan` and `/search` requests can fail fast; the app shows
honest error/empty states, so a deployment must keep the BFF reachable.

## Required configuration

- **`CORS_ORIGINS`** must include the deployed web origin, e.g.
  `CORS_ORIGINS=https://biyahey.example.org`. The BFF allows only that list (no
  wildcard, no credentials) for `GET`, `POST`, `OPTIONS` and `Content-Type`.
- **`VITE_API_URL`** is inlined into the PWA at build time and must point at the
  public BFF origin (e.g. `https://api.biyahey.example.org`), or at `/api` when
  the same origin proxies it (the bundled preview server does this).
- **`MOTIS_URL`** points the BFF at the routing service (`http://routing:8080`
  in compose); `BIYAHEY_DATA_DIR` points it at the mounted data directory.
- The BFF should be behind TLS/HTTPS at its public origin; there is no auth and
  no user data stored server-side (saved trips live in the browser).

## Deployment shape

1. **Data**: build the routing inputs (`npm run data:build`, see
   [DEVELOPMENT.md](DEVELOPMENT.md)) and mount them into the BFF and MOTIS
   containers. Generated data is gitignored and never baked into the repo.
2. **Routing**: the pinned MOTIS 2.11.4 container from
   `services/routing/Dockerfile` (compose service `routing`, port 8080).
3. **BFF**: the Fastify container from `services/api/Dockerfile` (compose
   service `api`, port 8787) with `CORS_ORIGINS`, `MOTIS_URL` and
   `BIYAHEY_DATA_DIR` set for the environment.
4. **Web**: `npm run build` emits the static PWA in `apps/web/dist`. Serve it as
   static files over HTTPS on your app domain (any static host/CDN). The build
   also emits the service worker and `manifest.webmanifest`.

Health-gate a deployment on `GET /health` (BFF) and the MOTIS geocode endpoint
used by its compose healthcheck.

## Deep links and hosting

The app must keep working as its own URL: deep links to `/search`, `/plan?...`,
`/trip/:id` and `/saved` all resolve through the SPA history fallback, so the
static host has to serve `index.html` for unknown paths (the bundled
`scripts/serve-web.mjs` does this, plus compression and a same-origin `/api`
proxy).

## Design tokens

The UI uses Tailwind v4 tokens from `apps/web/src/theme.css` (`brand` `#0066eb`,
`ink`, `line`, `canvas`, `success`, `warning`, `danger`, …); components use the
tokens, not raw colours. Figtree is the typeface.

## Standalone PWA / manifest

The app is built with `vite-plugin-pwa`: it ships a web app manifest (`id` and
`start_url` `/`, `display: standalone`, `lang: tl`, `theme_color: #0066eb`,
background `#f8f9fa`, 192/512/maskable icons) and a service worker that
precaches the app shell and runtime-caches map tiles and fonts. Install it from
the browser; saved trips are stored locally and reopen offline with their fare
snapshot and dataset version. There is no embedded/iframe mode and no realtime
data source — the UI states both.
