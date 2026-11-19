import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import compression from 'compression';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The dev and preview servers are also how the tailnet/browser inspects the
 * app on a phone. Vite serves each module unminified and uncompressed, and
 * (before the `environments.client.dev.sourcemap` change below) with inline
 * source maps — together that was a ~22 MB first load, i.e. a 20–30 s cold
 * start over Wi-Fi. gzip at a 1 KB threshold is nearly free on the host CPU
 * and shrinks the module graph ~5×; the production server in
 * `scripts/serve-web.mjs` uses brotli and long-lived caching instead.
 */
function compressedServers(): Plugin {
  const middleware = () => compression({ threshold: 1024 });
  return {
    name: 'biyahey:compressed-servers',
    configureServer(server) {
      // Registered before Vite's internal middlewares so every response is wrapped.
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}

/**
 * Vite dev inlines source maps into every served module. For dependencies this
 * is catastrophic on the wire: MapLibre alone is 1.1 MB of code plus an ~7 MB
 * inline map, react-dom another ~2 MB of map. HMR does not need maps for
 * node_modules, so this identity transform with an empty map tells the dev
 * server not to append them (dev source maps for app code stay off via
 * `environments.client.dev.sourcemap`). Set BIYAHEY_DEV_SOURCEMAP=1 to keep
 * dependency maps for a debugging session.
 */
function stripDependencySourcemaps(): Plugin {
  return {
    name: 'biyahey:strip-dependency-sourcemaps',
    apply: 'serve',
    transform(code, id) {
      if (process.env.BIYAHEY_DEV_SOURCEMAP === '1') return;
      if (!id.includes('/node_modules/')) return;
      // The extra newline is load-bearing: Vite only adopts a transform's map
      // when the transform actually changed the code, so an identity return
      // would keep the (huge) source map extracted during the load phase.
      return {
        code: code.endsWith('\n') ? code : `${code}\n`,
        map: { version: 3, sources: [], sourcesContent: [], names: [], mappings: '' },
      };
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    compressedServers(),
    stripDependencySourcemaps(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'BiyaHey! — Philippine community commute map',
        short_name: 'BiyaHey!',
        description:
          'Plan a Philippine commute on a community-driven, open-source map — compare jeepney, bus and rail options with honest fares, and follow the sakay steps.',
        lang: 'tl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0066eb',
        background_color: '#f8f9fa',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // A repeat visit should paint the cached shell immediately instead of
        // waiting for the network: navigateFallback + navigation preload make
        // the service worker answer from cache while it revalidates in the
        // background, and autoUpdate swaps in the new build on its own.
        navigationPreload: true,
        // json is in the list for the self-hosted /map/style.json; the runtime
        // font/tile/API rules below cover everything that is not shell.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,json}'], // manifest.webmanifest is added by the PWA plugin
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The two small BFF GETs (provenance registry + fare-matrix status):
            // prefer the network, but after a short timeout fall back to the last
            // good response so a warm repeat visit paints instantly. lib/api.ts
            // already revalidates these in-app; this keeps the SW cache warm too.
            urlPattern: /\/api\/(?:sources|fares\/status)$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'biyahey-api-data',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'biyahey-map-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'biyahey-fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  // MapLibre is a large ESM package; pre-bundling breaks its worker URL.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // Dev/preview servers are local tools behind the host's own access control
  // (tailnet), so accept the Host header those URLs arrive with.
  server: { port: 5173, strictPort: true, allowedHosts: true },
  preview: { port: 5173, strictPort: true, allowedHosts: true },
  build: {
    manifest: true,
    // Preview/watch builds (scripts/serve-web.mjs sets BIYAHEY_PREVIEW_BUILD)
    // keep previously hashed files on disk: a page that loaded just before a
    // rebuild must still find its chunks. serve-web prunes unreferenced files
    // after a grace period. Normal builds still start from a clean dist/.
    emptyOutDir: process.env.BIYAHEY_PREVIEW_BUILD !== '1',
    // The build targets browsers that all implement module preload natively;
    // dropping the polyfill shaves a request/some entry bytes.
    modulePreload: { polyfill: false },
  },
  environments: {
    client: {
      dev: {
        // Vite inlines source maps into every served module by default. For a
        // dependency like MapLibre that is 1.1 MB of JS plus a 7 MB inline map
        // — the single biggest reason the dev server was a 22 MB page. HMR
        // does not need maps; set BIYAHEY_DEV_SOURCEMAP=1 when debugging.
        sourcemap: process.env.BIYAHEY_DEV_SOURCEMAP === '1' ? { js: true, css: true } : false,
      },
    },
  },
});
