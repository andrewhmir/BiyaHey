# Phase-1 acceptance runbook

How to re-run the Plan 1 acceptance check and what the 2026-11-01 run measured.
Phase 1 is the **data spine + router + BFF** (spec §12, Plan 1): MOTIS over a
published GTFS feed, the Fastify API in front of it, the provenance registry, the
fare engine, and the coverage report. The PWA (criteria 1's web service, 5's
About-data screen and all of criterion 6) is Plan 2 by ruling R38.

**Verdict 2026-11-01 (fix round 2, hermetic re-run): PARTIAL** — 5 criteria pass, 2 are partial for
the Plan-2 reasons above, 1 is deferred to Plan 2, 0 fail. `npm run verify:phase1`
exits 0 only because no criterion *and* no recorded check failed; the harness is
fail-closed on the recorded pytest/ci/compose/smoke/gate/coverage/golden results.
This run was made from a shell with `API_URL`/`MOTIS_URL` unset, and the `ci` step
is now hermetic by construction (§2): with `API_URL` exported it still reports the
same `106 passed | 4 skipped`.

## 1. Prerequisites

1. The data build is complete (`docs/runbooks/data-build.md` §1–§2: download, osm,
   publish; §6 lists every generated artifact): `data/build/osm/ncr.osm.pbf`,
   `data/build/gtfs/gtfs.zip`, `manifest.json`, `build-report.json`.
2. MOTIS has re-imported that feed:
   `docker compose up -d --force-recreate --wait routing` (fresh import measured
   **23.8 s**; an unchanged graph is a ~1 s no-op task list).
3. The pipeline virtualenv exists (`docs/runbooks/data-build.md` §0).

The harness never builds data: it starts the API itself on a free port, so no
`npm run dev` process may be needed (an already-running API is harmless).

## 2. Run it

```powershell
cd C:\Users\Andrew\Desktop\BiyaHey!
npm run verify:phase1
```

`scripts/verify-phase1.mjs` runs, in order:

| # | Command | Purpose |
|---|---|---|
| 1 | `pipelines\.venv\Scripts\python.exe -m pytest -q` (cwd `pipelines/`) | pipeline + coverage + alias tests |
| 2 | `npm run ci` | lint, typecheck, offline vitest (the `integration`-tagged live suites are filtered out), `validate:data` |
| 3 | `docker compose up -d --wait routing` | router up and healthy |
| 4 | `npm run smoke:routing` | live geocode + plan against MOTIS |
| 5 | `python -m pipeline.cli licence-gate --manifest data\build\manifest.json` | criterion 8 |
| 6 | `python -m pipeline.cli coverage --json --threshold 60` | criterion 7 |
| 7 | start `tsx services/api/src/server.ts` on a free port | real HTTP stack, not `inject` |
| 8 | `npx vitest run services/api/test/golden.test.ts` with `API_URL` + `GOLDEN_REPORT` | criteria 2, 3, 5 (API half) |

Exit code is 0 only when no criterion and no recorded check failed; PARTIAL and
DEFERRED are reported, not hidden. The harness gates on the `results` object it
records, so a failed pytest, `npm run ci`, compose, smoke, licence gate, coverage
or golden suite always exits non-zero, even if the criteria table would not have
mentioned it.

The live suites are tagged `integration` (`services/api/test/golden.test.ts` and
`services/api/test/motis-live.test.ts`) and the root `test` script runs
`vitest run --tagsFilter=!integration`. Vitest 5.0.5 does support tags and
`--tagsFilter`; the first fix round's claim that it had no tag/filter API was
wrong and is retracted. Because the filter (not the `API_URL` gate) is what keeps
CI offline, `npm test` / `npm run ci` skip both suites even when the caller's shell
exports `API_URL` or `MOTIS_URL`; the acceptance harness also strips both variables
from the `npm run ci` child environment as defence in depth. Run the live suites
deliberately against a running stack:

