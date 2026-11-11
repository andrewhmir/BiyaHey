# Performance

How fast BiyaHey! opens, what was slow, and how to keep it fast. Every number
below was measured on the dev machine, on an emulated Tailscale-class link
(12 Mbps down / 30 ms RTT) at a 390 × 844 phone viewport with a cold browser
context, unless stated otherwise. The A/B harness is
`scripts/perf-audit.mjs` (`npm run perf:audit`); "before" is the commit this
work started from (`dc7de44`) served from a pristine worktree.

## TL;DR

The app was slow to open because the URL a phone opened was the **Vite dev
server**, which serves the whole module graph uncompressed with inline source
maps and no caching: **22 MB and ~33 s to first paint**. A production build of
the same app over the same link is **~0.5 MB** and paints immediately.

What this work did, in order of impact:

1. **Serve the production build, not the dev server** (`scripts/serve-web.mjs`,
   port 8099): brotli + gzip, immutable caching for hashed assets, a
   same-origin `/api` proxy, and `--watch` rebuilds. The tailnet entrypoints now
   point here. Dev-server cold load: **22.36 MB → 1.13 MB** of transfer,
   **82 → 49** requests, **6.98 s → 0.62 s** FCP on the same emulated link
   (the very first cold run, with an empty transform cache, was 32.8 s).
2. **Make the dev server itself usable** for the next person (gzip middleware,
   dependency source maps stripped from the wire).
3. **Shrink the shell**: route-level code splitting (entry JS 396.95 kB →
   272.85 kB raw, 117.09 → 86.73 kB gzip; six screens off the critical path),
   self-hosted Figtree (no render-blocking `fonts.googleapis.com`), and an
   initial panel detent derived from the route (CLS 0).
4. **Cut map bytes and requests**: the basemap style is self-hosted and trimmed
   (111 → 47 layers, 43.3 kB → 19.1 kB JSON, 2.1 kB brotli), the sprite atlas
   and the italic glyph range are gone. On the wire the map's external CDN
   traffic drops **262 kB → 89 kB (−173 kB)** and three requests.
5. **Warm visits** are served from the service worker: repeat visit
   **FCP ~52 ms, 0 kB network**, with `autoUpdate` swapping in new builds.
6. **Honest data caching**: `/sources` and `/fares/status` are ETagged, get a
   60 s `max-age`, answer revalidation with a bodyless `304`, are prefetched at
   idle and cached in-app (SWR); about-data repeat navigation went from 66 ms to
   2 ms and warm navigations make no API calls at all.

### What did *not* improve

Be sceptical of the map's "canvas visible" metric in the audit table below: the
map is no faster to appear, and on a warm repeat it is measurably slower. All
functional gates pass and the map's own network cost fell by 173 kB, but the
claim "the map opens faster" is not supported:

| Metric (emulated tailnet) | Before | After |
|---|---|---|
| FCP — production shell | 208 ms | 208 ms (parity) |
| FCP — production shell, clean re-run | 240 ms | 242 ms |
| FCP — fast3g profile | 938 ms | 976 ms (+4 %) |
| Map canvas visible, cold, in-page rAF | 398–406 ms | 465–472 ms |
| Map canvas visible, warm repeat, in-page rAF | 64–98 ms | 322–342 ms |
| Local dev-server FCP | 6.98 s (first-ever: 32.8 s) | 0.62 s |
| Transfer — dev server | 22.36 MB | **1.13 MB** |
| Requests — dev server | 82 | 49 |
| Requests — production shell | 17 | 18 |
| Transfer — production shell | 465 kB | 477 kB (+12 kB: local font files) |
| Third-party hosts on the critical path | Google Fonts + OpenFreeMap | OpenFreeMap only |
| Map's external CDN bytes (CDP wire bytes) | 262 kB | **89 kB** |
| Warm repeat FCP / network | — | ~52 ms / **0 kB** |

The warm-map delta was reproduced on a clean build served from scratch, with
the service worker blocked and with a warm HTTP cache. A Chromium trace shows a
~270 ms main-thread gap between the (cached) `MapCanvas` chunk becoming
available and React mounting the map; all functional, a11y and PWA specs pass.
Treat it as a follow-up (tracked in "Known limits"), not as a win.

## The fast path: `npm run preview:web`

`apps/web/dist` is served by `scripts/serve-web.mjs`, not by `vite preview`:

| Concern | `vite preview` | `scripts/serve-web.mjs` |
|---|---|---|
| Compression | none | brotli q11 + gzip 9, computed once per build |
| Hashed assets | `no-cache` | `public, max-age=31536000, immutable` |
| `index.html`, `sw.js`, map style | normal | `no-cache` so a new build is picked up |
| `POST /api/*` | none | same-origin reverse proxy to the BFF (compressed) |
| `GET /api/sources`, `/api/fares/status` | none | forwards the BFF `ETag`, answers `304` |
| Freshness | manual rebuild | `--watch` rebuilds `dist/` on every save |
| `/__health` | none | yes |

