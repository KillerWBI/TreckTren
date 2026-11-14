import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // PWA: ставится на главный экран, оболочка приложения открывается без сети.
    // Данные API не кэшируются service worker'ом: записи без сети копит очередь в IndexedDB.
    VitePWA({
      // Новая версия не перезагружает страницу сама (можно потерять подход, вписанный
      // в зале), а показывает плашку «Обновить». Закрыл и открыл приложение — уже новая.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TreckTren — тренировки и питание',
        short_name: 'TreckTren',
        description: 'Тренер по силовым, калориям и весу: план, подходы, еда и прогресс.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f6f8',
        theme_color: '#f6f6f8',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  // 'source' — брать @trektren/shared из исходников, без отдельной сборки.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    // API на том же origin, что и клиент: refresh-cookie с SameSite=Strict работает и в dev.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