```powershell
$env:API_URL = 'http://localhost:8787'    # API you started yourself
$env:MOTIS_URL = 'http://localhost:8080'  # only the MOTIS suite needs this
npm run test:integration                  # every integration-tagged test
npx vitest run services/api/test/golden.test.ts   # the golden file alone
```

`test:integration` runs with the inverse filter, so Vitest reports every unit test
as skipped: expect `4 passed | 106 skipped` with both URLs set, and
`2 passed | 108 skipped` with only `API_URL` (the MOTIS suite stays env-skipped).
The golden file alone runs `3 passed` — its offline shape test is untagged and runs
because no filter is applied.

Manual equivalents (useful when debugging one check):

```powershell
$env:API_URL = 'http://localhost:8787'          # after starting the API yourself
npx vitest run services/api/test/golden.test.ts  # 10 golden trips + 6 search queries
node scripts/motis-stress.mjs 20                 # R37 repeated 3-call plan probe
```

## 3. Measured results (2026-11-01, fix round 2)

| Check | Result |
|---|---|
| pytest | `145 passed in 5.97s` (7.1 s wall) |
| `npm run ci` | lint + typecheck + **110 tests (106 passed, 4 `integration`-tagged skipped)** + 6 data files validated (18.4 s) |
| hermeticity | with `API_URL` exported, `npm test` still reports **106 passed, 4 skipped**; the golden live tests run only through the explicit integration command |
| `docker compose up -d --wait routing` | healthy in **1.1 s** (warm; cold re-import after republish **23.8 s**) |
| `npm run smoke:routing` | `ok: 10 geocode hits, 10 transit itineraries` |
| licence gate | `ok (4 datasets, ODbL-1.0 notice present, CC BY-SA 2.0 inventory attribution present in artifact, no blocked dataset)` |
| coverage | **12/16 = 75.0 %**; missing T109, T112, T115, T420 |
| golden suite | 10/10 trips within contract; p95 plan **183 ms**; p95 search **29 ms** |
| plausibility guard | **55 impossible itineraries dropped** across the ten golden corridors (6 Cubao→Ayala, 15 Fairview→Manila, 15 Las Piñas→Makati, 12 Pasay→Taguig, 4 Cubao→Pasig, 3 Cubao→Manila); every returned itinerary passed the guard |
| `/sources` | 10 registry rows served |

### Criteria table (spec §3)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `docker compose up` serves the full stack in < 20 min | **PARTIAL** | Router healthy in 1.1 s warm / 23.8 s after a republish (the healthcheck still allows 600 s for slower machines); API served on a free port; smoke 10/10. The web service does not exist yet (Plan 2), so the three-service clause cannot be fully measured. |
| 2 | Grouped search, p95 ≤ 1.5 s | **PASS** | p95 **29 ms** over Cubao/Ayala/Novaliches/Fairview/Alabang/Divisoria; every response carried `stops`, `landmarks`, `routes`, `saved` groups and `partial: false`. The harness requires the golden suite exit code 0 **and** at least one recorded sample (`searchP95Ms > 0`), so a failed search test cannot read as PASS. |
| 3 | 10 golden trips ≥ 3 itineraries, p95 plan ≤ 1.5 s | **PASS** | 10/10 trips met their minima (3 each) at the pinned 2026-11-02T08:00+08:00 departure; p95 **183 ms** (limit 1 500 ms). The BFF plausibility guard dropped 55 impossible options and the suite asserts every returned itinerary is plausible. Per-trip counts in §4. |
| 4 | Fare engine ≥ 25 golden fare cases | **PASS** | 45 test cases in `packages/shared/src/fares.test.ts`, green under `npm run ci`: 2026-09-28 PUV matrix, 2026-03-23 LRT-2/MRT-3 50 % discount, LRT-1 exclusion, free-ride overrides, guards. The same criterion now also requires the pipeline pytest suite (145 passed), so a pytest failure fails criterion 4 and the process exit. |
| 5 | Every itinerary `sources[]`; About-data lists every dataset; fares show `effective_from` | **PARTIAL** | Every golden itinerary was asserted to carry a non-empty `sources[]` and a dated `fare.effective_from`; `/sources` serves **10** datasets, and the API-side contract is covered by tests. The About-data *screen* is Plan 2 (there is no web app). |
| 6 | PWA installable; offline saved trips + fare matrix | **DEFERRED** | Plan 2 (ruling R38). Not measured, not claimed. |
| 7 | Coverage ≥ 60 % of the curated NCR jeepney/UV inventory | **PASS** | 12/16 = **75.0 %**, measured from the built `gtfs.zip` `routes.txt`, with the missing list published: T109, T112, T115, T420 (reasons in §6). |
| 8 | Licence gate: MIT code, ODbL derived database, no unlicensed dataset | **PASS** | Repo code is MIT (`LICENSE` present; `package.json` `"license": "MIT"`). `licence-gate` on the built manifest: 4 datasets, ODbL derived database with the notice in the artifact, CC BY-SA 2.0 inventory attribution, no blocked dataset. `npm run ci` runs `validate:data`; the pytest licence-gate tests run in `verify:phase1`'s pipeline-check step (pytest is **not** part of `npm run ci`). |

