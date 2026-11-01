# BiyaHey! — UX/UI patterns & competitor research (PH commuter route planner)

**Date:** 2026-11-01 · **Scope:** read-only desk research; no packages installed, no app code touched.
**Question:** what should a Philippine commuter route planner look like so a Google Maps user feels at home, while doing the two things Google Maps does badly here — **fares** and **provenance** ("where does this data come from?").
**Confidence:** claims carry a URL. Anything I could not verify is tagged **[unverified]** and listed in §7. Pages that were JS-rendered or Cloudflare-blocked are marked as such where it matters.

---
## 0. Design stance (the five decisions that follow from this research)

1. **Copy Google Maps' *container*, not its content.** Sheet-over-map, one primary search field, route cards stacked by ETA — this is the familiar part. Fares, jeepney naming and provenance are where we differentiate (§1.1, §5.3, §5.7).
2. **Fare is a first-class field on the route card, not a detail-screen afterthought.** Nothing in the PH market surfaces an itemised, dated fare next to ETA ([Sakay.ph](https://en.wikipedia.org/wiki/Sakay.ph), [Moovit](https://en.wikipedia.org/wiki/Moovit) — neither documents fare on the card).
3. **Provenance is a badge + a screen, never a paragraph.** Precedent: [Transitous per-feed sources page](https://transitous.org/sources/) and [OSMF attribution rules](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).
4. **Budget for a 4 GB-RAM Android Go phone on a congested cell** — Android Go targets ≤4 GB RAM devices with data-saving defaults ([Wikipedia: Android Go](https://en.wikipedia.org/wiki/Android_Go)); PH median mobile download was 59.64 Mbps at end-2025 but 19.0 M people were still offline ([DataReportal Digital 2026: PH](https://datareportal.com/reports/digital-2026-philippines)).
5. **Never trust a single dataset to be complete.** Metro Manila's GTFS heritage is a 900+ route open dataset from a 2013 World Bank/AusAID programme ([Sakay.ph history](https://en.wikipedia.org/wiki/Sakay.ph)) — good, but partial and ageing. Assume 2–4 feeds stitched together, and say so in the UI.

---
## 1. Google Maps transit UI patterns

### 1.1 Search bar + bottom-sheet behaviour
- Google Maps moved directions to a **sheet-based layout on iPhone in March 2025**, explicitly to improve reachability ([9to5Google, 2025-03-07](https://9to5google.com/2025/03/07/google-maps-iphone-sheet-redesign/)). Android's directions overview was redesigned the same quarter, adding arrival time to the summary ([9to5Google, 2025-03-31](https://9to5google.com/2025/03/31/google-maps-directions-redesign/)).
- The bottom tab bar was cut to fewer tabs in 2024 ([9to5Google, 2024-05-16](https://9to5google.com/2024/05/16/new-google-maps-bottom-bar/)); Material You / M3 Expressive styling has been rolling across Google apps since ([9to5Google, 2025-04-29](https://9to5google.com/2025/04/29/google-apps-material-you/)).
- Material 3 defines three sheet types — **standard** (co-exists with map, non-blocking), **modal** (scrim, blocks), **expanding** (collapsed surface that grows into a full task) ([Material bottom sheets doc](https://raw.githubusercontent.com/material-components/material-components-flutter/develop/docs/components/bottom_sheets.md); overview: [m3.material.io/components/bottom-sheets](https://m3.material.io/components/bottom-sheets/overview)).
- **Behaviour to implement:** persistent *standard* sheet over a live map (never a modal for route list); 3 detents (peek ≈ 96–120 dp / half / expanded); drag handle always visible; map padding recomputed on every detent change so the selected route line is never under the sheet; sheet state survives rotation and process death; back gesture collapses one detent before popping the screen.

### 1.2 Route option cards (time / fare / transfers)
- Google's own long-standing pattern: each alternative is labelled with **estimated time**, transit alternatives are marked **"direct" or with a transfer count**, ride legs are drawn in the **operator's line colour**, and itinerary rows are colour-coded to separate riding from waiting ([Mobility Lab teardown of Google Maps transit directions](https://mobilitylab.org/research/transit/comparing-driving-to-transit-in-the-next-version-of-google-maps/)).
- **Card anatomy for BiyaHey:** `ETA (largest) · arrival time (secondary) · ₱fare (own token) · transfers ("1 sakay") · walk total · mode chips (jeep / bus / rail / trike) · "Best" or "Cheapest" chip`. One line of provenance ("Fare: LTFRB matrix · Routes: 3 feeds") goes in the card footer as a tappable chip (§5.7).
- Keep exactly one card visually emphasised; the rest at surface-container elevation. M3 expresses hierarchy through **tone-based surface containers**, not drop shadows ([M3 colour roles via Flutter `ColorScheme`](https://api.flutter.dev/flutter/material/ColorScheme-class.html)).

### 1.3 Step-by-step directions with leg icons
- Directions flows are documented in Google Maps Help ([support.google.com/maps/answer/144339](https://support.google.com/maps/answer/144339?hl=en)) — the page is JS-heavy and the step text did not survive fetching, so the exact microcopy is **[unverified]**.
- **Leg model to implement:** `walk → board → ride (n stops) → alight → transfer/wait → board …`. Each leg gets one icon (walk, jeep, bus, rail, trike, wait), a bold instruction line, and a secondary "landmark" line (§4.2). Ride legs expand to a stop list with the alight stop pinned.
- Keep leg icons **line-art at 24 dp inside 48 dp touch targets** — WCAG 2.2 requires a 24×24 CSS-px minimum target ([SC 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/)) and Material's own guidance is 48 dp.

### 1.4 Map controls
- Minimum set: **recenter/locate**, **zoom +/−** (hide on pinch-capable devices), **layers** (transit vs plain), **compass** when rotated. Desktop/tablet uses a side panel rather than a sheet — the 2013 desktop teardown shows the control panel and an "Options" pane separate from the map ([Mobility Lab](https://mobilitylab.org/research/transit/comparing-driving-to-transit-in-the-next-version-of-google-maps/)).
- **Web vs iOS/Android differences:** web = left panel + top-left search, no bottom sheet, hover states, keyboard-first; iOS = sheet with drag handle, safe-area insets, no back button (edge swipe); Android = sheet + system back + predictive back, Material ripple. M3's canonical list-detail layout is the right web/tablet answer ([m3.material.io canonical layouts](https://m3.material.io/foundations/layout/canonical-layouts)).

### 1.5 Colour tokens (Material palettes)
- M3 defines **45 colour roles** (primary / secondary / tertiary, each with container, `-Fixed`, `-Dim`, `on-` variants; plus neutral surfaces, error, outline, scrim, inverse roles) ([Flutter `ColorScheme` doc, which cites the M3 spec](https://api.flutter.dev/flutter/material/ColorScheme-class.html); spec: [m3.material.io colour roles](https://m3.material.io/styles/color/the-color-system/color-roles)).
- `on-` colours **must reach ≥4.5:1** against their container ([same doc](https://api.flutter.dev/flutter/material/ColorScheme-class.html)); WCAG 2.2 sets the same 4.5:1 for body text and 3:1 for large text ([SC 1.4.3](https://www.w3.org/TR/WCAG22/)).
- Generate the palette from a **seed** (`ColorScheme.fromSeed`) so BiyaHey brand → full tonal set, light + dark, and high-contrast variants ([Flutter `ColorScheme`](https://api.flutter.dev/flutter/material/ColorScheme-class.html)).
- **Do not** theme-ise transit line colours: they come from the feed (`route_color`), and they must keep **3:1 non-text contrast** against the map ([WCAG SC 1.4.11](https://www.w3.org/TR/WCAG22/)). Pair every line colour with the line name — colour alone may not carry meaning ([SC 1.4.1](https://www.w3.org/TR/WCAG22/)).

### 1.6 Typography
- M3 type scale = 5 roles (display, headline, title, body, label) × 3 sizes ([m3.material.io/styles/typography](https://m3.material.io/styles/typography/overview)). Specific px/line-height values on that page are **[unverified]** here because it is JS-rendered.
- Recommended mapping: `titleLarge` route headline · `titleMedium` ETA · `bodyMedium` leg text · `labelLarge` chips/buttons · `bodySmall` provenance. Support **200% text resize without loss** ([WCAG SC 1.4.4](https://www.w3.org/TR/WCAG22/)) and allow 1.3× line spacing ([SC 1.4.12](https://www.w3.org/TR/WCAG22/)).

---
## 2. Competitors and precedents for PH transit

| Product | What it is | Data source | Strengths | Gaps / weaknesses | Money | Status 2026 |
|---|---|---|---|---|---|---|
| **Sakay.ph** | Web + iOS/Android jeepney/bus/rail/ferry planner, Metro Manila + surrounds ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) | Government data + crowdsourced routes; descended from the 2013 Philippine Transit Information Service GTFS (900+ routes, AusAID/World Bank) ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) | Deepest PH route knowledge; LGU/operator deals (QCity Bus 2023, LRMC ikotMNL 2020); Good Design Award PH Gold 2022; 500k+ Android installs by May 2026 ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) | Ads-supported; Traincheck (MRT-3 crowding) discontinued when CCTV access ended; site returned Cloudflare 403 to this research pass, so live feature set is **[unverified]** ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) | Advertising (stated) ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) | Active ([Wikipedia](https://en.wikipedia.org/wiki/Sakay.ph)) |
| **Moovit** | Global journey planner + transit APIs, owned by Mobileye (Intel until 2022 IPO) ([Wikipedia](https://en.wikipedia.org/wiki/Moovit)) | Official operator data **plus** crowdsourcing; community editor since 2014 ([Wikipedia](https://en.wikipedia.org/wiki/Moovit)) | Crowd layer fills gaps where no open data exists; APIs power Uber/Lyft; Manila city page exists ([moovit Manila](https://moovitapp.com/index/en/public_transit-Manila-1022)) | Crowd data quality varies; PH jeepney/fare model not evident; page returned HTTP 202 with no readable content to this pass → coverage depth **[unverified]** ([Moovit Manila](https://moovitapp.com/index/en/public_transit-Manila-1022)) | Ads (location-based ad platform, 2022), B2B APIs ([Wikipedia](https://en.wikipedia.org/wiki/Moovit)) | Active ([Wikipedia](https://en.wikipedia.org/wiki/Moovit)) |
| **Google Maps Transit (Metro Manila)** | Transit mode inside Google Maps | Google's own + agency feeds; Google publishes **country-by-country** provider notices, but no Philippines provider entry appeared in the retrieved copy of its notices page ([Google Maps legal notices](https://www.google.com/help/legalnotices_maps/)) | Zero-install familiarity; best-in-class map/sheet UX | Fare not a modelled first-class field; provenance not exposed per route; jeepney routes/terminals thin — **coverage quality in Metro Manila is [unverified]** (no public audit found) ([Google Maps legal notices](https://www.google.com/help/legalnotices_maps/)) | Ads / platform | Active ([Google Maps Help](https://support.google.com/maps/answer/144339?hl=en)) |
| **Biyaheroes** | PH commuter platform "for and by commuters" ([Rappler](https://www.rappler.com/culture-desk/travel/biyaheroes-strives-make-travel-easier-filipinos/)) | [unverified] | Community/comms angle, Filipino branding | Feature set, funding and current status **[unverified]** ([Rappler](https://www.rappler.com/culture-desk/travel/biyaheroes-strives-make-travel-easier-filipinos/)) | [unverified] | [unverified] |
| **Juander** | A PH commute **concept/design** piece ([Creative Bananas](https://creativebananas.ph/the-juander-concept/)) | n/a | Useful local visual-language reference | Concept, not a shipping product ([Creative Bananas](https://creativebananas.ph/the-juander-concept/)) | n/a | Concept |
| **Komute / Komyut** | Community/OSS commute project on GitHub ([alasdiel/Komyut](https://github.com/alasdiel/Komyut)) | [unverified] | Confirms naming collision risk in PH commute apps | No verifiable shipped consumer product found; a consumer "Komute" app is **[unverified]** ([GitHub](https://github.com/alasdiel/Komyut)) | [unverified] | [unverified] |
| **Transit PH / transitph.app** | Domain with a launch record ([Website Launches](https://websitelaunches.com/site/transitph.app)) | [unverified] | — | Product, coverage and status **[unverified]** ([Website Launches](https://websitelaunches.com/site/transitph.app)) | [unverified] | [unverified] |
| **SmartTransit PH (academic)** | Android app for public-vehicle navigation, IEEE paper ([IEEE Xplore](https://xplorestaging.ieee.org/document/11442203)) | [unverified] | Evidence of academic interest in PUV navigation | Research prototype ([IEEE](https://xplorestaging.ieee.org/document/11442203)) | n/a | Research |

**Read-across for BiyaHey:** nobody in this set combines (a) fare-forward route cards, (b) per-dataset provenance, and (c) a Google-Maps-grade sheet UX. That triad is the wedge. Sakay.ph is the incumbent to beat on route depth; Google Maps is the incumbent to beat on familiarity — so match Google's interaction model exactly and out-specify it on fares and data honesty.

---
## 3. Open-source transit app UIs worth learning from

| Project | What it gives you | UI lesson to steal | Status |
|---|---|---|---|
| **Transitous** | Community-run, provider-neutral routing on open data with a FOSS engine, free API ([transitous.org](https://transitous.org/)) | Its **`/sources/` page** is the best provenance UI in transit: per feed → source domain, SPDX licence, operators, publisher, **"last updated" timestamp**, original + processed file links, and separate schedule vs realtime attribution ([transitous.org/sources](https://transitous.org/sources/)) | Active, 2026 events listed ([transitous.org](https://transitous.org/)) |
| **otp-ui** | React component library "which can be used to build trip planner webapps" ([GitHub](https://github.com/opentripplanner/otp-ui)) | Ready-made itinerary/leg/route-option components — a benchmark for leg-icon and card composition ([GitHub](https://github.com/opentripplanner/otp-ui)) | Active ([GitHub](https://github.com/opentripplanner/otp-ui)) |
| **Transportr** | Android client positioned as "Free Public Transport Assistant without Ads or Tracking" ([GitHub](https://github.com/grote/Transportr)) | A privacy/no-ads stance is a *positioning* feature, not just a policy — useful if BiyaHey monetises without ad clutter ([GitHub](https://github.com/grote/Transportr)) | Available via F-Droid ([IzzyOnDroid listing](https://apt.izzysoft.de/fdroid/index/apk/de.grobox.liberario)) |
| **OneBusAway** | OTSF suite: real-time vehicle locations, alerts, arrivals; iOS + Android + web + REST API ([OneBusAway developers](https://developer.onebusaway.org/about)) | Arrival-board clarity and alert surfacing; agency-owned deployment model ([OneBusAway](https://developer.onebusaway.org/about)) | Active, OTSF-governed ([OneBusAway](https://developer.onebusaway.org/about)) |
| **OpenTripPlanner (OTP2)** | LGPL multimodal planner built from GTFS + OSM, GraphQL APIs, realtime updaters ([OTP docs](https://docs.opentripplanner.org/en/latest/)) | Ships a configurable **Debug UI** and a documented frontends list — useful for *our* internal QA, not for riders ([OTP Debug UI config](https://docs.opentripplanner.org/en/latest/DebugUiConfiguration/), [OTP frontends](https://docs.opentripplanner.org/en/latest/Frontends/)) | Active, v2.10 on master ([OTP docs](https://docs.opentripplanner.org/en/latest/)) |
| **Citymapper** | Reference for polish and safety UX: Dec 2019 added a "main roads / avoid dimly-lit areas" choice between routes ([Wikipedia](https://en.wikipedia.org/wiki/Citymapper)) | **Safety as a route preference** — directly reusable for late-night PH commutes ([Wikipedia](https://en.wikipedia.org/wiki/Citymapper)) | Acquired by Via, March 2023 ([Wikipedia](https://en.wikipedia.org/wiki/Citymapper)); site live 2026-11-01 ([citymapper.com](https://citymapper.com/)) but 2026 product scope **[unverified]** |

---
## 4. PH-specific commuter UX needs

**4.1 Fare visibility.** LTFRB is the fare-matrix authority ([ltfrb.gov.ph](https://ltfrb.gov.ph/) — Cloudflare-blocked to this pass, so current matrix values are **[unverified]**). Treat fare as **versioned reference data**: `{mode, class, base_fare, base_km, per_km, effective_from, source_url, matrix_id}`. Show `₱` on the card, the effective date on the detail sheet, and a "Fare may have changed — check matrix" state when `effective_from` is older than ~6 months. Jeepney routes are regulated with fixed fares ([Wikipedia: Jeepney](https://en.wikipedia.org/wiki/Jeepney)), which is what makes a published matrix meaningful.

**4.2 Jeepney signage & landmarks as wayfinding.** Riders navigate by **route endpoints painted on the vehicle and by landmarks**, not street names — jeepney routes are endpoint-defined and regulated ([Wikipedia: Jeepney](https://en.wikipedia.org/wiki/Jeepney)). No PH-specific study quantifying landmark-first wayfinding was found in this pass → **[unverified]**, validate with 5–8 rider interviews. Design implication regardless: every instruction line carries a **secondary landmark string** ("baba sa may Jollibee, bago mag-overpass"), and the board leg shows the **signage text to look for** ("Look for: NOVENA–BACLARAN").

**4.3 Informal-mode transfers.** Walking transfers between a jeepney drop-off and a rail station are often informal (no terminal geometry, no schedules). Model a leg type `informal_transfer` with: walk distance, "no fixed schedule — jeepneys leave when full" **[unverified]** as a general claim about dispatch practice, and a buffer slider ("allow 5/10/15 min").

**4.4 Low-end Android + slow/unstable data (performance budgets).** Android Go targets ≤4 GB RAM devices with Data Saver on by default ([Wikipedia: Android Go](https://en.wikipedia.org/wiki/Android_Go)); PH: 137 M mobile connections, 98.0 M internet users, 19.0 M still offline, median mobile download 59.64 Mbps (end-2025) ([DataReportal 2026 PH](https://datareportal.com/reports/digital-2026-philippines)). Median speed is fine — **variance and congestion** are the problem, so budget for the p90, not the median. Budgets are the recommended mechanism ([web.dev: Performance budgets 101](https://web.dev/articles/performance-budgets-101)):

| Budget | Target (MVP) |
|---|---|
| Cold start → interactive map | ≤ 3.0 s on a 4 GB Android Go device |
| JS/asset payload, first route screen | ≤ 250 KB gzipped (web) / ≤ 8 MB APK |
| Route query p95 (server) | ≤ 1.5 s; UI shows skeleton cards after 300 ms |
| Map tile budget | ≤ 40 tiles per viewport; raster fallback when `saveData` |
| Frame budget | 60 fps sheet drag; no jank on 4 detents |

**4.5 Offline behaviour.** Cache last 20 searched routes + saved trips + the fare matrix + stop/landmark text. Offline route *recompute* is out of scope for MVP; show "Saved route (no live data)" with a **last-updated stamp** — the same stamp pattern Transitous uses per feed ([transitous.org/sources](https://transitous.org/sources/)). Never show a stale ETA without a staleness marker.

**4.6 Taglish localisation.** Riders code-switch between Tagalog and English ([Wikipedia: Taglish](https://en.wikipedia.org/wiki/Taglish)). Do **not** machine-translate UI strings wholesale: define a Taglish string set for the ~60 highest-frequency strings ("Saan papunta?", "Sakay", "Baba", "Lipat", "Bayad"), keep numbers/units Latin, and tag language changes correctly for screen readers ([WCAG SC 3.1.2 Language of Parts](https://www.w3.org/TR/WCAG22/)). Prefer **redundant entry avoidance** — do not re-ask origin/destination across screens ([SC 3.3.7](https://www.w3.org/TR/WCAG22/)).

**4.7 Accessibility (WCAG 2.2 AA).** WCAG 2.2 became a W3C Recommendation on 12 Dec 2024 ([W3C](https://www.w3.org/TR/WCAG22/)). Concrete obligations for this app: 4.5:1 text contrast ([1.4.3](https://www.w3.org/TR/WCAG22/)), 3:1 non-text contrast for map lines/icons ([1.4.11](https://www.w3.org/TR/WCAG22/)), colour never the sole channel ([1.4.1](https://www.w3.org/TR/WCAG22/)), 24×24 minimum targets ([2.5.8](https://www.w3.org/TR/WCAG22/)), drag alternatives for the sheet ([2.5.7 Dragging Movements](https://www.w3.org/TR/WCAG22/)), 200% text resize ([1.4.4](https://www.w3.org/TR/WCAG22/)), and status announcements for "route updated" ([4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/)).

**4.8 Safety.** Reuse Citymapper's precedent of offering a **safer route** alongside the fastest one ([Wikipedia: Citymapper](https://en.wikipedia.org/wiki/Citymapper)). For PH: surface "well-lit / main road" and "last trip ~22:00" warnings, and never route a solo traveller through an unlit informal transfer at night without flagging it. Crime/incident data sourcing for Metro Manila is **[unverified]** — ship the preference with a manual/curated dataset, not a claimed real-time feed.

---
## 5. MVP UI spec — six screens

Global: M3 tonal surfaces ([colour roles](https://api.flutter.dev/flutter/material/ColorScheme-class.html)); 8 dp grid; 48 dp targets; one accent = brand primary; transit line colours from feed data only.

**5.1 Map / Home.** Full-bleed map; floating search pill top (48 dp, elevation 2, "Saan ka pupunta?"); locate FAB bottom-right above sheet; **standard bottom sheet** at peek showing recents (3) + "Nearby sakayan" list. States: locating / located / permission-denied (manual pin drop fallback). Provenance: one-line micro-credit bottom-left over map ("Map © OpenStreetMap · Routes: 3 feeds") that collapses to an ⓘ after interaction — exactly the behaviour OSMF permits ([OSMF guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)).

**5.2 Search + autocomplete.** Single field; query typed in Taglish/English; results grouped **Stops · Landmarks · Routes · Saved places**; each row shows type icon + locality + "≈ distance". Debounce 250 ms, cancel in-flight on keystroke, cache last 20 queries. Landmark results are essential (§4.2). Empty state = recents; error state = "Walang signal — showing saved places".

**5.3 Route options.** Sheet expands to half; 3–5 cards, sorted by ETA, with `Best` / `Cheapest` / `Fewest transfers` filter chips. Card = ETA (titleLarge) · arrival · **₱fare** · transfers · walk · mode chips · provenance chip. Tap card → map highlights that itinerary + polyline, other cards dim to 60%. Loading = 3 skeleton cards (no spinner). Empty = "No route found — try a nearby landmark".

**5.4 Trip detail / step-by-step.** Header: total time, fare, "Start" CTA. Body: vertical leg timeline — icon rail on the left (walk / jeep / bus / rail / trike / wait), instruction + **landmark line** on the right; ride legs expand to a stop list with the alight stop pinned and a "count stops" affordance. Board leg shows **signage to look for**. Footer: fare breakdown ("₱13 base + ₱1.80/km × 4 km") with effective date and source link. States: live / cached (stale badge) / disrupted (alert banner).

**5.5 Saved / recent.** Two tabs; recent auto-expires at 30 days; saved trips store a **fare snapshot + dataset version** so an old trip can say "fare changed since you saved this". Swipe-to-delete with undo snackbar; long-press to rename. Must work fully offline (§4.5).

**5.6 Data sources / attribution.** The screen that satisfies "state where the data comes from". See §5.7.

### 5.7 Provenance model — three layers, zero clutter

| Layer | Where | Content | Rule |
|---|---|---|---|
| **L1 micro-credit** | Map corner; route-card footer chip | "Map © OpenStreetMap · Routes: 3 feeds" → collapses to ⓘ | Visible without interaction on first paint; findable afterwards ([OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)) |
| **L2 dataset list** | "Data sources" screen (Settings + link from every ⓘ) | One card per dataset: name, publisher, licence, **last updated**, coverage, confidence | Scannable in <10 s; no licence walls of text |
| **L3 dataset detail** | Bottom sheet from a dataset card | Full licence name + link, source URL, effective dates, "report wrong data" | One tap from L2, never inline |

**What the dataset card must contain** (mirrors Transitous, the strongest existing example — it lists source domain, SPDX licence, operators, publisher, last-updated timestamp and original/processed files per feed, and separates schedule from realtime attribution: [transitous.org/sources](https://transitous.org/sources/)):
`Dataset name` · `Publisher` · `Licence (SPDX + link)` · `Last updated: 2026-10-28 14:03 UTC` · `Covers: jeepney, bus` · `Confidence: official / crowdsourced / estimated` · `Report an issue`.

**Industry patterns to borrow, and their failure modes:**
- **Per-feed attribution page** (Transitous) — complete, but too dense for riders; use it as the *content model*, not the layout ([transitous.org/sources](https://transitous.org/sources/)).
- **Country-indexed legal notices** (Google) — legally thorough, effectively undiscoverable, and a single global page ([Google legal notices](https://www.google.com/help/legalnotices_maps/)). We invert it: per-route context first, global page last.
- **Licence-mandated corner credit** (OSM) — required, small, collapsible after 5 s or on interaction, but must remain reachable via ⓘ or an "About → Data licences" entry ([OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)). OSMF also prefers attribution that **changes with the area viewed** — so our L1 string is computed from the feeds actually used for *this* route.
- **Agency badges** — show a small operator/agency mark only where an operator actually supplied the data (LRT-1/LRMC-style partner marks set the precedent for operator-branded data: [LRMC ikotMNL](https://lrmc.ph/2020/07/31/lrmcs-ikotmnl-app-now-with-contact-tracing-feature-and-sakay-ph-navigation/)). Badges are earned per dataset, never decorative.

**Anti-clutter rules:** max 1 provenance chip per card; max 1 line of credit on the map; no licence text outside L3; every string in L1/L2 generated from the same `sources[]` array the routing response returns (so the UI cannot drift from the data).

---
## 6. Implementer checklist (one page)

**Foundations**
- [ ] M3 colour scheme generated from a brand seed; light + dark + high-contrast; all `on-` pairs ≥ 4.5:1 ([ref](https://api.flutter.dev/flutter/material/ColorScheme-class.html))
- [ ] Type scale mapped to 5 roles; 200% resize and 1.3× spacing survive ([ref](https://www.w3.org/TR/WCAG22/))
- [ ] All touch targets ≥ 48 dp (≥ 24 px absolute minimum) ([SC 2.5.8](https://www.w3.org/TR/WCAG22/))
- [ ] `sources[]` array defined in the API contract *before* any screen is built

**Map / Home**
- [ ] Standard (non-modal) sheet over live map; 3 detents; drag handle; back collapses a detent
- [ ] Map padding recomputed per detent; selected route never occluded
- [ ] L1 micro-credit, collapsible to ⓘ, generated from `sources[]` ([OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines))
- [ ] Locate FAB + permission-denied manual-pin fallback

**Search**
- [ ] Grouped results: Stops / Landmarks / Routes / Saved
- [ ] 250 ms debounce, in-flight cancel, 20-query cache
- [ ] Offline empty state with saved places

**Route options**
- [ ] Card shows ETA · arrival · **₱fare** · transfers · walk · modes · provenance chip
- [ ] Sort by ETA; chips for Cheapest / Fewest transfers
- [ ] Skeleton cards after 300 ms; tap highlights polyline and dims siblings
- [ ] Fare carries `effective_from` and degrades to "may have changed" when stale

**Trip detail**
- [ ] Leg timeline with icon rail; ride legs expand to stop list with pinned alight stop
- [ ] Every instruction has a landmark line; board leg shows signage text (§4.2)
- [ ] Fare breakdown with source link; cached/stale badge; disruption banner

**Saved / recent**
- [ ] Works fully offline; stores fare snapshot + dataset version
- [ ] Swipe-delete with undo; rename; 30-day recent expiry

**Data sources**
- [ ] L2 list: name / publisher / licence / last updated / coverage / confidence per dataset
- [ ] L3 sheet: full licence + source URL + report-an-issue
- [ ] Reachable from Settings **and** from every ⓘ (≤ 2 taps from any route card)

**PH-specific**
- [ ] Fare matrix modelled as versioned data with `effective_from` ([LTFRB](https://ltfrb.gov.ph/))
- [ ] `informal_transfer` leg type with a buffer setting (§4.3)
- [ ] Taglish string set for top-60 strings; correct language tagging ([SC 3.1.2](https://www.w3.org/TR/WCAG22/))
- [ ] Safer-route preference (main roads / well-lit) ([Citymapper precedent](https://en.wikipedia.org/wiki/Citymapper))
- [ ] Budgets enforced in CI: cold start ≤ 3 s, first-screen payload ≤ 250 KB, p95 query ≤ 1.5 s ([web.dev](https://web.dev/articles/performance-budgets-101))

---
## 7. Verification notes / unverified register

- **Google Maps Help step text** — page fetched (HTTP 200) but JS-rendered; exact directions microcopy **[unverified]** ([source](https://support.google.com/maps/answer/144339?hl=en)).
- **Google Maps PH transit data partners** — Google's legal-notices page lists providers per country; no Philippines entry appeared in the retrieved copy, so PH partners are **[unverified]** ([source](https://www.google.com/help/legalnotices_maps/)).
- **Sakay.ph live feature set / current pricing** — sakay.ph blog returned Cloudflare 403; status taken from Wikipedia (Active, ads) ([source](https://en.wikipedia.org/wiki/Sakay.ph)).
- **Moovit Manila coverage depth** — city page returned HTTP 202 with no readable content ([source](https://moovitapp.com/index/en/public_transit-Manila-1022)).
- **LTFRB current fare matrix values** — site returned Cloudflare 403; no fare figures asserted ([source](https://ltfrb.gov.ph/)).
- **Biyaheroes, Komute, Transit PH, SmartTransit PH** — existence confirmed only at the linked pages; feature sets, monetisation and current status **[unverified]**.
- **Landmark-first wayfinding / jeepney signage studies** — no PH-specific study found in this pass; design requirement is inferred from endpoint-defined, regulated jeepney routes ([Wikipedia: Jeepney](https://en.wikipedia.org/wiki/Jeepney)).
- **"Jeepneys leave when full"** — widely repeated, no authoritative source located → **[unverified]**.
- **Citymapper 2026 product scope** — site is live; post-Via roadmap **[unverified]** ([citymapper.com](https://citymapper.com/), [Wikipedia](https://en.wikipedia.org/wiki/Citymapper)).
- **M3 type-scale numeric values** — spec page is JS-rendered; use the Flutter `TextTheme` implementation for exact sizes ([m3 typography](https://m3.material.io/styles/typography/overview)).
