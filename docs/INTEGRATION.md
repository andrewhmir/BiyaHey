# BetterGov.ph integration

BiyaHey! is a standalone app in the [BetterGov.ph](https://bettergov.ph) family
— the community-run Philippine government portal. BetterGov services are
independent apps on their own subdomains (e.g. `hotlines.bettergov.ph`,
`budget.bettergov.ph`); BiyaHey! is its own installable PWA, **not** an iframe
embed of the portal. This page is the contract for deploying and listing it as a
family app.

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
honest error/empty states, so a family deployment must keep the BFF reachable.

## Required configuration

- **`CORS_ORIGINS`** must include the deployed web origin, e.g.
  `CORS_ORIGINS=https://biyahey.bettergov.ph`. The BFF allows only that list (no
  wildcard, no credentials) for `GET`, `POST`, `OPTIONS` and `Content-Type`.
- **`VITE_API_URL`** is inlined into the PWA at build time and must point at the
  public BFF origin (e.g. `https://api.biyahey.bettergov.ph`).
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
   static files over HTTPS on the app subdomain (any static host/CDN). The build
   also emits the service worker and `manifest.webmanifest`.

Health-gate a deployment on `GET /health` (BFF) and the MOTIS geocode endpoint
used by its compose healthcheck.

## Listing on bettergov.ph

Open a PR/issue with the BetterGov.ph maintainers to add BiyaHey! to the family
app listing, linking to the deployed PWA subdomain. The portal links out to
independent apps; there is no portal wrapper, and the app must keep working as
its own URL (deep links to `/search`, `/plan?...`, `/trip/:id`, `/saved`). Keep
the BetterGov visual language described in the next section.

## Design-token alignment

The UI uses the [Kapwa](https://www.npmjs.com/package/@bettergov/kapwa) design
system (`@bettergov/kapwa` v1.4.1, CC0, Tailwind v4, React 19), the **Figtree**
typeface and the bettergov.ph palette, whose primary is **`#0066eb`**. The
tokens live in `apps/web/src/theme.css` (`brand`, `ink`, `line`, `canvas`,
`success`, `warning`, `danger`, …); components use the tokens, not raw colours.
A Kapwa/Tailwind upgrade changes the design system in one dependency bump plus
that token file.

## Standalone PWA / manifest

The app is built with `vite-plugin-pwa`: it ships a web app manifest (`id` and
`start_url` `/`, `display: standalone`, `lang: tl`, `theme_color: #0066eb`,
background `#f8f9fa`, 192/512/maskable icons) and a service worker that
precaches the app shell and runtime-caches map tiles and fonts. Install it from
the browser; saved trips are stored locally and reopen offline with their fare
snapshot and dataset version. There is no embedded/iframe mode and no realtime
data source — the UI states both.
