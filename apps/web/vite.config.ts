import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'BiyaHey! — Philippine commute map',
        short_name: 'BiyaHey!',
        description:
          'Plan a Philippine commute, compare jeepney, bus and rail options with honest fares, and follow the sakay steps on a map.',
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
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
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
  build: { manifest: true },
  // Dev/preview are local tools behind the host's own access control (tailnet),
  // so accept the Host header those URLs arrive with.
  server: { port: 5173, strictPort: true, allowedHosts: true },
  preview: { port: 5173, strictPort: true, allowedHosts: true },
});
