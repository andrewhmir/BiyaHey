# Philippines Public Transit Datasets — Research Note

**Prepared:** 2026-11-01 · **Scope:** MVP for a Metro Manila + commuter-belt route planner · **Method:** web search + direct fetch, all claims URL-backed
**Confidence legend:** `verified` = fetched the page and read the claim · `likely` = strong secondary evidence, primary unreachable · `unverified` = could not confirm

**Headline finding:** there is **no official, maintained GTFS or GTFS-RT feed for the Philippines**. Every feed in circulation is a 2013–2020 community artifact. Meanwhile the fares and service patterns that an MVP must encode changed **twice in 2026** (§3), so fares must be a hand-maintained config table, not scraped data.

---

## 1. OpenStreetMap public-transport data (the real backbone)

| # | Source | URL | Coverage · modes | Format · contents · access | License | Freshness | Conf |
|---|---|---|---|---|---|---|---|
| 1.1 | Geofabrik Philippines extract | https://download.geofabrik.de/asia/philippines.html | Whole PH; all OSM tags incl. `route=*`, `public_transport=*` | `.osm.pbf` 584 MB, `.shp.zip` 1.3 GB, `.gpkg.zip` 1.4 GB, `.osc.gz` diffs; bulk download | **ODbL 1.0** | Data to **2026-10-31T21:23Z**, file rebuilt ~6 h before check | verified |
| 1.2 | Overpass API (FOSSGIS) | https://overpass-api.de/api/interpreter · UI: https://overpass-turbo.eu/ | Whole PH, live | JSON/XML/CSV query output; HTTP API, no key | ODbL 1.0 + FOSSGIS usage terms | Live mirror | verified |
| 1.3 | Taginfo PH (Geofabrik instance) | https://taginfo.geofabrik.de/asia:philippines/ | Whole PH; live tag statistics | JSON API; useful for coverage audits | — (stats only) | `data_until` **2026-10-31T21:22:57Z** | verified |
| 1.4 | OSM Wiki — Metro Manila jeepney & UV Express routes | https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes | NCR + Bulacan/Rizal/Cavite/Laguna | Wiki tables: **T1xx–T4xx** traditional jeepney, **1xx–4xx** modern jeepney, **Cxxx/Mxxx/Nxxx** UV Express; route number, name, road-by-road description, operator co-op, length, LTFRB MC reference | CC BY-SA 2.0 (wiki text) | Edited through **2025** ("As of 2025…" `network=LTFRB National Capital Region`) | verified |
| 1.5 | Third-party OSM coverage audit | https://www.allanninal.dev/projects/transit-analysis.html | Metro Manila bbox 14.35–14.80 N / 120.90–121.15 E | CSV + method writeup; counts by mode and by LGU | not stated | Page checked 2026-11-01 | verified |
| 1.6 | OSM copyright / attribution | https://www.openstreetmap.org/copyright | — | Attribution text | ODbL 1.0 | current | verified |

**Live PTv2 coverage in PH (taginfo, 2026-10-31)** — the numbers an MVP should plan around:

| Tag | Count | Reading |
|---|---|---|
| `type=route` relations (all) | **2,851** | total route inventory |
| `route=bus` | **1,425** | best-mapped road mode |
| `route=ferry` | **1,243** | mostly small boat/outrigger crossings |
| `route=share_taxi` | **76** | **this is how jeepneys are tagged** — the binding constraint |
| `route=train` / `light_rail` / `subway` | 14 / 6 / 2 | rail is effectively complete |
| `route=jeepney` (non-standard) | 1 | tagging is not settled |
| `public_transport:version=2` | 1,930 of 1,940 tagged (**99.5%**) | PTv2 schema is adopted where relations exist |
| `public_transport=platform` / `stop_position` / `station` / `stop_area` | 9,550 / 2,326 / 1,554 / 514 | stop-level data is far richer than route-level |