```bash
npm run preview:web          # build once (VITE_API_URL=/api) + serve :8099
npm run preview:web:watch    # same, then rebuild on source changes
```

Because the build inlines `VITE_API_URL=/api`, the browser talks to the BFF
through the same origin — no CORS allow-list, no second HTTPS origin, no mixed
content. On the dev VM the tailnet entrypoints already point here:

```text
https://devvm1.tailf19a1a.ts.net/       -> http://127.0.0.1:8099   (production preview)
https://devvm1.tailf19a1a.ts.net:8443/  -> http://127.0.0.1:8099   (production preview)
```

The Vite dev server keeps running on <http://localhost:5173> for HMR, tests and
`apps/web/e2e` — it is no longer the URL a phone should open.

### Watch mode and stale assets

`preview:web:watch` rebuilds `dist/` on every save. Preview builds keep the
previous build's hashed files on disk (`BIYAHEY_PREVIEW_BUILD=1` disables
Vite's `emptyOutDir`) and the server prunes unreferenced files after a 10-minute
grace window, so a page that loaded a second before a rebuild still finds its
chunks. Normal `npm run build` still starts from a clean `dist/`.

The preview server also warns at startup if the build it is serving inlines a
`localhost` API origin (for example a `dist/` left behind by the PWA e2e spec),
because that silently breaks the tailnet app; restart `preview:web:watch` to
rebuild it with `/api`.

## What changed

### Delivery — `scripts/serve-web.mjs`, `scripts/perf-audit.mjs`

- Production preview server with compression, immutable caching, SPA fallback,
  `/api` proxy (with ETag/304 pass-through) and watch rebuilds (above).
- `scripts/perf-audit.mjs` (`npm run perf:audit`): Playwright harness that
  measures FCP/LCP/map-canvas/bytes/requests at a phone viewport, optionally
  over emulated `tailnet` (12 Mbps / 30 ms), `fast3g` or `slow3g` networks, plus
  a `--warm` mode for repeat visits (service worker on, real CDP wire bytes).

### Dev server — `apps/web/vite.config.ts`

The dev server is uncompressed by default and inlines source maps into every
served module: MapLibre alone was 1.1 MB of JS plus a ~7 MB inline source map.
Now:

- `compression()` middleware wraps dev and preview responses (gzip, 1 kB
  threshold).
- A dev-only plugin strips dependency source maps from the wire (the transform's
  extra newline is load-bearing: Vite only adopts a transform map when the code
  changed). Set `BIYAHEY_DEV_SOURCEMAP=1` to get them back for debugging.
- `environments.client.dev.sourcemap` is off for app code as well.

Result on the emulated tailnet: dev-server cold load **6.98 s → 0.62 s FCP**,
**22.36 MB → 1.13 MB**, 82 → 49 requests.

### App shell — `apps/web/src/app.tsx`, `index.html`, `theme.css`, `Panel.tsx`

- Route-level code splitting: only `Home` is in the entry chunk; `Search`,
  `Results`, `Trip`, `Live`, `Saved` and `AboutData` are `React.lazy` chunks with
  a panel-shaped Suspense fallback that claims the arriving screen's detent, so
  the sheet never jumps. Entry JS **396.95 kB → 272.85 kB raw** (gzip 117.09 →
  86.73 kB); the six screen chunks (~81 kB raw / ~22 kB brotli) are only fetched
  when first visited.
- Figtree is self-hosted (`apps/web/public/fonts/`, variable latin + latin-ext
  woff2, OFL licence beside them) with `@font-face` + `font-display: swap` and a
  preload of the latin face. The render-blocking `fonts.googleapis.com`
  stylesheet and both Google preconnects are gone; the audit sees no Google
  hosts at all and the font is served same-origin.
- `<link rel="preload" as="fetch" href="/map/style.json">` warms the map style
  in parallel with the entry JS (single fetch, confirmed in network traces).
- The panel's first render derives the sheet detent from the route instead of
  mounting at `half` and animating: **CLS 0.00000** on `/`, `/search`, `/plan`,
  `/saved`, `/sources` and desktop home.

### Map — `apps/web/src/map/MapCanvas.tsx`, `apps/web/public/map/style.json`

