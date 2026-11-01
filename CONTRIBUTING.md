# Contributing to BiyaHey!

Thanks for helping build a commuter tool people can actually trust. BiyaHey!
follows [BetterGov](https://bettergov.ph) conventions: open by default, small
reviewable changes, real data with visible provenance, and explicit disclosure
of AI-assisted work.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Toolchain

| Tool | Version |
|---|---|
| Node | **22+** (CI uses 22; this checkout was developed on 24) |
| npm | **10+** |
| Python | **3.10+** (the pipeline targets 3.10; CI uses 3.10) |
| Docker | current Docker Desktop / Engine with Compose v2 |
| Java | 21+ (optional: run `gtfs-validator` locally) |

## Branches

Use a prefixed branch off `main`:

```
feature/<short-topic>      # user-visible or new capability
fix/<short-topic>          # bug fix
docs/<short-topic>         # documentation/runbooks only
chore/<short-topic>        # tooling, dependencies, CI
```

Keep a branch focused on one change. Do not commit generated data
(`data/build/`, `data/snapshots/`, `*.osm.pbf`) or `.env` files.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add cors and plan cap
fix(pipeline): gate unsupported ferry/rail families
docs: add repo contribution docs
test(api): pin stale fare status
chore(ci): run check:fares
```

Scopes we use: `api`, `shared`, `pipeline`, `routing`, `web`, `ci`, `docs`,
`data`. Explain the *why* in the body for data or contract changes; link the
issue/plan when one exists.

## Pull requests

1. Fork or branch, make the change, run the checks below.
2. Open a PR using `.github/pull_request_template.md`. Fill in the summary, the
   test evidence, the data/provenance checklist when relevant, and the
   **AI-assisted work disclosure**.
3. One maintainer review is required. Review looks for correctness, honest
   data/claims, licence impact and tests — not style nits that tooling catches.
4. Squash or rebase as needed; the merge must keep `main` green.

### Local checks before opening a PR

```powershell
npm run ci                 # lint + typecheck + offline vitest + data schemas + fare staleness
npm run validate:data      # JSON-Schema validation of every data/** file
npm run check:fares        # fails when the fare matrix is >183 days old

# Pipeline (offline fixtures):
cd pipelines
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m pytest -q
cd ..
```

When you changed the web app, also:

```powershell
npm run build --workspace @biyahey/web
npm test --workspace @biyahey/web -- bundle   # paint-only payload vs 250 KB gzip
npm run test:e2e                              # needs the live stack (:8080 + :8787)
npm run verify:phase2                         # phase-2 acceptance, performance PARTIAL
```

When you changed the feed or the router stack, also:

```powershell
npm run smoke:routing
npm run verify:phase1      # Plan-1 acceptance; PARTIAL by design (web-owned criteria)
```

## UI and engineering conventions

These are not style preferences: they encode the product's trust model (fares and
provenance come from the API), the approved layout (Option A) and budgets that CI
enforces. Read them before changing `apps/web`.

### Option A container — map + standard bottom sheet

- Every map screen composes `AppShell` + `MapSlot` + `MapView` + `BottomSheet`.
  The sheet is **non-modal**, has three detents (peek / half / expanded), a
  keyboard/button alternative to dragging, and reports map padding per detent so
  the selected route and controls are never occluded. Do not turn it into a modal
  dialog or replace it with a separate page.
- Keep **one visual emphasis per route card**; selecting a card highlights its
  polyline and vice versa (one selection state).
- Screens without a map (search, trip detail, saved, About data) stay full-page;
  the map is not decoration to add everywhere.

### Fare-first route cards

- Card order is the product promise: **total time · arrival · ₱ fare · transfers ·
  walk · mode chips · provenance chip**. The fare is a first-class field, never a
  footnote, and every displayed fare carries its `effective_from` date.
- The fare label is derived from `FareQuote.source_id` (R57): `ltfrb-fares` →
  "LTFRB matrix", `rail-fares` → "rail fare matrix", `null`/mixed → a truthful
  generic label. Never print "LTFRB matrix" for a mixed-source sum.
- **The web app never computes, rounds or infers a fare.** `@biyahey/shared` and
  the BFF own the fare engine; the UI formats the returned amount and shows the
  returned source. A missing fare/source is an honest gap, not a number to invent.

### Provenance rules (R44/R45)

- Every attribution string comes from the API's `sources[]` (dataset name,
  publisher, SPDX licence, URL, coverage, last-checked date, attribution). No
  hardcoded publisher, licence or URL in a component.
- The only hardcoded credits are the tile-provider credit required by the map
  (OSM + OpenFreeMap/OpenMapTiles, R42/R55) and provider-required names.
- An itinerary that references a source missing from `/sources` renders "source
  unavailable"; About data lists what actually exists. Never render `undefined`.
- New datasets are registered in `data/provenance/sources.yaml`; the About-data
  screen and `/plan` pick them up from there.

### Taglish through `i18n` (R44, R75–R79, R81)

- All user-facing copy goes through `t('key')` from `useT()`. No Taglish or
  English literals in JSX, `aria-label`s, `title`s or status messages.
- Add every key to **both** locales in `apps/web/src/i18n/strings.ts`; the type
  checker and `strings.test.ts` fail on a missing key. Mandated exact strings
  (offline, no-results, staleness, Save confirmation) are pinned byte-for-byte —
  do not reword them without updating the plan/spec.
- Default locale is Taglish (`tl`), with a complete English (`en`) fallback
  string set. The mechanism is tested; the spec §11 English-toggle **UI** is a
  recorded public-beta gap, not something to fake with a stray link.
- Keep `<html lang="tl">` and `lang="en"` on English-only sentences. Mixed
  Taglish/English sentences stay single primary-language nodes (R81); splitting
  them would change DOM shape and break the pinned-copy tests.

### Accessibility checklist (WCAG 2.2 AA)

- 48 dp targets for entry-point controls; WCAG 2.5.8's 24×24 px minimum for
  inline/licence links (the MapCredit popover links are deliberately 24 px, R78).
- Every control has an accessible name from `t()`; icons are `aria-hidden`.
- Visible focus (`focus-visible` outline token), logical focus order, focus
  restored/moved deliberately when a sheet, dialog or list item disappears.
- Escape layering: the innermost open dialog/popover owns Escape (R80). A modal
  sheet must not swallow it.
- `prefers-reduced-motion` disables sheet animation; dragging always has a
  keyboard/button alternative.
- 200 % text zoom at 320 px must keep the fare and primary CTA visible and
  tappable; long names truncate instead of clipping the fare.
- Never convey mode/selection by colour alone — pair it with a label/icon.
- Screens have axe coverage in `apps/web/src/a11y.test.tsx`; add a case for every
  new screen. The jsdom colour-contrast rule is disabled for the suite because
  jsdom has no canvas (R52); that is not permission to ship low-contrast colours
  — verify contrast in the real browser when changing tokens.

### Performance budget rules (R82, R87, R88)

- The enforced budget is the **paint-only first-screen payload ≤ 250 KB gzip**:
  the entry chunk's recursive **static** import graph + its CSS + JS/CSS
  referenced by `index.html`. Dynamic route/map chunks are excluded, and the
  bundle test asserts `MapCanvas` is not in the entry graph.
- Therefore: never statically import MapLibre/`MapCanvas` from an eager module;
  new routes are lazy (`routes.tsx`); heavy libraries need a measured reason.
- `apps/web/src/perf/bundle.test.ts` uses Vite's build manifest; run the build
  before the bundle test. A stale `dist/` fails on purpose — rebuild after edits.
  The stale-build and missing-manifest probes are documented in the Task 10
  report; keep them true.
- Lighthouse is 5 mobile runs at 4× CPU, median-aggregated. LCP ≤ 3000 and
  transfer ≤ 1 MB are strict; TBT ≤ 2500 is a regression ceiling, **not** a pass
  of Lighthouse's 600 ms "good" guidance. The §11 interactive-map ≤ 3 s, ≤ 40
  tiles/viewport and `saveData` fallback remain recorded gaps (R88) — do not
  report them green or raise the ceilings to make a run pass.
- Do not run Lighthouse while another browser is pegging the CPU; the five-run
  median absorbs noise, the CI `perf` job in `.github/workflows/web.yml` is
  authoritative.

### Test conventions

- Unit tests are **offline**: MSW handlers only, no live API/MOTIS, no real
  network. A test that needs the stack belongs in `apps/web/e2e/`.
- E2E specs live in `apps/web/e2e/`. The `dev` project drives the live stack
  (real `/search`, `/plan`, `/sources`); the `preview` project runs against the
  built app and is the only place the service worker, manifest and offline reload
  exist. `npm run test:e2e` builds first — do not run Playwright's preview
  project against a stale `dist/`.
- Wait on app state/assertions, not fixed sleeps. Do not loosen a locator, widen
  a tolerance or delete an assertion to make a red test green; fix the app or
  record the gap with an owner.
- Fixtures must be contract-valid **and** matrix-faithful (R60): no synthetic
  fares or matrix dates a real fare engine could not produce.
- Shared DTOs (`ItineraryDto`, `LegDto`, `FareQuote`, `DataSource`,
  `SearchResponse`) come from `@biyahey/shared` (R43). Do not redeclare them in
  `apps/web`; a contract change is a Plan-1-level change with tests.
- Saved/recent state has a single writer (`lib/savedTripsStore.ts` over
  `lib/deviceStore.ts`); never add a second `localStorage` writer for the same
  keys, and validate every field the consumer reads (R66).
- Tests that generate screenshots are not part of CI; the README images come
  from `node apps/web/scripts/screenshots.mjs` against the running app. Never
  hand-edit or mock up a screenshot.

### Branch, commit and AI disclosure

- Branch prefixes: `feature/`, `fix/`, `docs/`, `chore/`; one focused change per
  branch. Do not push to `main`.
- Conventional Commits, scopes `api`, `shared`, `pipeline`, `routing`, `web`,
  `ci`, `docs`, `data`. Explain the *why* for data/contract changes; put measured
  evidence in the commit body or PR.
- PRs use `.github/pull_request_template.md` and fill the **AI-assisted work
  disclosure**. You are accountable for every line, including claims about fares,
  provenance and performance. "All tests pass" requires the command and its
  output, not an inference.

## Data contributions

Data is the product; treat it accordingly.

- Every dataset must be registered in `data/provenance/sources.yaml` with a
  licence, URL, coverage and attribution. If you cannot state a reuse grant, it
  does not ship.
- Never invent a fare, coordinate, terminal or effectivity date. If a value is
  provisional, mark it (`needs_verification: true`) and record the gap in
  `docs/runbooks/phase1-acceptance.md` §8.
- Curated routes live in `data/routes/jeepney-inventory.yaml`; landmark aliases
  in `data/routes/landmark-aliases.yaml` and must be backed by an OSM feature
  name, never a guessed coordinate.
- Schema changes require a schema update in `data/<area>/schema/` and a passing
  `npm run validate:data`.
- The published GTFS must keep the ODbL notice and the CC BY-SA 2.0 inventory
  attribution inside the zip; the licence gate enforces both.
- Record measured build timings and coverage changes in the runbook when they
  move materially.

## AI-assisted work

AI-assisted contributions are allowed and encouraged for speed, but they must be
disclosed and human-verified. Read [`AI_DISCLOSURE.md`](AI_DISCLOSURE.md), and
complete the AI section of the PR template. You are accountable for every line
you submit, including any claim about data or fares.

## Reporting bugs and data errors

Open an issue with: what you expected, what happened, the request/response or
route id, and the data source. For a wrong fare or route, include the
`fare.effective_from` / `sources[]` values from the API response so the record
can be traced to a dataset.
