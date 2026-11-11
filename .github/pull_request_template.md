## Summary

<!-- What changed, and why. Link the issue if there is one. -->

## Type of change

- [ ] `feat` — new capability
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `chore` — tooling, dependencies, CI
- [ ] `data` — provenance, fares, curated routes, aliases

## Verification

<!-- Real commands and results. Paste the relevant tail of the output. -->

- [ ] `npm run ci` passes (lint, typecheck, offline tests, data schemas, fare staleness)
- [ ] Pipeline tests pass when `pipelines/` changed (`python -m pytest -q` in `pipelines/`)
- [ ] Live checks run when the API/router changed (describe the request and response you checked)
- [ ] No generated data committed (`data/build/`, `data/snapshots/`, `*.osm.pbf`)

## Data and provenance (delete if not applicable)

- [ ] Every new/changed dataset is in `data/provenance/sources.yaml` with licence, URL, coverage and attribution
- [ ] `npm run validate:data` passes for changed `data/**` files
- [ ] Licence gate passes (CI runs `python -m pipeline.cli licence-gate` for `data/**` and `pipelines/**` changes)
- [ ] No fare/coordinate/route value is invented; provisional values carry `needs_verification: true`
- [ ] The published GTFS still states the ODbL notice and the CC BY-SA 2.0 inventory attribution

## AI-assisted work disclosure

<!-- Required. See AI_DISCLOSURE.md. "None" is a valid answer. -->

- **Tool(s)/model(s):**
- **Scope (files/behaviour):**
- **Human verification performed:**
- **Not AI-assisted (optional):**

## Reviewer notes / residual concerns

<!-- Anything you deliberately deferred, and why. -->