## 4. Golden trips (live counts after the plausibility guard)

`services/api/test/golden/routes.json` pins the departure and each trip's contract.
`requiredModes` must appear in the **union** of the trip's itineraries; `fareBounds`
are the live observed min/max rounded outward. Every `minItineraries` is **3** and
the suite asserts that value, so a corridor that cannot produce three plausible
options is replaced, never lowered.

All values below are from the 2026-11-01 fix-round-2 run against the 494-route feed
with the guard active. "Dropped" is the `x-biyahey-implausible-dropped` header: the
number of unique itineraries removed because one of their transit legs implied more
than 120 km/h.

| Trip | Itineraries (min) | Modes seen | Fares observed (PHP) | MOTIS calls | Dropped | Plan ms |
|---|---|---|---|---|---|---|
| Cubao to Ayala | 4 (3) | mrt3, walk | 10.50 | 1 | 6 | 150 |
| Marikina to Cubao | 12 (3) | bus, lrt2, walk | 17.16 / 23.00 / 28.20 | 1 | 0 | 51 |
| Cubao to Manila | 11 (3) | bus, lrt2, walk | 24.00 / 25.93 / 26.90 | 1 | 3 | 118 |
| Pasay to Monumento | 8 (3) | bus, lrt1, walk | 47.16 / 51.22 | 1 | 0 | 115 |
| Cubao to Pasig | 4 (3) | bus, ferry, walk | 27.44 | 1 | 4 | 94 |
| Pasay to Taguig | 12 (3) | bus, ferry, jeepney, walk | 61.29 / 84.52 / 89.37 | 1 | 12 | 183 |
| Fairview to Manila | 10 (3) | bus, walk | 61.19 / 79.16 | 1 | 15 | 136 |
| Novaliches to Cubao | 4 (3) | bus, walk | 104.46 | 1 | 0 | 87 |
| Las Piñas to Makati | 4 (3) | bus, walk | 69.95 | 1 | 15 | 118 |
| Cubao to Divisoria | 4 (3) | bus, walk | 51.92 | 1 | 0 | 91 |

Counts, modes and fares were identical across repeated probes; only latency moved.

### 4.1 Plausibility guard (R10 data defect)

The feed's OSM/curated route shapes and `stop_times` disagree. MOTIS maps the whole
route shape onto a leg, `map-itinerary` uses geometry distance for transit legs, and
the fare engine then prices kilometres no vehicle covers. Measured on the live feed:

