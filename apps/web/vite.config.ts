import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { workboxRuntimeCaching } from './src/features/saved/offlineCache';

// The BFF from Plan 1 listens on 8787 and allows the 5173 origin (R40).
export default defineConfig({
  plugins: [
    react(),
    // Task 8: app-shell precache + the GET runtime-caching rules. The rules
    // live in `src/features/saved/offlineCache.ts` as pure data so they can be
    // unit-tested without a browser; this config only hands them to Workbox.
    // `POST /plan` is intentionally absent: it cannot be cached and its 3 s
    // bound is enforced by `planTrip`'s per-request timeout (R72).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // The plugin adds manifest icons to the precache list by default; the
      // glob below already covers them, so keeping both duplicates entries.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'BiyaHey! — Philippine commute planner',
        short_name: 'BiyaHey!',
        description:
          'Plan Metro Manila commutes, compare fares and follow step-by-step sakay directions.',
        lang: 'tl',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0E7C7B',
        background_color: '#F4F6F3',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell (HTML, JS/CSS chunks, icons, manifest) so a
        // reload offline boots the SPA and the saved-trips store renders. The
        // `mjs` pattern covers MapLibre's worker asset, which `MapCanvas`
        // imports as `?url` (without it the offline map has no renderer even
        // though the map chunk itself is precached).
        globPatterns: ['**/*.{js,mjs,css,html,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: workboxRuntimeCaching(),
      },
    }),
  ],
  build: {
    // `apps/web/src/perf/bundle.test.ts` reads the emitted manifest and walks
    // the entry's static import graph to measure the first route-screen payload.
    // Dynamic imports (the map and every non-home route) are deliberately not
    // part of that graph, so the budget cannot hide them by accident.
    manifest: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
