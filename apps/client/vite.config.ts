import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 'source' — брать @trektren/shared из исходников, без отдельной сборки.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    // API на том же origin, что и клиент: refresh-cookie с SameSite=Strict работает и в dev.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
