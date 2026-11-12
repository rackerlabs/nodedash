/*
Copyright 2026 Rackspace Technology.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isMock = process.env.VITE_MOCK === '1' || process.env.VITE_MOCK === 'true';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  /**
   * The MSW service worker is only served in mock mode. A real deployment must not
   * ship a request-intercepting service worker, so its directory is not part of a
   * production build at all.
   */
  publicDir: isMock ? 'public-mock' : false,
  server: {
    port: 5173,
    // In mock mode the service worker answers /api before it reaches the network,
    // so this proxy only matters once a real BFF is running.
    proxy: {
      '/api': {
        target: process.env.BFF_URL ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