- The OpenFreeMap Liberty style is self-hosted and trimmed by
  `scripts/build-map-style.mjs` (`npm run map:style`; `--check` fails if the
  committed JSON is stale): 111 layers down to the 47 the planner needs
  (background/water/landuse, road casing+fill, rail, boundaries, labels);
  style JSON 43.3 kB → 19.1 kB (2.1 kB brotli), one fewer cross-origin round
  trip and no sprite atlas (~122 kB) or italic glyph range (~47 kB) before the
  first draw. Wire evidence: OpenFreeMap CDN bytes **262 kB → 89 kB**, sprite
  requests 2 → 0, glyph requests 3 → 2.
- `renderWorldCopies: false`, `fadeDuration: 0` (tiles render as they arrive
  instead of fading in), `cancelPendingTileRequestsWhileZooming: true`, and
  hover `queryRenderedFeatures` is rAF-coalesced (one query per frame) and
  skipped entirely when no input can hover.
- Attribution: `sources.openmaptiles.attribution` embeds the
  OpenStreetMap/OpenFreeMap/OpenMapTiles attribution from the upstream TileJSON;
  the app's own MapCredit is unchanged. Dropped intentionally: highway shields
  and airport icons, and water/neighbourhood labels are upright instead of
  italic (the trimmed style has no italic font range).

### Data — `apps/web/src/lib/api.ts`, `src/lib/prefetch.ts`, BFF routes

- `GET /sources` and `GET /fares/status` are cached in-app (SWR: cached data
  paints immediately, revalidates in the background, `sessionStorage` snapshot
  for the next visit) and warmed from `requestIdleCallback` after first paint;
  the prefetch adds no FCP/LCP cost (measured on/off).
- The BFF sends weak `ETag` + `Cache-Control: public, max-age=60,
  stale-while-revalidate=300` on those two GETs and answers matching
  `If-None-Match` with a bodyless `304` (verified: 0 bytes / ~1 ms vs a 5 kB
  full response).
- The service worker adds a `NetworkFirst` rule for them (3 s network timeout,
  24 h fallback cache) on top of the 30-day map-tile cache, and precaches the app
  shell, lazy chunks, fonts and map style. Warm repeat visit: FCP ~52 ms, 0 kB
  network; `autoUpdate` build swap verified end-to-end.

## Cache policy summary

| Response | `cache-control` |
|---|---|
| Hashed assets (`/assets/*-[hash].js\|css`, worker, hashed fonts) | `public, max-age=31536000, immutable` |
| `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`, `/map/style.json` | `no-cache` |
| Other static files (`/fonts`, `/icons`) | `public, max-age=604800` |
| `/api/*` (proxied) | `no-store`, except validator-carrying GETs (`/api/sources`, `/api/fares/status`) which keep the BFF's `ETag` + `no-cache` so revalidation is a bodyless `304` |
| BFF `GET /sources`, `GET /fares/status` (direct) | `public, max-age=60, stale-while-revalidate=300` + weak `ETag` |

## Measuring

```bash
# Cold load, emulated Tailscale-class Wi-Fi, phone viewport, no service worker
npm run perf:audit -- --runs 2 --throttle tailnet http://127.0.0.1:8099/

# Compare dev server and production preview
npm run perf:audit -- --throttle tailnet http://localhost:5173/ http://127.0.0.1:8099/

# Repeat visit with the service worker in charge
npm run perf:audit -- --warm --warm-runs 2 --throttle tailnet http://127.0.0.1:8099/

# Same, over the tailnet (fresh browser, true cold start)
npm run perf:audit -- --runs 2 --throttle tailnet https://devvm1.tailf19a1a.ts.net/
```

The harness exits non-zero on failed requests or app errors. Use it after
touching the entry graph, fonts, map style, PWA config or the preview server.
Take "map canvas" numbers with the caveat above; prefer a quiet machine and
several runs, and prefer in-page timings (rAF) over Playwright selector polling.

## Known limits / next opportunities

- **Warm map readiness** is ~250 ms slower than before (cold is ~60 ms slower,
  in-page rAF). A Chromium trace shows the cached `MapCanvas` chunk available at
  ~100 ms but React mounting the map only at ~350 ms — a scheduler/lazy-import
  interaction with the new chunk graph. Needs a focused follow-up (e.g. testing
  eager map import vs. Suspense scheduling), not a speculative fix. All
  functional/a11y/PWA checks pass.
- **OpenFreeMap CDN latency** is the main external dependency for the map
  (tile metadata, glyphs, tiles). It is cached by the service worker after the
  first visit but a cold first draw still waits on the CDN.
- **MapLibre is ~1.06 MB of the JS shell** (290 kB brotli). It loads lazily
  behind the shell; a lighter runtime is the next big code-side win if one
  appears.
- **Dev HMR is not the phone URL** any more. If you need live reload on a
  device, open the dev server directly, or rely on the ~1 s preview rebuild.
- The screenshot scripts (`apps/web/e2e/screenshots.mjs`) and the PWA spec still
  build their own copies; they are unaffected by the preview server.
