import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { workboxRuntimeCaching } from './src/features/saved/offlineCache';

// The BFF from Plan 1 listens on 8787 and allows the 5173 origin (R40).
export default defineConfig({
  plugins: [
    react(),
    // Task 8: app-shell precache + the four runtime-caching rules. The rules
    // live in `src/features/saved/offlineCache.ts` as pure data so they can be
    // unit-tested without a browser; this config only hands them to Workbox.
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
        theme_color: '#00696D',
        background_color: '#F7FAF9',
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
        // reload offline boots the SPA and the saved-trips store renders.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // One MapLibre chunk is larger than Workbox's 2 MiB default; the shell
        // must still be precached for the offline saved-trip path to boot.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: workboxRuntimeCaching(),
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