| Route | Leg shape distance | Scheduled leg time | Implied speed |
|---|---|---|---|
| `bus-cubaobalayan` | 40,625 m | 2 min | 1,219 km/h |
| `bus-59` | 70,231 m | 2 min | 2,107 km/h |
| `bus-61` | 49,520 m | 4 min | 743 km/h |
| `uv-m01` (SM Fairview → Buendia) | 60,837 m | 2 min | 1,825 km/h |
| `jeep-t165` (Balintawak → Novaliches) | 8,194 m | 2 min | 246 km/h |
| `ferry-…` first leg (Pasig) | 12,981 m | 5 min | 156 km/h |

The BFF now drops any itinerary with a transit leg whose implied speed exceeds
**`MAX_TRANSIT_SPEED_KMH = 120 km/h`** (`services/api/src/routing/map-itinerary.ts`,
documented there with this rationale). 120 km/h is above the fastest legs this feed
actually keeps — the two fastest kept legs are **105.4 km/h** (Las Piñas→Makati,
`bus-23`, 14,054 m in 8 min) and **104.0 km/h** (Novaliches→Cubao, `bus-51`,
31,190 m in 18 min) — and far below every observed defect (743–2,107 km/h), so kept
legs of up to ~105 km/h remain under the guard. It is a gross-defect net, not a
realism certificate: those two kept legs are themselves implausible for NCR traffic,
so the guard leaves only ~15 km/h of headroom above them; tightening the net is the
GTFS-rebuild work in §8. A legitimate long-distance provincial bus (e.g. 100 km in
90 min, 67 km/h) is **not** pruned. Walk legs are never flagged. Speed is judged from
the raw MOTIS leg duration in seconds, not the rounded whole-minute `durationMin`
(a 1.4-minute leg would otherwise read 40 % faster than it is); a missing or zero
duration is evaluated with a 30-second floor rather than dividing by zero. A
geometry-to-straight-line ratio rule is deliberately not used: a route crossing the
Pasig River can legitimately drive several kilometres between stops 1 km apart.

Each `/plan` response carries `x-biyahey-motis-calls` (the fan-out: base, +10 min,
direct-only) and `x-biyahey-implausible-dropped` (unique dropped options), and the
golden suite asserts every returned itinerary passes the same guard. The guard is a
mitigation for the current artifact, not a cure: the real fix is a GTFS rebuild with
correct `shape_dist_traveled`/stop times (see §8).

**Retraction.** The first Task 11 report described the ₱406.98 Cubao→Ayala options
as "legitimate provincial through-buses". That was wrong: they were three
itineraries riding the impossible `bus-59`/`bus-61` shapes above, and the
₱10–420 / ₱65–440 / ₱100–320 bounds existed only to absorb them. The honest
post-guard bounds are ₱10–11 for Cubao→Ayala and 51–52 for Cubao→Divisoria.

### 4.2 Why the brief's illustrative expectations changed

- **Fare bounds.** The brief's suggested ₱6–40 Cubao→Ayala bound is close to the
  true MRT-3 fare (₱10.50); it was the data that was broken, not the brief. Bounds
  are now the measured post-guard range (see table), not a range widened to admit
  impossible geometry.
- **Modes.** The brief's Fairview→Makati `["jeepney","bus"]` never held on this
  data. The pre-guard live set was **bus + UV Express + MRT-3 + walk — only
  `jeepney` was absent** (the earlier report said "only UV Express + MRT-3"; that
  was incomplete). After the guard every Fairview→Makati option rides the `uv-m01`
  shape, so the corridor cannot meet ≥ 3 plausible options and was replaced by
  Fairview→Manila. UV Express is consequently absent from the final golden set for
  a recorded data reason, not because no route exists. Balintawak→Novaliches
  likewise now returns 0 plausible itineraries (the curated `jeep-t165` shape claims
  8,194 m in 2 min), so it was replaced by Novaliches→Cubao. LRT-2, LRT-1, ferry
  and jeepney coverage is retained through the replacement corridors, and every
  `requiredModes` value is the live post-guard union.

**Corridors excluded (R10 data reasons).** These returned **0 itineraries** against
the live build and were not entered into the golden set; no minimum or bound was
lowered to admit them. Raw MOTIS itself returns 0 itineraries and 0 direct options
for each at 08:00, 12:00 **and** 17:00, so none is a BFF drop or a one-hour
timetable artefact:

