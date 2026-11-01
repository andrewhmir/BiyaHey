# Routing & Map Stack — BiyaHey! (PH multimodal commuter app)

Research date **2026-11-01**. Versions/prices as published on that date. Read-only research: nothing installed, nothing changed except this file.
Legend: **[U]** = unverified / could not confirm from a primary source.

## 0. Bottom line

1. **No AGPL/GPL blocker.** Every serious OSS engine is permissive-ish: OTP is **LGPL-3.0+**, MOTIS **MIT**, GraphHopper **Apache-2.0**, Valhalla **MIT**. Hosting unmodified is fine; LGPL only bites if you *modify and distribute* OTP itself.
2. **The routing engine is the easy part. The data is the blocker** — there is no current, authoritative, city-wide jeepney/tricycle GTFS for Metro Manila. The known feed is the 2014-era DOTC/"Philippine Transit App Challenge" GTFS ([BenLorenzo/gtfs](https://github.com/BenLorenzo/gtfs)); an LTFRB feed is listed on Mobility Database ([mdb-1106](https://mobilitydatabase.org/feeds/gtfs/mdb-1106)) but its coverage/currency is **[U]**.
3. **Google Maps is contractually closed to this design**: Google's ToS forbids using Google Maps Core Services "with or near a non-Google Map" — i.e. a Google basemap with your own RAPTOR route line drawn on it is exactly the prohibited case ([ToS §3.2.3(e)](https://cloud.google.com/maps-platform/terms), [Service Terms §4.2](https://cloud.google.com/maps-platform/terms/maps-service-terms)).
4. **MVP pick: MOTIS + MapLibre + OpenFreeMap + Hetzner CX33 ≈ €9–15/mo.** Scalable pick: OTP 2.10 cluster behind a load balancer, or MOTIS sharded per region.

## 1. Open-source multimodal routing engines

### 1a. Capability, licence, inputs

| Engine (ver) | Licence | Required inputs | Jeepney as bus | Tricycle as custom mode | Walking transfers | Fare calc |
|---|---|---|---|---|---|---|
| **OpenTripPlanner 2.10.0** ([docs](https://docs.opentripplanner.org/en/latest/), [release](https://github.com/opentripplanner/OpenTripPlanner/releases/tag/v2.10.0)) | LGPL-3.0-or-later ([LICENSE](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/LICENSE)) | GTFS + OSM PBF (+ optional DEM), GraphQL API | Yes — `BUS`/`COACH` modes map to GTFS `route_type` ([RoutingModes](https://docs.opentripplanner.org/en/latest/RoutingModes/)) | Yes — `FLEXIBLE` mode covers GTFS-Flex / on-demand; also `TAXI` ([RoutingModes](https://docs.opentripplanner.org/en/latest/RoutingModes/)) | Yes, via OSM street graph + transfer generation | GTFS Fares v1 and v2, but in **sandbox**, v2 experimental ([Fares](https://docs.opentripplanner.org/en/latest/sandbox/Fares/)) |
| **MOTIS 2.11.4** ([repo](https://github.com/motis-project/motis), [release](https://github.com/motis-project/motis/releases/tag/v2.11.4)) | MIT ([LICENSE](https://github.com/motis-project/motis/blob/master/LICENSE)) | OSM PBF + one or more GTFS/NeTEx; GTFS-RT/SIRI; GBFS | Yes — GTFS routes | Yes — GTFS-Flex + Fares v2 named as supported inputs (README) | Yes | GTFS Fares v2 supported as an input format (README) |
| **GraphHopper** (`reader-gtfs` module) ([README](https://github.com/graphhopper/graphhopper/blob/master/reader-gtfs/README.md)) | Apache-2.0 ([LICENSE.txt](https://github.com/graphhopper/graphhopper/blob/master/LICENSE.txt)) | OSM PBF + GTFS; time-expanded graph with BOARD/TRANSFER/STOP_ENTER edges | Yes (as GTFS trips) | Only as GTFS trips — no DRT/flex concept documented | Yes (walk network) | Not documented **[U]** |
| **Valhalla** ([docs](https://valhalla.github.io/valhalla/)) | MIT ([COPYING](https://github.com/valhalla/valhalla/blob/master/COPYING)) | OSM PBF; optional GTFS; tiled graph | Yes — GTFS trips via multimodal costing | Not documented **[U]** | Yes | Not documented; no GTFS fare model surfaced **[U]** |
| **Custom RAPTOR/A\*** over GTFS | Yours | GTFS + OSM (or just stop coordinates) | You define it | You define it | You implement footpaths | You implement it |
| **"raptor-ph"** | — | — | — | — | — | — |

**"raptor-ph": no such project found.** Targeted searches returned unrelated "RAPTOR" security tooling and PH raptor-bird articles. Treat as non-existent **[U]**.

### 1b. Ops reality

| Engine | RAM / CPU | Deploy difficulty | Maturity & known deployments |
|---|---|---|---|
| OTP 2.x | **<1 GB to >100 GB**; Finland ~10 GB, Germany 95 GB; single-thread perf matters, scales with cores ([System Requirements](https://docs.opentripplanner.org/en/latest/System-Requirements/)) | Low: one shaded JAR + GTFS + OSM ([Getting OTP](https://docs.opentripplanner.org/en/latest/Getting-OTP/)) | Highest. Entur (Norway) >20 req/s; Digitransit (Finland); MTA NY; SEPTA; MBTA; TriMet ~40k plans/weekday ([Deployments](https://docs.opentripplanner.org/en/latest/Deployments/)) |
| MOTIS 2.x | "Low memory usage… planet-sized deployments on affordable hardware" (README); one year of timetable ≈ one month of RAM (README) | Low: `motis config` → `motis import` → `motis server` (README) | High and rising; powers Transitous global instance ([transitous.org](https://transitous.org/api/)) |
| GraphHopper PT | Demo needs `-Xmx8g` for Brandenburg (README) | Medium–high: Maven build, separate `reader-gtfs` module, not the default server | Mature for road routing; PT is a side module — GraphHopper's commercial product is road routing **[U]** for PT support |
| Valhalla | Tiled, "small memory footprint", region extracts, offline-capable ([home](https://valhalla.github.io/valhalla/)) | Medium: `valhalla_build_tiles` pipeline, C++ toolchain or Docker | Mature; FOSSGIS public demo ([valhalla.openstreetmap.de](https://valhalla.openstreetmap.de)) |

### 1c. RAPTOR landscape

- RAPTOR = round-based public-transit routing, Delling/Pajor/Werneck 2012 ([paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf), cited in the [OTP Bibliography](https://docs.opentripplanner.org/en/latest/Bibliography/)).
- **OTP2 = Multi-criteria Range Raptor** for the transit segment, A\* (Tung–Chew heuristic) for access/egress — a ready-made reference architecture if you build your own ([Bibliography](https://docs.opentripplanner.org/en/latest/Bibliography/)).
- MOTIS is also RAPTOR-family; it advertises traffic-day bitsets so a full year of timetable costs barely more RAM than a month (README).
- **DIY estimate:** a minimal RAPTOR + GTFS loader + OSM walk graph + fare layer is realistically 4–10 engineer-weeks before you match OTP on transfers, calendar exceptions and Flex **[U]** (judgement, not a sourced figure).

### 1d. Recommendation

**(a) Low-budget MVP on a small VPS / free tier → MOTIS 2.11.4.** One 50 MB static binary on linux-amd64/arm64 ([release assets](https://github.com/motis-project/motis/releases/tag/v2.11.4)), MIT, low RAM, and it *also* ships geocoding and a tile server, which removes two vendors from the MVP. Runs on a 4 GB box (Hetzner CX23, €5.99) or Oracle's free 12 GB A1.

**(b) Scalable production → OTP 2.10.0.** It is the only engine here with a decade of tier-1 agency production evidence at >20 req/s, native GTFS-Fares handling, and a documented GraphQL contract ([Deployments](https://docs.opentripplanner.org/en/latest/Deployments/), [GTFS GraphQL API](https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/)). Budget 8–16 GB RAM for NCR-scale OSM+GTFS **[U]** (extrapolated from the Finland ~10 GB datapoint, not measured).

## 2. Modelling informal modes that GTFS handles badly

**Jeepney (linear route + terminals, hails anywhere).**
- Model as a normal GTFS `route` with `route_type=3` (Bus) or extended **700/704** (Bus / Local Bus) — Google's extended route-type table ([extended route types](https://developers.google.com/transit/gtfs/reference/extended-route-types)).
- Terminals = first/last `stop`; intermediate "landmark" stops = timepoints. Schedules are headway-based in reality, so synthesise `trips` at observed headways rather than pretending to a timetable (**common practice, [U]** in any spec).
- "Wave it down anywhere" is the gap: use GTFS `continuous_pickup` / `continuous_drop_off` and, where the vehicle really is hail-only, GTFS-Flex ([GTFS-Flex primer](https://n-catt.org/wp-content/uploads/2020/12/GTFS-Flex-1-pager.pdf), [gtfs.org reference](https://gtfs.org/documentation/schedule/reference/)). OTP exposes this only through its `FLEXIBLE` mode / Flex sandbox ([RoutingModes](https://docs.opentripplanner.org/en/latest/RoutingModes/), [Flex sandbox](https://docs.opentripplanner.org/en/latest/sandbox/Flex/)).

**Tricycle (no route, no schedule, per-barangay).** Two workable encodings:
1. **Flex / DRT**: `route_type` **715** "Demand and Response Bus Service" (extended table) or GTFS-Flex `location_groups` zones; OTP `FLEXIBLE` mode.
2. **Share-taxi semantics**: extended route type **1501** "Share Taxi Service" is defined for marshrutka/dolmuş — structurally the closest published analogue to a jeepney/tricycle corridor ([extended route types](https://developers.google.com/transit/gtfs/reference/extended-route-types)). Note Google marks 1501 as supported but 1500/1502–1507 as not.

**Known workarounds / precedents.**
- **Sakay / DOTC Metro Manila GTFS** — a real jeepney+bus+train GTFS built from the Philippine Transit App Challenge dataset ([BenLorenzo/gtfs](https://github.com/BenLorenzo/gtfs)). Best starting corpus; check licensing and staleness.
- **Crowdsourced jeepney mapping** in Metro Manila as a citizen-mapping response to missing official data ([Politecnico di Torino thesis](https://webthesis.biblio.polito.it/38890/1/tesi.pdf)).
- **Digital Matatus (Nairobi)** — the reference methodology for turning semi-formal minibus networks into GTFS with phones + students ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0966692315001878)).
- **World Bank GTFS pilots** in three Asian countries, incl. guidance on informal operators ([SAIIE proceedings](https://saiie.co.za/sites/default/files/2021-11/SAIIE28%20Proceedings.pdf)).
- **OSM-first**: map jeepney/tricycle corridors as OSM `route` relations, then generate GTFS from OSM. Avoids double data entry and keeps geometry routable. **[U]** for tooling maturity.

**Hard limits to plan around:** informal services have no unique vehicle IDs, no AVL, and no fixed stops, so GTFS-RT vehicle positions and "next jeepney in N min" are out of reach until you instrument drivers. Model frequency, not schedule.

## 3. Mapping & rendering

| Library | Licence | Billing model | Verdict |
|---|---|---|---|
| **MapLibre GL JS** (v6 line; MOTIS UI already runs maplibre-gl 6.11.1) | BSD-3-Clause ([LICENSE.txt](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)) | Free, bring your own tiles | **Pick this.** No vendor lock, works with every tile source below |
| **Mapbox GL JS v3** | Proprietary, account-metered; billed per **map load**, 50k free loads/mo, then paid tiers ([GL JS pricing](https://docs.mapbox.com/mapbox-gl-js/guides/pricing/), [pricing page](https://www.mapbox.com/pricing)) | Free ≤50k loads/mo | Only if you want Mapbox tiles + Mapbox tooling. Vanilla-JS engine, closed licence |
| **Google Maps JS API (Dynamic Maps)** | Google Maps Platform ToS; $200 credit **replaced** on 2025-03-01 by free calls per SKU — 10k Essentials, 5k Pro, 1k Enterprise per month ([pricing FAQ](https://mapsplatform.google.com/pricing/)) | Metered per map load / call | **Disqualified** for this product: ToS §3.2.3(e) bans use "with or near a non-Google Map" and §3.2.3(b) bans caching |

**Tile providers (all OSM-derived).**

| Provider | Free tier | Paid entry | Attribution | Notes |
|---|---|---|---|---|
| **OpenFreeMap** ([site](https://openfreemap.org/)) | Unlimited views/requests, no key, no registration | Donation/support plans | Required: "OpenFreeMap © OpenMapTiles, Data from OpenStreetMap"; auto-added by MapLibre | MIT, commercial use explicitly allowed; styles Positron/Bright/Liberty/Dark/Fiord; offline downloads capped at 3,000 tiles/50 MB per download |
| **Protomaps** ([site](https://protomaps.com/)) | Planet PMTiles file free to download & self-host | Hosted API free for **non-commercial**, commercial = GitHub Sponsor | OSM + Protomaps | Best "own your basemap" option: one file on S3/R2, HTTP range requests, no tile server |
| **MapTiler** ([pricing](https://www.maptiler.com/cloud/pricing/)) | Free: 5k map sessions, 1k search sessions, 100k API req/mo — **non-commercial only**, logo required | Flex **$30/mo**: 25k sessions, 3k search, 500k req; extra $2.50/1k sessions, $0.15/1k req | Required unless paid tier allows logo removal | Good street-map aesthetics out of the box |
| **Stadia Maps** ([pricing](https://stadiamaps.com/pricing/)) | Free: 200k credits/mo, **commercial not allowed** | Starter **$20/mo** 1M credits, commercial OK; Standard $80/mo 7.5M | Required | Credit system; vector tile = 1 credit |
| **OSM raster** `tile.openstreetmap.org` ([policy](https://operations.osmfoundation.org/policies/tiles/)) | Free | — | Required, visible, not hidden | **Not a production option:** no SLA, bulk download/offline banned, must cache ≥7 days, must send identifying User-Agent, must be able to switch provider without an app update |

**Styling "Google-Maps-like" legally.**
- What you may not do: use Google tiles/screenshots as assets, cache or re-serve Google content, imply Google affiliation, or (as a Google customer) build something that "re-creates" Google product features ([ToS §3.2.3(b),(c),(d)](https://cloud.google.com/maps-platform/terms)). Google's brand use is separately constrained by its Brand Terms ([linked from ToS §20](https://cloud.google.com/maps-platform/terms)).
- What you may do: build an *original* style on OSM-derived vector tiles and keep OSM attribution visible ([OSM copyright](https://www.openstreetmap.org/copyright), [attribution guidelines](https://wiki.osmfoundation.org/wiki/Licence/Attribution_Guidelines)). A "familiar-looking" map is a design choice, not a licence.
- Practical recipe (design guidance, not a legal claim): start from OpenFreeMap **Liberty** or Protomaps **light**, then — land `#F2EFE9`, water `#AADAFF`, motorways `#FFF3C4` with `#E0C97F` casing, minor roads pure white with 1 px grey casing, buildings `#E8E5E0` at z≥16 only; POI labels off below z15 and capped to ~6 categories at z16–18; Noto Sans / Roboto with 1.2 px white halo and `text-transform: none`; round line joins, no gradients. Hide OSM's default `landuse` clutter.

## 4. Geocoding / place search

| Option | Limits & terms | Cost | Fit |
|---|---|---|---|
| **Nominatim public** ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)) | **Max 1 req/s**; valid Referer/User-Agent; attribution; **autocomplete explicitly forbidden**; no systematic queries; must be able to switch provider without an app release; proxy + cache recommended | Free | Reverse geocoding and low-volume search only. **Cannot power typeahead** |
| **Photon (komoot)** ([site](https://photon.komoot.io/)) | "Use the API for your project, but please be fair — extensive usage will be throttled", no availability guarantee; runs on OSM data, supports typeahead, typo tolerance, reverse | Free | Best free **typeahead**. Cache aggressively, be ready to self-host |
| **Pelias self-host** ([pelias.io](https://pelias.io/)) | MIT; needs Elasticsearch 7/8 + API, Placeholder, PIP, libpostal, interpolation services | Infra only | Powerful, but ~6 services + ES for one city is overkill for MVP |
| **MapTiler geocoder** ([pricing](https://www.maptiler.com/cloud/pricing/)) | Free 1k search sessions/mo, non-commercial; Flex 3k sessions/mo then $2.50/1k | $0–30/mo | Clean, SLA-ish path once you pay |
| **MOTIS built-in geocoder** ([README](https://github.com/motis-project/motis)) | Multi-language address + stop-name completion, fuzzy matching, reverse geocoding, **bundled with the router** | Free | **Best MVP answer if you pick MOTIS** — one process, no third-party quota |
| **Nominatim self-host** ([install docs](https://nominatim.org/release-docs/latest/admin/Installation/)) | Your hardware, your rules | VPS RAM/disk | The correct long-term answer; OSM import is heavy |

**MVP recommendation:** MOTIS's built-in geocoder if MOTIS is the router. Otherwise Photon for typeahead + Nominatim public (≤1 req/s, cached) for reverse, with a provider-switch flag in config from day one — both policies require switchability ([Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [OSM tiles](https://operations.osmfoundation.org/policies/tiles/)).

## 5. Google Maps Platform legal constraints (current terms)

Primary sources: **[Google Maps Platform ToS](https://cloud.google.com/maps-platform/terms)** (last modified 2026-08-26 per page footer) and **[Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)**.

| Constraint | Clause | What it means for BiyaHey! |
|---|---|---|
| **No use with non-Google maps** | ToS **§3.2.3(e)**: "Customer will not use the Google Maps Core Services with or near a non-Google Map… (i) display or use Places content on a non-Google Map… (iii) link a Google Map to non-Google Maps Content or a non-Google Map" | **Fatal to the hybrid design.** Google basemap + your RAPTOR polyline = prohibited. Conversely you cannot show Google Directions results on MapLibre |
| Per-API restatement | Service Terms **§4.2** (Directions), **§6.2** (Geocoding), **§14.2** (Places): "Customer must not use Google Maps Content… in conjunction with a non-Google map" | Same, product by product |
| **No caching** | ToS **§3.2.3(b)**: "Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms" | You cannot build your own POI/geocode DB from Google |
| What little caching is allowed | Service Terms **§4.3** Directions: lat/lng max **30 consecutive days**. **§6.3.1** Geocoding lat/lng max 30 days; **§6.3.2** lat/lng/formatted_address/structured address may be kept **indefinitely but only per-End-User, only for that user's in-app display**, and never as a substitute for a new API call. **§3** allows caching `place_id` values | A shared, cross-user place cache is **not** permitted |
| **No scraping / no derived content** | ToS **§3.2.3(a)** (no pre-fetch, index, store, rehost, bulk download; no copying business names/addresses/reviews), **§3.2.3(c)** (no tracing roads, no creating content from Google Maps Content, no ML training on it) | Blocks building your own basemap or dataset from Google |
| **No re-creating Google products** | ToS **§3.2.3(d)**: product must "contain substantial, independent value… beyond the Google products or services" | A Google-Maps-clone UI on Google data is at risk |
| Attribution | ToS **§3.2.2(b)**: display all attribution Google provides or the Service Terms specify; "will not modify, obscure, or delete" | Keep Google logo/attribution intact if you ever ship Google |
| ToS/privacy flow-down | ToS **§3.2.2(a)**: app ToS must state it includes Google Maps features and link the Google Maps End User Additional Terms + Google Privacy Policy | Extra legal surface |
| End-user location | ToS **§4.4(c)(iii)**: no obtaining or caching end-user location without express, prior, revocable consent | Applies to any Google SDK build |
| Pricing baseline | Free monthly calls per SKU since 2025-03-01: **10k Essentials / 5k Pro / 1k Enterprise**; Dynamic Maps + Geocoding are Essentials-class. Subscriptions: Starter **$100/mo** (50k calls), Essentials **$275/mo** (100k), Pro **$1,200/mo** (250k) ([pricing](https://mapsplatform.google.com/pricing/)) | Even at 10k free map loads, a commuter app blows through it in days |

**Conclusion:** Google Maps Platform is viable **only** as an all-Google stack (Google basemap + Google Routes/Directions transit). It is not compatible with an OSM basemap, and not compatible with your own jeepney/tricycle routing. Choose one ecosystem; do not mix.

## 6. Deployment options and what they can actually host

| Option | Spec | Price | Can it host routing? |
|---|---|---|---|
| **Hetzner CX23** ([cloud](https://www.hetzner.com/cloud/cost-optimized/)) | 2 vCPU / 4 GB / 40 GB NVMe / 20 TB traffic | **€5.99/mo** excl. VAT | Yes — MOTIS comfortably; OTP tight for NCR. Listed "not available" at time of check — capacity rotates |
| **Hetzner CX33** | 4 vCPU / 8 GB / 80 GB NVMe | **€8.99/mo** | **Yes — the sweet spot.** OTP NCR or MOTIS + Postgres + app |
| **DigitalOcean Basic** ([pricing](https://www.digitalocean.com/pricing/droplets)) | 2 vCPU / 4 GB / 80 GB | **$24/mo** | Yes (MOTIS). 2 vCPU/2 GB $18; 4 vCPU/8 GB $48; 8 vCPU/16 GB $96 |
| **Fly.io** ([pricing](https://fly.io/pricing)) | `shared-cpu-1x` 256 MB → `performance-4x` 8 GB | **$2.19/mo** (256 MB) → **$132/mo** (8 GB); +$6/GB/mo | Only ≥2 GB (`performance-1x` $33/mo) for MOTIS. 256 MB is a toy: OTP keeps the whole graph in RAM |
| **Oracle Cloud Always Free** ([docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)) | **2 OCPU / 12 GB** Ampere A1 (arm64) + 200 GB block + 10 TB egress/mo | **$0** | **Yes — best free option.** Caveat: idle instances (95th-pct CPU <20%, net <20%, mem <20% over 7 days) **may be reclaimed**; arm64 build available for MOTIS |
| **Serverless (Cloud Run / Lambda / Workers)** | request-scoped, scale-to-zero | varies | **No** for the router. OTP "includes all the required data in memory" ([System Requirements](https://docs.opentripplanner.org/en/latest/System-Requirements/)) — every cold start would rebuild/load a multi-GB graph. Serverless is fine for the web app/BFF layer only |

## 7. Recommended MVP stack

| Component | Choice | Why | Cost |
|---|---|---|---|
| Transit data | Sakay/DOTC Metro Manila GTFS ([repo](https://github.com/BenLorenzo/gtfs)) + LTFRB feed if usable ([mdb-1106](https://mobilitydatabase.org/feeds/gtfs/mdb-1106)) + hand-digitised jeepney/tricycle corridors | Only public starting corpus; validate licence + currency **[U]** | $0 |
| Basemap data | OSM PBF, Geofabrik Philippines extract ([downloads](https://download.geofabrik.de/)) | Free, ODbL, routable street graph for walks/transfers | $0 |
| Routing engine | **MOTIS 2.11.4** ([release](https://github.com/motis-project/motis/releases/tag/v2.11.4)) | MIT, low RAM, GTFS + Flex + Fares v2, bundles geocoder **and** tile server | $0 |
| Routing API | MOTIS REST/JSON + OpenAPI ([spec](https://redocly.github.io/redoc/?url=https://raw.githubusercontent.com/motis-project/motis/refs/heads/master/openapi.yaml)) | Typed clients, no GraphQL learning curve for MVP | $0 |
| Map renderer | **MapLibre GL JS** ([docs](https://maplibre.org/maplibre-gl-js/docs/)) | BSD-3, no lock-in, MOTIS UI already uses it | $0 |
| Tiles | **OpenFreeMap** public instance ([site](https://openfreemap.org/)) → later self-host Protomaps PMTiles | Unlimited, no key, commercial OK, MIT | $0 (→ ~$1–5/mo storage) |
| Geocoding | **MOTIS built-in geocoder** (fallback: Photon for typeahead, Nominatim ≤1 req/s for reverse) | Avoids 2 vendors and their quota policies | $0 |
| Hosting | **Hetzner CX33** (4 vCPU / 8 GB) — or Oracle A1 free for staging | Headroom for OTP later; EU latency to PH ~200 ms, acceptable for search-not-navigation | **€8.99/mo** |
| Total | | | **≈ €9–15/mo** |

Upgrade path: swap MOTIS → **OTP 2.10.0** on 16 GB when you need GTFS-Fares-driven pricing, tier-1 API stability, or >20 req/s; keep MapLibre + OpenFreeMap unchanged so the frontend never moves.

## 8. What breaks at scale

- **RAM, not CPU.** OTP holds the full graph in memory (<1 GB to >100 GB); a multi-region PH expansion means a graph per region or one very large box ([System Requirements](https://docs.opentripplanner.org/en/latest/System-Requirements/)).
- **Graph rebuild downtime.** New GTFS → re-import. MOTIS separates `import` from `server`, so you can rebuild to a new directory and swap; OTP's graph build is minutes-to-hours and needs a blue/green pair **[U]** for exact timings.
- **Public free tiers fall over.** Nominatim is 1 req/s *per application*, autocomplete banned ([policy](https://operations.osmfoundation.org/policies/nominatim/)); Photon throttles "extensive usage" ([site](https://photon.komoot.io/)); OSM tiles have no SLA and ban offline/bulk ([policy](https://operations.osmfoundation.org/policies/tiles/)). Any of these becoming your critical path is a launch-day outage.
- **Transitous/MOTIS public API is not an option.** It is explicitly non-commercial and requires open-sourcing your code; >720 `/plan` requests per 24h needs coordination ([usage policy](https://transitous.org/api/)).
- **Tile bandwidth.** MapTiler/Stadia free tiers are non-commercial (5k sessions, 200k credits) and a commuter app with 5 screens/session eats them ([MapTiler](https://www.maptiler.com/cloud/pricing/), [Stadia](https://stadiamaps.com/pricing/)).
- **Informal-mode data decays weekly.** Route changes, terminal moves and new barangay services have no publisher. You need an editing surface + validation from day one; no engine fixes this.
- **No realtime.** No AVL on jeepneys/tricycles means GTFS-RT is theatre; you can only do scheduled-frequency estimates.

## 9. Hard blockers found

1. **Google basemap + own routing is contractually impossible** (ToS §3.2.3(e); Service Terms §4.2/§6.2/§14.2). Decide ecosystem before any UI work.
2. **No maintained PH-wide GTFS.** The credible corpus is the 2014 DOTC/"Transit App Challenge" data behind Sakay ([repo](https://github.com/BenLorenzo/gtfs)); the LTFRB Mobility Database entry's coverage and update cadence are **[U]**. Data acquisition, not engineering, is the critical path.
3. **Nominatim public explicitly forbids autocomplete** ([policy](https://operations.osmfoundation.org/policies/nominatim/)) — a search-as-you-type UI cannot legally use it. You need Photon or self-hosting.
4. **Free tiers are too small for OTP.** 512 MB–1 GB PaaS free tiers cannot hold an NCR graph; the realistic floor is 4 GB (MOTIS) / 8–16 GB (OTP). Oracle A1's 12 GB free tier works but carries an idle-reclamation clause ([docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)).
5. **Licence is *not* a blocker, but data is.** No AGPL anywhere in the shortlist (LGPL-3.0+ / MIT / Apache-2.0 / MIT). OSM's ODbL share-alike does attach to any derived database you publish ([OSM copyright](https://www.openstreetmap.org/copyright)).