**Quality notes & known gaps**
- **Jeepney routes are the hole.** 76 `share_taxi` relations nationwide vs tens of thousands of real jeepney routes. A tighter Metro Manila bbox audit found **803 bus vs 26 jeepney** route relations and **49 rail stations** (all named) — a ~31:1 skew in the wrong direction (1.5). Treat every road-mode count as a **floor**.
- **Tagging is inconsistent**: `share_taxi` vs `route=jeepney` vs plain `route=bus`; `network=LTFRB National Capital Region` only standardized in 2025 (1.4). Operator tag present on 90% of bus but 42% of jeepney relations (1.5).
- **Stops ≫ routes**: 9,550 platforms exist, but most jeepney stops are unnamed or word-of-mouth; wiki guidance says 200 m spacing in busy areas / 400 m residential, "only a few stops are marked" (1.4).
- **No fares, no headways, no ridership** in OSM. `dotr.gov.ph` returns 403 to scripts, so operator stats must be transcribed by hand (1.5).
- **Query hygiene warning** (1.5): `area["name"="San Juan"]` unions six same-named boundaries worldwide and silently inflates counts — resolve LGUs by relation id, not name.
- **Practical read**: OSM gives you *geometry and stop points* for rail (excellent), buses (good in NCR), and jeepneys (thin). It does **not** give you a jeepney network. Plan a hybrid, not an OSM-only build.

---

## 2. GTFS / GTFS-RT for the Philippines

| # | Feed | Owner / publisher | URL | Coverage · modes | Format · contents · access | License | Freshness | Conf |
|---|---|---|---|---|---|---|---|---|
| 2.1 | sakayph/gtfs ("Philippine GTFS Data") | Sakay.ph (private), derived from 2014 DOTC Philippine Transit App Challenge data | https://github.com/sakayph/gtfs · zip: https://github.com/sakayph/gtfs/archive/master.zip | Metro Manila; jeepney, bus, rail, ferry (6 agencies incl. LTFRB, LRTA, MRT Corp, PNR, MARINA, The Fort Bus) | GTFS zip; routes, stops, trips, shapes. **No fare_attributes in practice.** Bulk download | **No licence file** — README silent; upstream was a govt hackathon release. Treat as **all-rights-reserved / unclear** | Service ends **2020-06-30**; last commit years old | verified |
| 2.2 | Mobility Database `mdb-1106` "LTFRB GTFS Schedule Feed" | MobilityData (cataloguer), **not** LTFRB | https://mobilitydatabase.org/feeds/gtfs/mdb-1106 | Philippines (Manila bbox fails to generate) | GTFS zip, 0.94 MB; bulk download + API | Catalog terms; underlying feed = 2.1 | Latest capture **2024-06-07**, **service date range empty**; 3 validator errors | verified |
| 2.3 | Mobility Database `mdb-1269` "Philippines GTFS Schedule Feed" | MobilityData, from legacy TransitFeeds `philippines/71` | https://mobilitydatabase.org/feeds/gtfs/mdb-1269 | Philippines | GTFS zip 1.64 MB | as above | Service dates **2013-11-29 → 2014-05-29** — dead | verified |
| 2.4 | Transitland feed `f-wdw-manila` | Interline Technologies (cataloguer) | https://www.transit.land/data/feeds/f-wdw-manila | Metro Manila; 6 operators | GTFS via REST/GraphQL API + archive; 3 versions archived | Interline ToS + upstream | Last successful fetch **2020-07-28**; active version service 2013-06-17 → **2020-06-30** | verified |
| 2.5 | BusMaps "metro-manila" corrected GTFS | BusMaps (commercial) | https://busmaps.com/en/philippines/feedlist | Metro Manila; 241 agencies, **698 routes, 5,736 stops** | GTFS; "corrected" (0 errors / 244 warnings); **paid, on request** | Commercial — not redistributable | Validated **2026-10-23**; dates re-stamped to 2027-12-31 | verified |
| 2.6 | TUMI Datahub "GTFS: Manila" | TUMI / GIZ | https://hub.tumidata.org/dataset/gtfs-manila | Metro Manila | GTFS zip | not stated | unknown | **unverified** (fetch failed) |
| 2.7 | LTFRB official GTFS / GTFS-RT | LTFRB / DOTr | https://ltfrb.gov.ph | — | — | — | **none found** | **unverified (negative)** |

