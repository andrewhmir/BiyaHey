# Contributing to BiyaHey!

Thanks for helping build a commuter tool people can actually trust. BiyaHey! is
an independent, open-source project: open by default, small
reviewable changes, real data with visible provenance, and explicit disclosure
of AI-assisted work. By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```bash
npm ci                    # Node 22+; installs the workspaces
npm run data:build        # one-time: downloads ~612 MB of OSM and builds the feed
docker compose up -d --wait
npm run dev --workspace @biyahey/web   # http://localhost:5173
```

The full local guide (Python pipeline setup, ports, env vars, data build) is
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b packages/shared services/api` + `tsc -p apps/web --noEmit` |
| `npm test` | offline unit tests (integration-tagged suites filtered out) |
| `npm run test:integration` | live suites against the running BFF/router |
| `npm run validate:data` | JSON-Schema validation of every `data/**` file |
| `npm run check:fares` | fails when the fare matrix is more than 183 days old |
| `npm run ci` | the five checks above in CI order |
| `npm run build` | production PWA build in `apps/web/dist` |

Browser flows live in `apps/web/e2e/` (Playwright, run from the web workspace
against the live stack). Unit tests are offline: no network calls in `npm test`.

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) with
  scopes `api`, `shared`, `pipeline`, `routing`, `web`, `ci`, `docs`, `data`.
  One focused change per branch; explain the *why* for data/contract changes.
- **Copy**: never hardcode rider-facing strings. Every sentence goes through
  `t('key')` from `src/i18n.tsx`, with keys added to both `tl` (default) and `en`
  in `apps/web/src/copy.ts`. This covers `aria-label`s, titles and status text.
- **Design**: use the Tailwind v4 tokens from `apps/web/src/theme.css`
  (`brand`, `ink`, `line`, `canvas`, …), not raw hex colours. Figtree is the
  typeface; cards are `rounded-lg border border-line bg-white`; buttons use the
  `bg-brand` token. Keep it small — no new dependencies without a measured
  reason.
- **Accessibility (WCAG 2.2 AA)**: semantic headings; real `<button>`/`<a>`
  elements; every icon button has an `aria-label`; visible focus states; colour
  is never the only signal; 48 dp targets for entry-point controls; honour
  `prefers-reduced-motion`; check 200 % text zoom at 320 px.
- **Data**: register every dataset in `data/provenance/sources.yaml` with
  licence, URL, coverage and attribution. Never invent a fare, coordinate or
  effectivity date — mark provisional values `needs_verification: true`. Data
  changes require `npm run validate:data` and pass the licence gate
  (`.github/workflows/licence-gate.yml`). Never commit generated data
  (`data/build/`, `data/snapshots/`, `*.osm.pbf`).
- **AI-assisted work**: allowed and encouraged, but must be disclosed and
  human-verified. Read [AI_DISCLOSURE.md](AI_DISCLOSURE.md) and fill the AI
  section of the PR template. You are accountable for every line you submit.

Open a PR using [.github/pull_request_template.md](.github/pull_request_template.md)
with the real commands and output in the verification section. One maintainer
review is required, and `main` must stay green.
