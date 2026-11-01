# BiyaHey! — Design Spec

**Status:** Draft for review · **Date:** 2026-11-01 · **Project:** BiyaHey! — open-source, community-built commuter route planner for the Philippines
**Path chosen from brainstorming:** architectural (new project) · **UI approach chosen:** Option A — Google-Maps-faithful sheet (see `.superpowers/mockups/option-a-maps-faithful.html`)
**Research inputs:** [`docs/research/ph-transit-datasets.md`](../research/ph-transit-datasets.md) · [`docs/research/routing-and-map-stack.md`](../research/routing-and-map-stack.md) · [`docs/research/ui-and-competitors.md`](../research/ui-and-competitors.md)

---

## 1. Brief — what we are building and why

A Filipino commuter types any place ("Ayala, Makati", "SM Fairview", "my Lola's place in Pasig"), gets the **most efficient ways to get there** as 3–5 ranked options across jeepney, bus, UV Express, P2P, MRT/LRT, Pasig River Ferry and walking — each showing **time, fare, transfers and step-by-step sakay instructions** — and every route/fare states **where its data came from**.

Three differentiators, all backed by research:
1. **Fare is a first-class field on the route card**, with an effectivity date. No PH competitor does this.
2. **Provenance is built into the API and UI** (`sources[]` → three-layer attribution), not a legal footnote.
3. **Google-Maps-grade interaction model** (sheet over map, one search field, ETA-sorted cards) — familiarity without Google's contract.

