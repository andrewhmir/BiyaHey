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

When you changed the feed or the router stack, also:

```powershell
npm run smoke:routing
npm run verify:phase1      # expected to be PARTIAL until Plan 2 lands
```

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