**Quality notes & known gaps**
- **2.2 is mislabelled by the ecosystem, not by LTFRB.** Its producer URL is literally `github.com/sakayph/gtfs`; the "LTFRB" attribution is the agency list inside a 2020 community feed. Do not cite it as an official government release.
- **2.5 is a re-dated copy of the 2014 hackathon feed**, not fresh survey work — 698 routes and 5,736 stops match the PTAC corpus. Useful as a paid shortcut, dangerous as a source of truth; it also carries `stop too far from shape` (113) and `stops match shape out of order` (59) warnings.
- **No GTFS-RT exists for any PH operator** — no trip updates, no vehicle positions, no service alerts. Real-time arrival is out of scope for v1; use scheduled/headway estimates.
- **Fares are absent from every feed.** GTFS `fare_attributes.txt`/`fare_rules.txt` would encode distance bands — you must build this yourself from §3.
- **Licensing is the blocker, not quality.** 2.1–2.4 have no clear reuse grant. Redistributing a derived feed publicly is legally unresolved; internal use for a prototype is the safer read.

---

## 3. Fares — CURRENT levels (verified 2026-11-01)

Two 2026 events govern this: a **50% rail discount from 23 March 2026**, and a **PUV fare matrix effective 28 September 2026** after a suspension was lifted.

| Mode | Current fare | Effective | Source | Conf |
|---|---|---|---|---|
| Traditional jeepney | **₱14** first 4 km, **+₱2.00/km** | 2026-09-28 | https://www.philstar.com/business/2026/09/27/2559277/jeepney-fares-p14-starting-sept-28-buses-taxis-tnvs-also-hike-rates/amp/ | verified |
| Modern jeepney | **₱17** first 4 km, **+₱2.40/km** | 2026-09-28 | same | verified |
| City bus — ordinary | **₱15** first 5 km, **+₱2.49/km** | 2026-09-28 | same | verified |
| City bus — aircon | **₱18** first 5 km, **+₱2.98/km** | 2026-09-28 | same | verified |
| Provincial bus — ordinary | **₱12** first 5 km, **+₱2.20/km** | 2026-09-28 | same | verified |
| Provincial bus — aircon / deluxe / super deluxe / luxury | +₱2.45 / ₱2.60 / ₱2.70 / **₱3.35** per km | 2026-09-28 | same | verified |
| UV Express (traditional / modern) | **₱2.60 / ₱3.00 per km** (provisional) | 2026-09-28 | same | verified |
| P2P bus | **+15%** on each route's existing fare | 2026-09-28 | same | verified |
| Taxi flagdown (regular / Silver / Gold) | ₱65 / ₱80 / ₱95 | 2026-09-28 | same | verified |
| **LRT-2 & MRT-3** | **50% off published fare**, across the board — MRT-3 published ₱13–28 → **charged ₱6–14** | 2026-03-23 | https://www.lrta.gov.ph/tickets-and-fares/ · range: https://parkinganph.com/transit/mrt-line-guide | verified (discount) / likely (band values) |
| **LRT-1** | **₱16.25 boarding + ₱1.47/km** — *not* covered by the 50% discount | 2025-04-02 | https://lrmc.ph/2025/02/18/new-lrt-1-fares-effective-2-april-2025/ | verified |
| Pasig River Ferry | **free** | current | https://tribune.net.ph/2026/06/12/mmda-eyes-expansion-of-pasig-river-ferry | verified |
| Selected jeepney routes at rail hubs + **EDSA Carousel** | **free** under the service-contracting programme (~₱1 B budget) | from 2026-04-15 | https://www.philstar.com/headlines/2026/04/08/2519405/free-rides-metro-manila-begin-april-15 | verified (start) / **unverified** (still running Nov 2026) |

**Quality notes & known gaps**
- The **fare-free overlay is real and is a product problem**: a naive ₱14 jeepney calc is wrong on subsidised routes. Model fare as `{matrix_fare, override: 0 | null}` with a route-level flag.
- **LRT-1 is deliberately excluded** from the 50% rail discount — do not apply it uniformly across the three lines.
- LTFRB's own fare pages (`https://ltfrb.gov.ph/fare-rates/`) **403 to scripts**; the matrix above is from press coverage of the LTFRB advisory, not the PDF. Re-verify against the poster/MC before shipping prices.
- Jeopardy: fare matrices in PH change by **memorandum circular**, often with a suspension-then-lift sequence (exactly what happened Sept 2026). Store `effective_from`/`effective_to` and a source URL per row.
- **No machine-readable fare file exists** — no CSV, no API. This is hand-curated data.

---

## 4. Rail & ferry operators — status, schedules, coordinates

