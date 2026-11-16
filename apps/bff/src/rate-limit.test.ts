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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.ts';

afterEach(() => vi.unstubAllEnvs());

describe('rate limiting', () => {
  async function server() {
    vi.stubEnv('PUBLIC_URL', 'https://nodes.example.invalid');
    vi.stubEnv('KEYSTONE_URL', 'https://keystone.example.invalid');
    vi.stubEnv('SESSION_KEYS', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('RATE_LIMIT_MAX', '2');
    const { app } = await buildServer();
    return app;
  }

  it('answers 429 once a client exceeds the budget on /api', async () => {
    const app = await server();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/api/regions' })).statusCode);
    }
    expect(statuses).toEqual([401, 401, 429]);
    await app.close();
  });

  it('never limits the health check', async () => {
    const app = await server();
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    }
    await app.close();
  });
});
