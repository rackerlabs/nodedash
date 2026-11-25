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

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  probe.close();
  return port;
}

describe('shutdown', () => {
  // The handler lives in the run-directly block, so only a real process exercises it.
  it('exits cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'server.ts')], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(await freePort()),
        PUBLIC_URL: 'https://nodes.example.invalid',
        KEYSTONE_URL: 'https://keystone.example.invalid',
        SESSION_KEYS: Buffer.alloc(32, 1).toString('base64'),
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      let output = '';
      await new Promise<void>((done) => {
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('Server listening')) done();
        });
      });

      child.kill('SIGTERM');
      const [code, signal] = await once(child, 'exit');
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      child.kill('SIGKILL');
    }
  }, 15_000);
});