| # | Operator / line | URL | Status 2026-11 | Stations / extent | Schedule & fares | Conf |
|---|---|---|---|---|---|---|
| 4.1 | **LRT-1** (LRMC) | https://lrmc.ph · https://www.lrta.gov.ph/lrta-route-map/ | Operating; Cavite Ext. Phase 1 opened Nov 2024 | **25 stations** (Baclaran–Dr. Santos); Phase 2 to Niyog/Bacoor slipped to ~2031 per PPP Center | ₱16.25 + ₱1.47/km; timetable not published as data | verified (fare) / likely (station count) |
| 4.2 | **LRT-2** (LRTA) | https://www.lrta.gov.ph/tickets-and-fares/ · https://www.lrta.gov.ph/train-operating-schedule/ | Operating; West Extension to Divisoria under construction | **13 stations**, Recto–Antipolo | 50% discount active; stations open **04:50 daily**; per-station closing times published as an image | verified |
| 4.3 | **MRT-3** (DOTr–MRT3) | https://dotrmrt3.gov.ph/ · https://mrt3.com/index.php/menu-fare-tickets.html | Operating; extended weekday hours made permanent | **13 stations**, 16.9 km, North Ave–Taft; ~30 min end-to-end | Published ₱13–28 → charged ₱6–14; peak headway 3.5 min; last trains **22:30** (North Ave) / **23:09** (Taft) weekdays | verified (LRTA discount) / likely (band + headway detail) |
| 4.4 | **PNR Metro Commuter** | https://pnr.gov.ph · https://www.railwaygazette.com/urban/2024/04/08/manila-passenger-services-suspended-to-accelerate-commuter-rail-construction/ | **SUSPENDED** since April 2024 for NSCR construction; ~5-year closure, return targeted late 2028–2029 | Tutuban–Alabang and Alabang–Calamba closed | n/a — do not model as an available mode | verified |
| 4.5 | **Pasig River Ferry** (MMDA) | https://tribune.net.ph/2026/06/12/mmda-eyes-expansion-of-pasig-river-ferry · https://mmda.gov.ph | Operating, **free**; suspended 2026-05-19 for garbage/repairs, since resumed; expansion + e-ferries planned | **12 stations**: Pinagbuhatan, Kalawaan, San Joaquin (Pasig); Guadalupe, Valenzuela (Makati); Hulo (Mandaluyong); Lambingan, Sta. Ana, PUP, Quinta, Lawton, Escolta (Manila) | ~1,500 pax/day pre-fleet-shortage; no GTFS, no published timetable | verified (status/stations) / unverified (Nov 2026 ops) |
| 4.6 | Beep / AFCS card | https://beep.com.ph/where-to-use/ · https://beep.com.ph/terms-and-conditions/ | Works on LRT-1/2, MRT-3, some buses/ferry | — | ₱30 card + ₱14 min load; transfers are **separate taps**, no integrated fare | verified |