- **Alabang→Makati** — no trip sequence connects the pinned point to the corridor at
  any probed hour even though its nearest stop (`Fast Bytes`) is 337 m away; a point
  2.4 km west returns 5 options. OSM walk/network connectivity gap, not a planner
  error.
- **Bacoor→Pasay** — same 0/0 at three hours; nearest stop (`Niog`) is 917 m away and
  is not connected toward Pasay; a point 2.1 km east returns 8. Coordinate-level
  network gap in the extract.
- **San Juan→Makati** — same 0/0; nearest stop (`Filoil EcoOil Centre`) is 475 m away
  and even a direct walk to it is not routed, so the pinned point sits outside the
  walk graph. Point 440 m north returns 8.
- **Valenzuela→Manila** — same 0/0; nearest stop (`Karuhatan`) is 1,445 m away, beyond
  the router's walk access, so no stop is reachable. Point 1.8 km south-west returns
  7.

The same guard also excluded five original golden corridors after re-probe, each for
a recorded bad-shape reason: Fairview→Makati (`uv-m01`, 60,837 m / 2 min),
Novaliches→Ortigas (`jeep` 24,581 m / 2 min), Pasig→Manila (first ferry leg
12,981 m / 5 min), Bagong Silang→Novaliches (`jeep` 21,546 m / 2 min) and
Balintawak→Novaliches (`jeep-t165` 8,194 m / 2 min). These are data defects to fix
in the feed, not corridors to hide.

## 5. R37 — the undici crash and its proof

**Symptom (before the fix).** On Node 24.19.0, the first heavy `/plan` request killed
the API process:

```
AssertionError [ERR_ASSERTION]: false == true
    at Parser.finish (node:internal/deps/undici/undici:7388:9)
    at Socket.onHttpSocketEnd (node:internal/deps/undici/undici:7827:34)
```

The default MOTIS transport was Node's global `fetch`; when MOTIS closed a keep-alive
connection mid-response, undici's pooled parser asserted. A `/plan` fans out to three
MOTIS calls, so the first Cubao→Ayala request reproduced it.

**Fix.** `services/api/src/routing/http-json.ts` is now the default `motisFetch`: one
socket per request via Node `http`/`https` with `Connection: close`, `agent: false`,
the client's 5 s `AbortSignal` timeout passed through, status/text/JSON handled like the
old `fetch` response subset, and a 32 MB body cap. The injectable seam and every
fixture-based test are unchanged. Unit tests in `services/api/test/http-json.test.ts`
pin the contract.

**Proof.** `node scripts/motis-stress.mjs 20` — Divisoria→Taguig, a corridor that
still needs all three attempts (base, +10 min, direct-only) after the guard, so every
request really exercises the multi-call path. The probe reads
`x-biyahey-motis-calls`, rejects an iteration that returns 0 itineraries or whose call
count is not 3, then checks the API is alive:

```
stress: 20/20 requests succeeded, 20/20 with 3 MOTIS calls, 40 itineraries, p95 446 ms, max 563 ms
stress: API after the loop: alive ({"status":"ok"})
```

The first report's claim that Cubao→Divisoria made three MOTIS calls was **false**:
that corridor returns 4 itineraries on its base call, so `plan.ts` breaks after one
call and the loop only ever exercised a single-call plan. Divisoria→Taguig returns 2
plausible itineraries only after all three attempts (stable across repeated probes);
the retargeted script fails loudly if that stops being true, instead of silently
testing the wrong path again.

## 6. Coverage and the data reasons for the missing four (R10/R31/R34)

Coverage is computed from the built feed (`gtfs.zip` `routes.txt`), case-insensitively
(R29), and the same function backs the build report:

```powershell
python -m pipeline.cli coverage --inventory data\routes\jeepney-inventory.yaml `
    --feed data\build\gtfs\gtfs.zip --threshold 60