**Intent (user-confirmed):** open source, for the community, intended as a contribution to the [BetterGov.ph](https://bettergov.ph) civic-tech ecosystem. Development is **local-first** (Docker on the dev machine); deployment comes later.

## 2. Users and jobs to be done

| User | Job | What v1 must do |
|---|---|---|
| Daily commuter (NCR) | "Cheapest way to work, and will I make it?" | Ranked routes with fare + ETA, saved trips, offline |
| Occasional commuter | "I don't know this place — how do I get there?" | Landmark-first search, step-by-step with signage/landmarks |
| Student / budget rider | "Which route is cheapest?" | Cheapest filter, itemised fare with source + date |
| Civic technologist / contributor | "Can I verify and improve this?" | Data inventory, provenance screen, contribution docs, ODbL-clean outputs |

## 3. Success criteria for v1 (measured, not vibes)

1. `docker compose up` on a clean Windows machine builds and serves the full stack (web + API + router) in < 20 min after the first data build.
2. Search returns grouped results (Stops · Landmarks · Routes · Saved) for any NCR query; p95 search ≤ 1.5 s.
3. For 10 golden NCR trips, the planner returns ≥ 3 itineraries with total time, fare, transfers and walk distance; p95 plan ≤ 1.5 s.
4. Fare engine passes ≥ 25 golden fare cases, including the 2026-09-28 PUV matrix, the 2026-03-23 LRT-2/MRT-3 50% discount, LRT-1's exclusion from it, and free-ride overrides.
5. Every itinerary response carries `sources[]`; the About-data screen lists every dataset with publisher, licence, last-checked date; every fare shows `effective_from`.
6. PWA is installable; saved trips + fare matrix work offline with a staleness stamp.
7. Coverage report: ≥ 60% of the NCR jeepney/UV routes listed in the OSM Wiki inventory are modelled (with the missing list published).
8. Licence gate: all shipped code MIT; derived transit database published ODbL; no unlicensed dataset (Sakay/BusMaps) redistributed.

## 4. Constraints and confirmed decisions

| Decision | Value | Source |
|---|---|---|
| Coverage v1 | Metro Manila + Rizal/Cavite/Laguna/Bulacan commuter belt | user |
| Platform | Mobile-first web app (PWA), one codebase | user |
| Map | Open stack styled like Google Maps — MapLibre GL JS + OpenFreeMap tiles (no Google Maps Platform) | user + ToS research |
| Output now | Design spec + implementation plan docs before code | user |
| Hosting | Local-first (Docker); deployment deferred to a later phase | user |
| Project home | Standalone open-source repo (MIT), structured to be adopted into bettergovph conventions | user intent + BetterGov docs |
| Provenance | Mandatory in API + UI for every route and fare | user |

## 5. What the research changed (the facts this design is built on)

| Finding | Consequence for the design | Source |
|---|---|---|
| **No official GTFS or GTFS-RT exists for PH.** All circulating feeds are 2013–2020 community artifacts; the "LTFRB GTFS" on Mobility Database is actually the Sakay 2020 community feed with an unclear licence | **The data pipeline is the critical path.** We build our own GTFS from OSM + curated inventory; no dependency on a dead feed | datasets §2 |
| **OSM is the only current, licensed backbone**: 584 MB PH extract, data to 2026-10-31, 2,851 route relations, 99.5% PTv2, rail stations complete; but only 76 `route=share_taxi` relations nationwide (jeepneys) | Use OSM for road/rail/stop geometry and licensed base; **jeepney network must be curated** from the OSM Wiki inventory + community mapping | datasets §1 |
| **Fares changed twice in 2026** (PUV matrix 2026-09-28; LRT-2/MRT-3 50% discount 2026-03-23; LRT-1 excluded) and no machine-readable fare file exists | Fares are **hand-curated, versioned config** with `effective_from`/`effective_to` + source URL; never scraped at runtime | datasets §3 |
| **PNR Metro Commuter suspended** until ~2028–29; **Pasig River Ferry operating and free** but absent from every dataset; tricycles have effectively no data | Do not model PNR; hand-enter the 12-station ferry line; do not promise tricycle routing | datasets §4–5 |
| **Google Maps Platform is contractually incompatible** with our own routing on an open basemap (ToS §3.2.3(e), no caching) | MapLibre + OpenFreeMap; UI imitates the *container*, not Google's data | stack §5 |
| **MOTIS 2.11.4 (MIT)** fits local-first: one binary, low RAM, GTFS + Fares v2, bundles geocoder and tile server; OTP 2.10 as the scaling escape hatch | MOTIS is the v1 routing engine; BFF owns fares/provenance (and can swap engines) | stack §1, §7 |
| **Nominatim forbids autocomplete**; Photon is the typeahead option; PSGC is the admin join key; no national address dataset | Search is landmark/POI-first; geocoder behind a switchable provider interface | datasets §6 |
| **Fare-forward + provenance + Google-grade sheet is an open market gap** (Sakay = route depth, Google = familiarity) | This is the product wedge — keep scope tight on it | ui §0, §2 |

## 6. Approaches considered

| # | Approach | Why rejected / chosen |
|---|---|---|
| A | Use the Sakay/PTAC 2014 GTFS as the base, OTP 2 as router | **Rejected.** Service ended 2020-06-30 and there is no reuse licence. Safe only as an internal shape donor during exploration. |
| B | Buy BusMaps corrected GTFS, wrap in OTP | **Rejected.** Commercial, non-redistributable (kills an open-source public project), and it is a re-dated copy of the 2014 corpus, not fresh survey data. |
| C | Google Maps Platform for map + our own routing | **Rejected.** Prohibited by Google ToS; also unbudgeted at commuter-app scale. |
| D | Build a custom RAPTOR/GTFS router | **Rejected for v1.** 4–10 engineer-weeks before matching MOTIS/OTP on transfers, calendars and Flex; no user-visible benefit. |
| **E** | **OSM-first data pipeline (OSM + curated jeepney/UV inventory + versioned fare config) → generated GTFS → MOTIS → BFF → React/Vite PWA (MapLibre, Google-like sheet)** | **Chosen.** Only path that is licensed, local-first, community-contributable and honest about coverage; every tier has a documented upgrade path. |

## 7. Architecture

```
┌────────────────────────────── apps/web (PWA) ──────────────────────────────┐
│ React 19 + TypeScript + Vite + Tailwind + MapLibre GL JS + Lucide + Router │
│ Sheet-over-map UI (Option A) · saved trips/offline cache · About-data      │
└───────────────▲───────────────────────────────────────────▲────────────────┘
                │ HTTPS/JSON (fetch)                        │ tiles (raster/vector)
┌───────────────┴──────────── services/api — BFF ───────────┴────────────────┐
│ Node 22 + Fastify + TypeScript                                             │
│ /search (geocode provider switch) · /plan (fan-out + fare + provenance)    │
│ /sources (registry) · /reports (crowd reports, phase 4) · cache + rate-lim │
└───────────────▲───────────────────────────────────────────▲────────────────┘
                │ MOTIS REST /plan, /geocode                │ static JSON
┌───────────────┴──────── services/routing — MOTIS 2.11.4 ──┴───────────────┐
│ Docker image · OSM PH PBF (walk graph) + generated GTFS (rails/bus/jeepney)│
│ RAPTOR-family multimodal planning · optional Fares v2                      │
└───────────────▲────────────────────────────────────────────────────────────┘
                │ generated GTFS zip + fare config + provenance registry
┌───────────────┴──────── pipelines/ (Python 3.12) ─────────────────────────┐
│ 01 fetch OSM  → 02 build GTFS (osm2gtfs + curated inventory)              │
│ 03 fares (validated YAML → GTFS fares/JSON) → 04 validate → 05 publish    │
└───────────────▲────────────────────────────────────────────────────────────┘
                │ raw sources + versioned config
        data/ (provenance registry, fares, curated routes, snapshots)
```

**Local-first runtime (v1):** `docker compose up` → `web:5173`, `api:8787`, `routing:8080`. Data build is a separate one-shot command (`npm run data:build`) so the daily dev loop is fast. No cloud accounts required.

**Why a BFF at all:** fares must be computed by *us* from the curated matrix (GTFS/ MOTIS fare support is secondary), routes must be re-ranked by fare for the "Cheapest" chip, and every response must be enriched with `sources[]`. The BFF also gives us one place to swap MOTIS→OTP later without touching the frontend.

## 8. Data layer

### 8.1 Source register (the "where it comes from" requirement)

Every row is machine-readable in `data/provenance/sources.yaml`; the API returns the subset used by each itinerary.

| ID | Dataset | Publisher | URL | Licence | Used for | Must display |
|---|---|---|---|---|---|---|
| `osm` | OpenStreetMap PH extract | OSM contributors / Geofabrik | https://download.geofabrik.de/asia/philippines.html | ODbL 1.0 | roads, stops, rail stations, walking graph, bus/ferry/shape-taxi relations | `© OpenStreetMap contributors` + ODbL 1.0, linked |
| `osm-wiki-jeepney` | Metro Manila Jeepney & UV Express routes (wiki) | OSM Wiki contributors | https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes | CC BY-SA 2.0 | jeepney/UV route inventory (T1xx–T4xx, 1xx–4xx, C/M/N) | `Route inventory from OSM Wiki (CC BY-SA 2.0)` — kept as a separate attributed data file |
| `ltfrb-fares` | LTFRB fare matrix (transcribed) | LTFRB | https://ltfrb.gov.ph | Gov't public info (no redistribution grant) | fare amounts | `Fares per LTFRB matrix effective 28 Sept 2026` — date visible in UI |
| `rail-fares` | LRTA / LRMC / MRT-3 fares & status | LRTA, LRMC, DOTr–MRT3 | https://www.lrta.gov.ph/tickets-and-fares/ · https://lrmc.ph | Gov't public info | rail fares, schedules, service status | operator name + last-checked date |
| `mmda-ferry` | Pasig River Ferry (12 stations) | MMDA | https://mmda.gov.ph | Gov't public info | ferry line, free fare | `Pasig River Ferry — MMDA` + "subject to unannounced suspension" |
| `psgc` | Philippine Standard Geographic Code | PSA | https://psa.gov.ph/classification/psgc | PSA open data (attribution) | region/province/LGU/barangay joins | `Administrative boundaries: PSA (PSGC)` + release used |
| `photon` | Photon geocoder | komoot (OSM data) | https://photon.komoot.io/ | ODbL data; best-effort service | typeahead search | `Geocoding by Photon (komoot) — data © OpenStreetMap contributors, ODbL` |
| `openfreemap` | OpenFreeMap vector tiles | OpenFreeMap | https://openfreemap.org | MIT; OSM data ODbL | base map | `© OpenFreeMap © OpenMapTiles · Data from OpenStreetMap` |
| `motis` | MOTIS routing engine | MOTIS project | https://github.com/motis-project/motis | MIT | routing (software, not data) | About-data "software" section |
| `crowd-reports` | BiyaHey! community reports | BiyaHey! contributors | — | CC0 (contributors agree) | crowd reports (phase 4) | `Community reports — BiyaHey!` + count/last-updated |

**Never shipped:** Sakay/PTAC 2014 GTFS, BusMaps, any feed without a reuse grant. Recorded in `data/provenance/PROVENANCE_NOTES.md` as internal-only exploration.

### 8.2 Pipeline stages (`pipelines/`)

1. **01-osm**: download Geofabrik PH PBF (pin the snapshot date in the provenance registry), extract NCR+belt bbox with `osmium`, count route relations per mode → coverage report.
2. **02-gtfs-build**: build GTFS from OSM (`osm2gtfs` for route relations: rail, bus, ferry, existing `share_taxi`) + curated inventory file for jeepneys/UV:
   - route → `route_type=3` (bus) for jeepney; extended `1501` reserved where share-taxi semantics are needed; headway-based trips (peak 3–5 min, off-peak 8–10 min) — model frequency, not timetable;
   - stops: use OSM `public_transport=platform` within ~200–400 m of the curated corridor, fall back to synthesised "landmark stops" from the curated via-road list;
   - shapes: OSM relation geometry when it exists; otherwise assemble from curated via-road way IDs via `osmnx`/`pyroutelib3`;
   - terminal + interchange footpaths: explicit walk links with penalty (e.g. Taft↔EDSA, Cubao↔Araneta-Cubao).
3. **03-fares**: load `data/fares/*.yaml` (versioned by `effective_from`, `source_url`, `matrix_id`) → generate `fare_attributes.txt`/`fare_rules.txt` **and** a JSON fare model for the BFF (BFF is the source of truth; GTFS fares are best-effort for engine-level filtering).
4. **04-validate**: `gtfs-validator` (MobilityData) must pass with 0 errors; JSON-Schema validation of all `data/**` files (BetterGov's own convention); fare golden tests; coverage thresholds.
5. **05-publish**: write `data/snapshots/gtfs-<date>.zip` (ODbL notice file inside), regenerate the provenance manifest (dataset → version/date/sha256), print a report.

**Output licensing:** the generated GTFS is a derived database of ODbL content → publish it under **ODbL 1.0** with attribution. The wiki-derived inventory stays a separate file in-repo; its CC BY-SA attribution is carried in the provenance registry, and any GTFS derived *from that file* states it. This mixing is a known risk (§15); mitigation is to migrate route inventory into OSM route relations over time.

### 8.3 Fare model (hand-curated, date-stamped)

`{mode, class, base_fare, base_km, per_km, bands[], effective_from, effective_to?, source_url, matrix_id, free_ride_override?: boolean}`

Current values to encode (verified 2026-11-01): traditional jeepney ₱14 first 4 km + ₱2.00/km; modern jeepney ₱17 + ₱2.40; city bus ordinary ₱15/5 km + ₱2.49, aircon ₱18 + ₱2.98; provincial bus ordinary ₱12 + ₱2.20; UV Express ₱2.60/km (traditional) / ₱3.00 (modern); P2P +15% on route fare; LRT-2/MRT-3 50% off (MRT-3 ₱6–14); LRT-1 ₱16.25 + ₱1.47/km (excluded from the discount); Pasig River Ferry free; free-ride service-contracting routes (rail-hub jeepneys + EDSA Carousel) → `override: 0` flagged per route, with a "free-ride status unverified" caveat where applicable.

**Rules:** never fetch fares at runtime; CI warns when `effective_from` is > 6 months old; every displayed fare carries its effectivity date.

## 9. Routing layer

- **Engine:** MOTIS 2.11.4 (MIT) in Docker, importing OSM PBF + generated GTFS. Config committed in `services/routing/config/`; data dir is gitignored.
- **Alternatives:** request a wider itinerary set from MOTIS (e.g. `numItineraries: 8`), compute fares + provenance per itinerary in the BFF, then present the best 3–5 and let the chips (`Recommended` / `Cheapest` / `Fewest transfers` / `Less walking`) filter/re-rank the same set. No fake "alternative" duplication.
- **Transfers:** walking transfers and interchanges are real legs with walk penalties; informal transfer modelled as a distinct leg type with a configurable buffer (default 5 min) in the BFF.
- **Escape hatch:** the BFF's engine adapter exposes the same `/plan` DTO for MOTIS and OTP 2.10, so scaling later is a config change.
- **No real-time:** no GTFS-RT exists for PH (verified negative). v1 shows "expected wait" from synthesised headways; anything else would be fake.

## 10. API contract (BFF, v1)

| Endpoint | Purpose | Response highlights |
|---|---|---|
| `GET /search?q=` | typeahead (provider switch: MOTIS geocoder → Photon) | grouped `stops[] / landmarks[] / routes[] / saved[]`, each with `source_id`, locality (PSGC), distance |
| `POST /plan` | origin/destination (+ time, preferences) → itineraries | `itineraries[]`: `duration`, `fare {amount, currency, effective_from, source_id, breakdown[]}`, `transfers`, `walk_distance`, `legs[]` (mode, from/to stop, signage, landmark hint, `source_id`), `sources[]` |
| `GET /sources` | provenance registry for the About-data screen | `id, name, publisher, url, licence_spdx, licence_url, coverage, last_checked, attribution_text, used_for` |
| `POST /reports` | crowd reports (phase 4) | `{type, route_id, location, note, reported_at}` |
| `GET /health` | stack liveness | versions of api/motis/dataset manifest |

`POST /plan` request DTO is versioned (`v: 1`). Every itinerary's `sources[]` is computed from the datasets actually used for that itinerary — the UI cannot drift from the data.

## 11. UX/UI specification (Option A — Google-Maps-faithful sheet)

**Container:** full-bleed MapLibre map; floating 48 dp search pill; persistent **standard bottom sheet** over the live map (never modal), 3 detents (peek/half/expanded), drag handle, back collapses one detent. Map padding recomputed per detent so the selected route is never occluded.

**Screens (v1):**
1. **Map / Home** — search pill ("Saan ka pupunta?"), locate FAB, recent trips + "Nearby sakayan" in peek sheet, L1 map micro-credit.
2. **Search + autocomplete** — single field, Taglish/English, debounced 250 ms, grouped results (Stops · Landmarks · Routes · Saved), offline empty state.
3. **Route options** — 3–5 cards sorted by ETA; card = big ETA · arrival · **₱ fare** · transfers · walk · mode chips · provenance chip; filter chips; loading skeletons after 300 ms; tap highlights corresponding polyline.
4. **Trip detail** — header (total time, fare, Start/Save), vertical leg timeline (walk/jeep/bus/rail/trike/wait), each ride leg expandable to stops with the alight stop pinned, board leg shows **signage to look for** and a **landmark line**; footer = fare breakdown with source link + effectivity date.
5. **Saved / recent** — offline-capable; saves a fare snapshot + dataset version so an old trip can say "fare changed since you saved this"; 30-day recent expiry.
6. **Data sources (About data)** — the provenance screen.

**Provenance, three layers, zero clutter:** L1 micro-credit on map corner and route-card footer chip; L2 dataset list (one card each: name, publisher, SPDX licence, last updated, coverage, confidence); L3 detail sheet (full licence + source URL + report-an-issue). Every string generated from the same `sources[]` array.

**Design tokens:** Material-3-style tonal surfaces, 8 dp grid, 48 dp touch targets, one brand accent; transit line colours come only from feed `route_color` and are always paired with the line name (never colour alone). Typography: 5-role type scale; 200% text resize must survive.

**Accessibility (WCAG 2.2 AA):** 4.5:1 text / 3:1 non-text contrast, 24×24 px minimum targets, drag alternative for the sheet, status announcements for "route updated".

**Performance budgets (CI-enforced):** cold start → interactive map ≤ 3 s on a 4 GB Android-Go-class device; first route-screen payload ≤ 250 KB gzip; plan p95 ≤ 1.5 s server-side; ≤ 40 map tiles per viewport; `saveData` → raster fallback.

**Localisation:** Taglish string set for the top ~60 strings ("Saan papunta?", "Sakay", "Baba", "Lipat", "Bayad"), correct language tagging for screen readers; English fallback toggle.

## 12. Delivery phases

| Phase | Scope | Acceptance | Est. |
|---|---|---|---|
| **0. Foundations** | repo init (MIT), BetterGov conventions (Node 22/npm 10, Conventional Commits, branch prefixes, PR template + AI disclosure), docker-compose skeleton, JSON-Schema layout, CI (lint/typecheck/test) | `npm run dev` boots the three services (routing may be a stub); CI green | 3–5 d |
| **1. Data spine** *(critical path)* | pipelines 01–05; OSM NCR extract; GTFS from rails/bus/ferry + curated jeepney inventory seed; fare config + engine; provenance registry; MOTIS import; coverage report | GTFS passes `gtfs-validator` with 0 errors; MOTIS plans 10 golden NCR trips; coverage report produced | 15–20 d |
| **2. PWA MVP** | Option A UI: all 6 screens, search, route options, trip detail, provenance L1–L3, saved/offline, Taglish strings, perf budgets | Success criteria §3 items 2–6 pass; Lighthouse PWA installable | 15–20 d |
| **3. Curation & coverage** | route-inventory merge workflow (YAML + OSM contribution guidance), fare update runbook, staleness CI, community "report wrong data" | coverage ≥ 60%; a second contributor can add a route end-to-end from docs only | 10–15 d |
| **4. Crowd reports** | reports API + storage (SQLite locally), light auth, moderation queue, report UI + stale/alert states | a report appears within 1 s for other clients; moderation + abuse path documented | 8–12 d |
| **5. Real-time research spike** | find any GTFS-RT/AVL source or cooperative arrangement; if none, ship headway-based "expected wait" labelling | written go/no-go with sources; no fake live data shipped | 5 d |
| **6. Public beta & BetterGov** | deploy web (static) + router host, uptime/backup, CONTRIBUTING/CODE_OF_CONDUCT, data-licence page, funding/adoption note | public URL, data licence page live, BetterGov maintainers contacted | 5–10 d |

Phases 3–4 can run in parallel by different contributors once phase 1's schemas are frozen. "Engineer-days" assume one contributor; the plan will split work into reviewable chunks.

## 13. Testing and verification

- **Unit:** fare engine golden cases (2026 matrix, rail discount, LRT-1 exclusion, free-ride override, stale-matrix warning); provenance assembly; leg/landmark formatting.
- **Data:** `gtfs-validator` 0 errors; JSON-Schema validation for every `data/**` file; route inventory lint (required fields, terminal geometry sanity); coverage threshold test.
- **Contract:** BFF route DTO snapshot tests; OpenAPI schema check against a mocked MOTIS; `/plan` response must include `sources[]` and fare `effective_from` (fails CI otherwise).
- **E2E (Playwright):** search → route options → trip detail → save → offline reload → About-data.
- **Golden routes:** 10 documented NCR trips with expected modes/transfers/fares; a change that breaks them is reviewed deliberately.
- **Perf:** Lighthouse CI budgets; API p95 in a small k6/locust script.
- **Licence gate:** CI job asserts the generated GTFS contains the ODbL notice and that no blocked dataset id appears in artifacts.

## 14. Repository layout and conventions (BetterGov-aligned)

```
biyahey/
├─ apps/web/            # React 19 + TS + Vite + Tailwind + MapLibre PWA
├─ services/api/        # Fastify BFF (TS)
├─ services/routing/    # MOTIS docker + config (no custom engine code)
├─ pipelines/           # Python 3.12 data build (01…05)
├─ data/                # provenance/, fares/, routes/ (curated), snapshots/ (gitignored)
├─ docs/                # research/, superpowers/specs, plans, runbooks
├─ .github/workflows/   # ci.yml, data.yml, licence-gate.yml
├─ docker-compose.yml   # web, api, routing, (postgres/sqlite later)
├─ CONTRIBUTING.md · CODE_OF_CONDUCT.md · AI_DISCLOSURE.md
└─ LICENSE (MIT for code; data licences in data/LICENSE-DATA.md)
```

Conventions copied from BetterGov: Node 22+, npm 10+, conventional commits, `feature/ fix/ docs/` branches, PR template with **AI-assisted work disclosure**, JSON-Schema validation of data files, Discord/email contribution channels. Code **MIT**; derived transit DB **ODbL**; docs CC BY 4.0.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Jeepney network data is thin** (76 OSM relations nationally) | Core promise weak if routes missing | Curated inventory seeded from OSM Wiki + community mapping; publish coverage % and "unmapped corridor" states; phase 3 prioritises the busiest corridors |
| **Fare transcription errors** (no machine-readable source; LTFRB blocks scripts) | Users misled about money | Versioned config + source URL + effectivity date + CI staleness warning + "report wrong fare" link; re-verify against MC before beta |
| **Licence mixing** (ODbL derived DB + CC BY-SA wiki inventory) | Cannot ship publicly / legal exposure | Keep wiki-derived file separate and attributed; publish derived GTFS as ODbL; migrate inventory into OSM over time; no Sakay/BusMaps redistribution |
| **MOTIS fare/ranking limits** | "Cheapest" chip weak | BFF owns fare model and re-ranking; GTFS fares only best-effort; OTP swap path |
| **Free-ride programme status unverified** | Overcharging riders on subsidised routes | Route-level `override: 0` flags with verified dates + explicit caveat; recheck before beta |
| **No real-time data** | User expectation gap | Say "expected wait" not "live"; phase 5 spike; never fabricate |
| **Geocoder quota/ToS** | Search outage | Provider-switch interface + caching + self-host path (MOTIS geocoder/Photon/Nominatim) |
| **Local dev on Windows** | Onboarding friction | Docker-only runtime; document WSL2/Docker Desktop; no host-specific tooling |
| **Scope creep (all features at once)** | Nothing ships | Phase gates above; real-time and crowd reports explicitly deferred to later phases |
| **BetterGov adoption uncertain** | Effort wasted on wrong conventions | Build standalone-but-adoptable; mirror their stack/commits; contact maintainers at phase 6 instead of blocking |

## 16. Assumptions to confirm (or I will proceed as stated)

1. **Repo home:** standalone `BiyaHey!` repo under the user's GitHub account, MIT, structured to be adoptable by bettergovph — not an official BetterGov project until maintainers accept.
2. **Name:** "BiyaHey!" is the working product name; repo slug `biyahey`.
3. **Language:** Taglish-first UI strings with English fallback; docs in English.
4. **v1 transport modes:** jeepney, city/provincial bus, UV Express, P2P, MRT-3/LRT-1/LRT-2, Pasig River Ferry, walking. **Not** modelled: tricycles, PNR (suspended), taxis.
5. **No user accounts in v1**; saved trips live in local storage; crowd reports (phase 4) use a lightweight anonymous device id + rate limiting, with accounts deferred.
6. **Data freshness target:** monthly OSM snapshot + fare config revision whenever a matrix MC changes.

## Appendix A — Attribution strings (copy-paste, from research §9)

`© OpenStreetMap contributors — data available under the Open Database License (ODbL) 1.0` · `Route inventory derived from OpenStreetMap Wiki (CC BY-SA 2.0)` · `Fares per LTFRB fare matrix effective 28 September 2026` · `LRT-2/MRT-3 50% discount effective 23 March 2026` · `LRT-1 fares effective 2 April 2025 (LRMC)` · `Pasig River Ferry — Metropolitan Manila Development Authority (MMDA)` · `Geocoding by Photon (komoot) — data © OpenStreetMap contributors, ODbL` · `© OpenFreeMap © OpenMapTiles · Data from OpenStreetMap` · `Administrative boundaries: Philippine Statistics Authority (PSGC)` · `Community reports — BiyaHey! contributors` · `MOTIS routing engine (MIT) — software, not data`

*(Ratified ruling R21, 2026-11-01: `rail-fares` joins its two strings with ` · `; the `motis` software attribution is added here so the registry and the spec agree.)*

## Appendix B — Decisions deferred to the implementation plan

- Exact GTFS generation tool choice between `osm2gtfs` and a bespoke builder (decided after a phase-1 spike on the NCR extract).
- Shape generation approach for curated corridors (OSM way-ID stitching vs `osmnx` shortest path).
- Whether the BFF stores crowd reports in SQLite (local) or defers the schema to phase 4.
- Whether MOTIS's built-in tile server replaces OpenFreeMap in local dev (both allowed; OpenFreeMap is the default).