**Quality notes & known gaps**
- **Stop coordinates are easiest from OSM**, not operators: 49 named rail stations in the metro bbox (all named, 100% — §1.5) plus `public_transport=station` 1,554 nationally. LRTA also publishes an inter-station **distance table** (https://www.lrta.gov.ph/distance-between-stations/) — the right input for a distance-based fare engine, but it is a web table, not a file (**unverified contents**).
- **No operator publishes GTFS.** Schedules exist as images, PDFs, or Facebook posts.
- **Interchange is not modelled anywhere**: Taft↔EDSA and Cubao↔Araneta-Cubao are street-level walks requiring a second tap. A router must encode them as pedestrian links with a walk penalty.
- **PNR's absence is a trap** — many blog posts and older maps still show the commuter line. Filter it out explicitly.

---

## 5. Other route / POI datasets

| # | Source | Owner | URL | Coverage · modes | Format · contents | License | Freshness | Conf |
|---|---|---|---|---|---|---|---|---|
| 5.1 | data.gov.ph (Open Data Philippines) | Open Data Philippines Task Force | https://data.gov.ph | National | CKAN-style portal; agencies' CSVs/PDFs, incl. some LTFRB/DOTr | **"free and without restriction"** subject to **attribution to the publishing agency**; per-dataset licences override | varies by agency | verified (portal) / unverified (a specific transit dataset) |
| 5.2 | LTFRB site | LTFRB | https://ltfrb.gov.ph | National | Franchise lists, fare advisories, MCs — **PDF/JPEG**, no data files | Gov't public info; no explicit open licence | continuous | verified |
| 5.3 | LPTRP / route plans | LGUs (with DILG/LTFRB) | e.g. https://mayoyao.gov.ph/wp-content/uploads/2025/05/LPTRP-2021-2025_Mayoyao.pdf | Per-LGU | **Local Public Transport Route Plan** PDFs — the closest thing to an official route inventory | LGU terms; usually unspecified | per LGU | verified (that LPTRPs exist) / unverified (a central index) |
| 5.4 | Project LigTas routes | Project LigTas (civic tech) | https://projectligtas.com/routes | Metro Manila | Web route browser | not stated | unknown | **unverified** |
| 5.5 | Kaggle | various | https://www.kaggle.com | — | **No maintained PH jeepney/bus route dataset found** | — | — | **unverified (negative)** |
| 5.6 | GitHub code/feed search | — | https://github.com/sakayph · https://github.com/BenLorenzo/gtfs | Metro Manila | Forks + derivatives of the same 2014 corpus | none stated | stale | verified |
| 5.7 | Academic — UP NCTS | UP National Center for Transportation Studies | https://ncts.upd.edu.ph | National | Journal papers, theses; aggregate statistics, not route geometry | academic | — | **unverified** |
| 5.8 | Wikipedia / Wikimedia | volunteers | https://en.wikipedia.org/wiki/LRT_Line_1_(Metro_Manila) | Line-level | Station lists, lengths, opening dates | CC BY-SA 4.0 | current | likely |

**Quality notes & known gaps**
- **5.1 is a portal, not a transit dataset.** No consolidated jeepney route file exists there; agencies publish PDFs. Search is JS-driven and not fetchable by script.
- **No Kaggle or academic source gives route geometry.** Every published "PH jeepney dataset" traces back to the same 2014 DOTC/PTAC corpus (5.6) — assume shared lineage and shared staleness.
- **LPTRPs (5.3) are the untapped official source**: they contain franchised route lists per city, but only as PDFs, published inconsistently, with no national index. Manual extraction per LGU is the only route.
- **Tricycles have essentially no data** anywhere — 1 stray `route=Tricycle` relation nationally. Do not promise tricycle routing.

---

## 6. Geocoding, base maps, and administrative boundaries

| # | Source | URL | Coverage | Format · access | Terms / licence | Conf |
|---|---|---|---|---|---|---|
| 6.1 | **Nominatim** (OSM) | https://nominatim.openstreetmap.org · policy: https://operations.osmfoundation.org/policies/nominatim/ | Global, incl. PH | JSON/GeoJSON search + reverse; HTTP API | **Max 1 req/s**, valid Referer/User-Agent, **no autocomplete**, no bulk/systematic queries, results must be cached, **must be able to switch provider without an app update**; ODbL | verified |
| 6.2 | **Photon** (komoot) | https://photon.komoot.io/ | Global, incl. PH | GeoJSON; typeahead-friendly search + reverse | "use for your project, be fair — extensive usage throttled", **no availability guarantee**; OSM data → ODbL | verified |
| 6.3 | **Pelias** | https://pelias.io | Self-host | Open-source geocoder (Elasticsearch); run your own | MIT (code) + ODbL (data) | likely |
| 6.4 | **MapTiler** | https://www.maptiler.com/license/maps/ | Global | Vector/raster tiles, geocoding API, SDKs | Commercial; attribution required unless a plan removes it; OSM ODbL underlying | verified |
| 6.5 | **PSGC** (Phil. Standard Geographic Code) | https://psa.gov.ph/classification/psgc | National: 17 regions → provinces → cities/municipalities → barangays | Web lookup; PSGC updates published quarterly; XLSX/CSV downloads behind Cloudflare | PSA open data; attribution expected | verified (page exists) / **unverified** (bulk download) |
| 6.6 | **OSM admin boundaries** | https://download.geofabrik.de/asia/philippines.html | NCR + all LGUs/barangays | PBF/GPKG; `boundary=administrative` | ODbL 1.0 | verified |
| 6.7 | Philippine addressing | — | — | **No national address-point dataset.** OSM has partial `addr:*`; barangay-level is the realistic granularity | — | **unverified (negative)** |

**Quality notes & known gaps**
- **Do not ship client-side Nominatim autocomplete** — explicitly forbidden by policy (6.1). For typeahead use **Photon** (built for it) or a paid provider; for geocoding at build time use a self-hosted Nominatim or MapTiler.
- **PSGC is the join key** for everything administrative (LGU names, region codes, route-endpoint normalisation), but there is no clean JSON API — plan to snapshot it and diff quarterly.
- **Address quality in PH is poor**; practically every consumer app geocodes to *landmark + barangay*, not street number. Build place search around POIs (malls, terminals, stations) rather than addresses.
- **Boundary resolution is a known footgun** — match LGUs by PSGC/relation id, never by name (§1, the San Juan bug).

---

## 7. Government terms that affect redistribution

| Source | What the terms actually say | Implication for BiyaHey! | Conf |
|---|---|---|---|
| **data.gov.ph** | "Unless otherwise indicated… datasets… are offered **free and without restriction**. However, **proper attribution must be credited to the publishing government agency**." Per-dataset licences override; agencies retain version control and are the only guarantors of quality. | Safe to reuse and redistribute **with agency attribution**; but read each dataset's own licence field, and take no warranty. | verified (policy text mirrored at https://dataportals.org/portal/data-gov-ph/) |
| **DOTr / LTFRB** | Public information; **no open licence, no API, no bulk export**; fare MCs and franchise lists published as PDFs. Sites return **403 to non-browser clients**. | You may cite/report fares; you may **not** assume a redistribution right for scraped PDFs. Transcribe facts (fare amounts, route names) rather than mirroring documents. | verified (403s observed) |
| **LGU / LPTRP data** | No standard licence; each LGU sets its own; most are silent. | Treat as **all-rights-reserved** unless the PDF states otherwise. Permission request per LGU. | verified (silence observed) |
| **OSM / Geofabrik** | **ODbL 1.0** — share-alike applies to derived databases. | If you publish a derived transit database, it must be ODbL. Serving a map/tiles requires "© OpenStreetMap contributors". | verified |
| **Mobility Database / Transitland** | Catalogue terms; the underlying feeds have **no reuse grant** (Sakay, PTAC). | Catalogue entries are free to read; the *feeds* are not clearly licensed. Don't republish them. | verified |
| **BusMaps** | Commercial, per-request licence. | Paid; not redistributable. Fine as a stopgap if budget exists. | verified |

---

## 8. Ranked shortlist — build the MVP on these

| Rank | Source | Exact URL | Why |
|---|---|---|---|
| **1** | **OSM PH extract + Overpass** | https://download.geofabrik.de/asia/philippines.html · https://overpass-api.de/api/interpreter | The only source with **current, nationwide, licensed** rail stations, stop points, road network and partial bus routes. ODbL is unambiguous. 2,851 route relations, 99.5% PTv2, data 1 day old. Use for geometry, stops, walking network, and the rail graph. |
| **2** | **Hand-curated route + fare table seeded from the OSM Wiki jeepney/UV list** | https://wiki.openstreetmap.org/wiki/Metro_Manila/Jeepney_and_UV_Express_routes | Gives you **T1xx–T4xx / 1xx–4xx / C-M-N UV Express route numbers, endpoints, via-roads, operator co-ops and lengths** for free — the exact taxonomy LTFRB uses. This is the fastest path to a jeepney network without a GTFS. |
| **3** | **LTFRB fare matrix (as transcribed config) + LRTA/LRMC operator pages** | https://www.philstar.com/business/2026/09/27/2559277/jeepney-fares-p14-starting-sept-28-buses-taxis-tnvs-also-hike-rates/amp/ · https://www.lrta.gov.ph/tickets-and-fares/ · https://lrmc.ph/2025/02/18/new-lrt-1-fares-effective-2-april-2025/ | Fares are the product's trust anchor and **changed twice in 2026**; no dataset carries them. Encode the Sept-2026 matrix + the March-2026 50% rail discount + free-ride overrides. |
| **4** | **Photon (typeahead) + self-hosted/PSGC-backed geocoder** | https://photon.komoot.io/ · https://psa.gov.ph/classification/psgc | Nominatim's policy forbids autocomplete; Photon exists for it and needs no key. Join everything to PSGC so LGU/barangay names normalise. |
| **5** | **Pasig River Ferry + MRT-3/LRT status pages as a small manual "service status" layer** | https://tribune.net.ph/2026/06/12/mmda-eyes-expansion-of-pasig-river-ferry · https://dotrmrt3.gov.ph/ | The ferry is free, operating and completely absent from every dataset; a 12-station hand-entered line is a differentiator and takes an afternoon. |

**Deliberately not in the top 5:** sakay GTFS and its derivatives (2020 dead, unclear licence) — usable as a one-off shape donor for a prototype, not as a foundation. PNR — suspended until ~2028.

---

## 9. Data provenance requirements (what the app must display)

| If you use… | You must display |
|---|---|
| **OpenStreetMap data** (Geofabrik extract, Overpass, OSM stops/shapes) | `© OpenStreetMap contributors` — linked to https://www.openstreetmap.org/copyright — plus `Data available under the Open Database License (ODbL) 1.0`. If you publish a derived **database**, it must also be ODbL. |
| **Nominatim** | OSM attribution above **and** a note that geocoding uses the OSMF Nominatim service; you must identify your app in the User-Agent/Referer, keep ≤1 req/s, and be able to swap providers without a client update. |
| **Photon** | `Geocoding by Photon (komoot) — data © OpenStreetMap contributors, ODbL`. State that the service is best-effort with no availability guarantee. |
| **MapTiler** | `© MapTiler © OpenStreetMap contributors` per your plan tier; do not strip attribution unless the plan explicitly grants it. |
| **LTFRB / DOTr fare matrix** | `Fares per LTFRB fare matrix effective 28 September 2026` (and `LRT-2/MRT-3 50% discount effective 23 March 2026`), with the effectivity date **shown in the UI**, not just in a legal page. |
| **LRTA / LRMC / DOTr–MRT3 schedule or fare data** | `Schedule and fares: Light Rail Transit Authority / Light Rail Manila Corporation / DOTr–MRT3`, with the date you last checked. |
| **MMDA Pasig River Ferry** | `Pasig River Ferry Service — Metropolitan Manila Development Authority (MMDA)`, noted as free and subject to unannounced suspension. |
| **PSGC** | `Administrative boundaries: Philippine Statistics Authority (PSGC)`, with the PSGC release/quarter used. |
| **data.gov.ph agency dataset** | Attribution to the **publishing agency by name** (e.g. `Source: Land Transportation Franchising and Regulatory Board, via data.gov.ph`) — the portal's own condition of use. |
| **OSM Wiki route list** (if you transcribe T-numbers/en DP) | `Route inventory derived from OpenStreetMap Wiki, CC BY-SA 2.0` — and because CC BY-SA is share-alike, keep it in a separate attributed data file rather than merging into an ODbL table. |
| **Sakay / PTAC-derived GTFS** | Nothing is granted — either obtain permission or do not ship it. If used internally only, record the provenance in an internal DATA_SOURCES file. |

**Non-negotiable UI requirements:** a persistent `About data` screen listing every source above with its licence and last-checked date; a per-route `source` field surfaced on the route detail sheet; and an `effective_from` stamp on every fare shown.

---

## 10. What remains unverified — verify before launch

1. Whether the **free-ride service-contracting programme** (from 2026-04-15) is still funded in Nov 2026, and which specific routes it covers — needed to avoid overcharging.
2. **Pasig River Ferry operating status** in Nov 2026 (last confirmed operating June 2026; suspended May 2026 for garbage).
3. The **LRT-1 end-to-end peso fare** under the ₱16.25 + ₱1.47/km scheme (formula verified, band table not).
4. **MRT-3 / LRT-2 published fare bands** from the operator PDFs (₱13–28 for MRT-3 is secondary-sourced).
5. **LTFRB MC numbers** behind the Sept 2026 matrix — needed for a defensible citation.
6. Whether any **LGU (Makati, Quezon City, Pasay) publishes route data** — Makati's ArcGIS server returned a jeepney-routes layer (https://securedmaps.makati.gov.ph/arcgis/rest/services/Points/Makati_Residents2013/MapServer/5) but the layer's currency and licence are **unverified**.
7. **PSGC bulk download** — the PSA site is Cloudflare-blocked to scripts; confirm the XLSX/CSV endpoint manually.
8. Whether **LRT-1 Cavite Extension Phase 2** has opened (slipped to ~2031 per PPP Center, but check for a 2026 update).
