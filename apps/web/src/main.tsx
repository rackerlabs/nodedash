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

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

async function bootstrap() {
  // The env check is written inline so Vite replaces it with a literal and drops
  // the whole branch from a production build — the mock backend, its fixtures and
  // MSW must never ship to a real deployment.
  if (import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true') {
    // Start the worker before the first render so no request escapes to the network.
    const { startMockBackend } = await import('./mocks/browser');
    await startMockBackend();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
