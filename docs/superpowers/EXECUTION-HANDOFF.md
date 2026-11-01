# BiyaHey! — Execution Handoff (durable state)

> Read this first if the session was compacted, forked, or handed to a fresh agent.
> It is the short, authoritative state of the project. The spec is the authority; the plans are its executable argument.

## Intent (human-approved)

Open-source, community-built commuter route planner for the Philippines, intended as a BetterGov.ph-aligned civic-tech project. Mobile-first PWA, Google-Maps-faithful UI (approved mockup: `.superpowers/mockups/option-a-maps-faithful.html`), Metro Manila + commuter belt for v1, local-first Docker development, every route/fare must state where its data comes from.

## Approved artifacts

| Artifact | Path |
|---|---|
| Design spec (approved by user) | `docs/superpowers/specs/2026-11-01-biyahey-design.md` |
| Research — PH transit datasets & licensing | `docs/research/ph-transit-datasets.md` |
| Research — routing & map stack | `docs/research/routing-and-map-stack.md` |
| Research — UI & competitors | `docs/research/ui-and-competitors.md` |
| Plan 1 — data spine + router (Phase 0–1) | `docs/superpowers/plans/2026-11-01-biyahey-data-spine.md` |
| Plan 2 — PWA MVP (Phase 2) | `docs/superpowers/plans/2026-11-01-biyahey-pwa-mvp.md` |
| UI mockups (Option A chosen) | `.superpowers/mockups/` |

## Non-negotiable facts from research (do not re-litigate)

- **No official PH GTFS or GTFS-RT exists.** All circulating feeds are 2013–2020 artifacts with unclear licences. Do not ship or cite `sakay-gtfs`, `ptac-2014`, `busmaps`.
- **OSM is the only current licensed backbone**: Geofabrik PH PBF, ODbL 1.0, data to 2026-10-31. Jeepney route relations are thin (76 `route=share_taxi` nationwide) — the curated inventory is mandatory.
- **Fares**: LTFRB matrix effective 2026-09-28 (jeepney ₱14/4 km + ₱2.00/km; modern jeepney ₱17 + ₱2.40; city bus ordinary ₱15/5 km + ₱2.49; aircon ₱18 + ₱2.98; provincial ordinary ₱12 + ₱2.20; UV Express ₱2.60/₱3.00 per km; P2P +15 %). LRT-2/MRT-3 50 % discount since 2026-03-23; **LRT-1 excluded** (₱16.25 + ₱1.47/km since 2025-04-02). Pasig River Ferry free. Free-ride service-contracting routes need `override: 0` flags (status unverified).
- **PNR suspended** until ~2028; **tricycles have no data**; **no live tracking exists** — never claim real-time.
- **Google Maps Platform is contractually incompatible** with this design; use MapLibre + OpenFreeMap.
- MOTIS v2.11.4 (MIT): release assets `motis-linux-amd64.tar.bz2` (sha256 `b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc`), `motis-windows.zip`; API `/api/v6/plan`, `/api/v1/geocode`, port 8080. State the exact payload mapping is verified against `openapi.yaml` at implementation.

## Environment as verified 2026-11-01

- Node **v24.19.0**, npm **11.17.0** (plan floor is Node 22/npm 10 — satisfied).
- Python **3.10.11** (plan text said 3.12 → ruling: target **≥3.10**, syntax compatible).
- Docker **29.0.1** + Compose **v2.40.3** available.
- git **2.50.1.windows.1**; global identity `andrewhmir <andrew.alangcao@gmail.com>`.
- Shell: Windows PowerShell 5.1. Plans/scripts must not depend on bash; use `npm run` / PowerShell-safe commands. Git Bash exists at `C:\Program Files\Git\bin\bash.exe` for the superpowers helper scripts when useful.
- Repo root: `C:\Users\Andrew\Desktop\BiyaHey!`.

## Rulings made before execution (ledgered in `.superpowers/sdd/data-spine/progress.md`)

1. **Branch isolation, not worktree**: implementation happens on `feature/data-spine` in the main checkout. One sequential writer, so a worktree adds no safety.
2. **Python 3.10**, not 3.12 (see environment).
3. **Node 24** runs the stack; `engines` must be `>=22`.
4. **MRT-3 fare formula** (plan arithmetic slip): `published = round(min + (max − min) × distanceKm/lengthKm)` to whole pesos, then × 0.5 for the 50 % discount. 8.2 km → ₱20 published → **₱10 charged**. Tests must assert 10, not 9.
5. **osmium bbox argument** is lon,lat order: `--bbox 120.90,14.35,121.15,14.80`; the researched tuple `ncr_bbox()` returns `(14.35, 120.90, 14.80, 121.15)`.
6. **`attributionFor` order** follows the canonical registry order in `sources.yaml`, not caller order (test expectation in Task 2 matches registry order).
7. **`buildApp` options** are `{ dataDir?: string; motisFetch?: FetchLike }` from Task 4 onward so Task 10 can inject the MOTIS transport without changing Task 4's signature.
8. **`generate_trips` returns both directions**; expected count is pinned after implementing the documented peak/off-peak windows (the plan's `272` is a placeholder — never ship it unchallenged).
9. **Plan placeholders**: any value marked `needs_verification`/placeholder must be either verified against its cited source or explicitly flagged in code and ledger — never silently accepted.
10. **Golden-route minima** may be adjusted only with a written data reason (e.g. corridor genuinely absent from OSM), recorded in the ledger and runbook.

## Execution protocol

- Method: **subagent-driven development** (superpowers). Fresh implementer per task, task reviewer after each, final whole-branch review at the end.
- Ledger: `.superpowers/sdd/data-spine/progress.md` (git-ignored). It is the recovery map: trust it and `git log` over memory after compaction.
- Per task: record `BASE`, generate the task brief, dispatch a fresh implementer with the brief path (never the whole plan), then review via a review-package diff file.
- Reviews are task-scoped; only Critical/Important or spec failures enter the fix loop (max 5 rounds).
- Commit style: Conventional Commits; branch `feature/data-spine`; PRs disclose AI assistance.
- Do not stop between tasks for check-ins. Stop only for irreversible actions, security-sensitive actions, out-of-scope side effects, or a plan that leaves every path a guess.

## Task order

Plan 1 (current): Tasks 1–11, in order. Plan 2 starts only after Plan 1's phase-1 acceptance passes.
Plan 2: Tasks 1–11, in order. Later phases (3–6 in the spec) get their own plans after phase 2.

## Current status

- Planning complete: research (3 reports), spec (approved), two implementation plans (committed).
- Implementation: **not started**. Next action: Task 1 of Plan 1 on `feature/data-spine`.