# coverage: 12/16 curated routes modelled (75.0%)
# missing: T109 (no GTFS route jeep-t109) ... threshold: 60.0% -> PASS
```

Before the documented alias layer (R34) the build modelled **4/16 = 25.0 %**. Adding
`data/routes/landmark-aliases.yaml` (eight hand-checked, feed-verified aliases; see
`docs/runbooks/data-build.md` §3) and fixing the R29 collision rule so an OSM relation
the GTFS builder cannot write cannot shadow a curated route raised it to **12/16 =
75.0 %**. The metric is unchanged.

The four routes still missing, with the honest data reason — none is a lowered bar:

| Route | Landmark | Reason no alias exists |
|---|---|---|
| T109 | Rizal Avenue | A road, not a terminal; the feed's stops are spread along kilometres of it, so choosing one would invent a terminus. |
| T112 | Paco (Obando) | Paco is a barangay of Obando, Bulacan; the extract has no named stop there, and the only "Paco" stops are Manila's Paco district ~10.6 km south. An alias would fabricate a corridor. |
| T115 | Victory Mall Monumento | The wiki names a mall no OSM stop carries; the nearest named stops are the Monumento transport terminals (different places), so no alias is recorded. |
| T420 | Biñan Poblacion | Biñan city centre is **south of the NCR bbox** (14.33 < min_lat 14.35, R5), so the clip contains no Biñan stops at all. This needs a coverage/bbox decision, not an alias. |

## 7. The taginfo-snapshot honesty note

Two different reports use the word "coverage"; do not confuse them:

- **This runbook's criterion 7 number** (12/16) is curated-inventory coverage measured
  against the built feed. It depends only on the committed inventory, the committed
  aliases and the OSM extract; it is exact and needs no taginfo data.
- **`data/build/osm/coverage.json`** comes from the OSM stage. Its route-relation
  counters are exact for the clipped extract, but its `by_mode`/PTv2/taginfo figures
  come from `pipelines/tests/fixtures/taginfo_philippines.json` — a **synthesized
  snapshot** mirroring the research note, clearly labelled `_snapshot` with
  `coverage_source: "synthesized taginfo snapshot - NOT a live query"`. It is not a
  live taginfo query, and any published claim that quotes those figures must say so.
  A live refresh would need the three taginfo PH API calls listed in
  `docs/runbooks/data-build.md` §1.5 (network access, never in CI/tests), after which
  the fixture's `_snapshot` date must be updated to the query date.

## 8. Known gaps and next actions

- **Plan 2** builds the PWA: installability/offline (criterion 6), the About-data
  screen (criterion 5), the web service (criterion 1), and the UI that consumes these
  APIs. Nothing here claims those.
- **R10 route-shape defect (the guard is a mitigation).** Many OSM/curated bus, UV,
  jeepney and ferry relations carry the whole trip shape on a 2-minute leg (§4.1), so
  the BFF drops the affected options. The durable fix is a GTFS rebuild that writes
  `shape_dist_traveled` and honest `stop_times` (and splits the curated UV shapes per
  boarding segment). Until then, UV Express is absent from the golden set and the
  Fairview/Novaliches/Pasig-origin and Balintawak corridors return fewer options than
  their route inventory suggests. The guard's dropped count is exposed as
  `x-biyahey-implausible-dropped` so the defect stays visible instead of silently
  reducing coverage.
- **Coverage data gaps** (T109/T112/T115/T420) are recorded above; widening the bbox
  to Biñan/Obando or mapping the named terminals is a future data pass, not an
  acceptance adjustment.
- **Corridor gaps** (§4.2) are visible in the live feed; they are route-network and
  walk-graph data gaps, not planner failures, and each has its measured reason there.
- MOTIS serves exactly the published artifacts only after a container recreate
  (`docker compose up -d --force-recreate --wait routing`); the acceptance harness
  does not re-import for you, because the data build is a deliberate, offline step.
