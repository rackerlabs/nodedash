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

import { createServer, get, type Server, type RequestOptions, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_ASSIST_METHODS } from '@nodedash/shared';
import { loadConfig, type Config } from '../config.ts';
import { HttpError } from '../errors.ts';
import { IronicClient } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { audit } from '../audit.ts';
import { registerSupportAssistRoutes } from './support-assist.ts';

vi.mock('../audit.ts', () => ({ audit: vi.fn() }));

// Exercise real HTTP streams locally without disabling production TLS verification.
vi.mock('node:https', async () => {
  const { request } = await import('node:http');
  return {
    request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const local = new URL(url);
      local.protocol = 'http:';
      return request(local, options, callback);
    },
  };
});

const archive = 'TSR20260102120000_ABC1234.zip';
const monitor = '/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/JID_123';
const uuid = '12345678-1234-4234-8234-123456789abc';
const base = `/api/nodes/north1/${uuid}`;
const methods = Object.fromEntries(
  Object.entries(SUPPORT_ASSIST_METHODS).map(([key, name]) => [
    name,
    { http_methods: [key === 'collect' ? 'POST' : 'GET'], async: false },
  ]),
);

describe('SupportAssist routes with real Ironic HTTP transport', () => {
  let config: Config;
  let upstream: Server;
  let app: FastifyInstance;
  let authenticated: boolean;
  let supported: boolean;
  let jobStatus: number;
  let vendorStatus: number;
  let storageStatus: number;
  let streaming: boolean;
  let oversizedIndex: boolean;
  let produced: number;
  let storageClosed: Promise<void>;
  let closeStorage: () => void;
  let storageCalls: Array<{ path: string; auth?: string; token?: string }>;

  let calls: Array<{ path: string; method: string; body: string; token?: string; version?: string }>;

  beforeEach(async () => {
    vi.mocked(audit).mockClear();
    authenticated = true;
    supported = true;
    jobStatus = 200;
    vendorStatus = 200;
    storageStatus = 200;
    streaming = false;
    oversizedIndex = false;
    produced = 0;
    storageClosed = new Promise((resolve) => {
      closeStorage = resolve;
    });
    storageCalls = [];
    calls = [];
    upstream = createServer(async (req, res) => {
      if (req.url?.startsWith('/supportassist-archives/')) {
        storageCalls.push({
          path: req.url,
          auth: req.headers.authorization,
          token: req.headers['x-auth-token'] as string,
        });
        res.statusCode = storageStatus;
        if (storageStatus !== 200) return res.end('Storage error with sensitive details');
        if (oversizedIndex) return res.end(Buffer.alloc(5_000_001, 0x20));
        if (req.url === `/supportassist-archives/${uuid}/`)
          return res.end(
            JSON.stringify([
              { name: archive, type: 'file', mtime: 'Fri, 02 Jan 2026 12:00:00 GMT', size: 8 },
              {
                name: 'TSR20260101120000_ABC1234.zip',
                type: 'file',
                mtime: 'Thu, 01 Jan 2026 12:00:00 GMT',
                size: 4,
              },
              {
                name: 'TSR20260102120000_OTHER.zip.tmp',
                type: 'file',
                mtime: 'Fri, 02 Jan 2026 12:00:00 GMT',
                size: 8,
              },
              { name: archive + '.tmp', type: 'file', mtime: 'Fri, 02 Jan 2026 12:00:00 GMT', size: 8 },
              { name: 'nested', type: 'directory', mtime: 'Fri, 02 Jan 2026 12:00:00 GMT' },
            ]),
          );
        if (req.url !== `/supportassist-archives/${uuid}/${archive}`) {
          res.statusCode = 404;
          return res.end();
        }
        if (streaming) {
          const chunk = Buffer.alloc(64 * 1024);
          const timer = setInterval(() => {
            produced += chunk.length;
            res.write(chunk);
          }, 5);
          res.once('close', () => {
            clearInterval(timer);
            closeStorage();
          });
          return;
        }
        res.setHeader('Content-Length', '8');
        res.write(Buffer.from([0x50, 0x4b, 0, 1]));
        return setImmediate(() => res.end(Buffer.from([2, 3, 4, 5])));
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({
        path: req.url!,
        method: req.method!,
        body,
        token: req.headers['x-auth-token'] as string,
        version: req.headers['x-openstack-ironic-api-version'] as string,
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1') {
        res.setHeader('X-OpenStack-Ironic-API-Maximum-Version', '1.114');
        res.end('{}');
      } else if (req.url?.endsWith('/methods')) {
        res.statusCode = vendorStatus;
        res.end(
          JSON.stringify(
            vendorStatus === 200 ? (supported ? methods : {}) : { error_message: 'Vendor access denied' },
          ),
        );
      } else if (req.url?.endsWith('/inventory')) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error_message: 'Inspection failed' }));
      } else if (req.url?.endsWith('/support_assist_get_eula_status'))
        res.end(JSON.stringify({ accepted: false }));
      else if (req.url?.endsWith('/support_assist_collect'))
        res.end(JSON.stringify({ task_monitor: monitor }));
      else if (req.url?.endsWith('/get_job_status')) {
        res.statusCode = jobStatus;
        res.end(
          JSON.stringify(
            jobStatus === 200
              ? {
                  task_monitor: monitor,
                  is_processing: false,
                  task_state: 'Failed',
                  task_status: 'Critical',
                  percent_complete: 100,
                  job_state: 'Failed',
                  messages: [{ Message: 'Upload failed' }],
                  token: 'upstream-secret',
                }
              : { error_message: JSON.stringify({ faultstring: 'Job access denied' }) },
          ),
        );
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const endpoint = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    config = loadConfig({
      SUPPORT_ASSIST_ARCHIVES: JSON.stringify({
        north1: {
          url: endpoint.replace('http:', 'https:') + '/supportassist-archives/',
          username: 'reader',
          password: 'test-password',
        },
      }),
      PUBLIC_URL: 'https://nodes.example.invalid',
      KEYSTONE_URL: 'https://keystone.example.invalid',
      SESSION_KEYS: Buffer.alloc(32, 1).toString('base64'),
    } as NodeJS.ProcessEnv);
    app = Fastify();
    app.decorateRequest('session');
    app.addHook('onRequest', async (request) => {
      request.session = (
        authenticated
          ? {
              unscopedToken: 'unscoped',
              identity: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
              scope: { projectId: 'p1', projectName: 'baremetal' },
              scoped: {
                projectId: 'p1',
                token: 'user-scoped-token',
                expiresAtMs: Date.now() + 3600_000,
                ironicEndpoints: { north1: endpoint },
              },
            }
          : {}
      ) as typeof request.session;
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
      throw error;
    });
    registerSupportAssistRoutes(app, {} as KeystoneClient, new IronicClient(config), config);
  });

  afterEach(async () => {
    await app?.close();
    if (upstream?.listening)
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
  });

  it('lists the UUID directory without inventory, newest first, using storage credentials only', async () => {
    const response = await app.inject(`${base}/support-assist/archives`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { name: archive, modified: '2026-01-02T12:00:00.000Z', size: 8 },
      { name: 'TSR20260101120000_ABC1234.zip', modified: '2026-01-01T12:00:00.000Z', size: 4 },
    ]);
    expect(calls.find((call) => call.path.endsWith('/methods'))?.token).toBe('user-scoped-token');
    expect(storageCalls).toEqual([
      {
        path: `/supportassist-archives/${uuid}/`,
        auth: `Basic ${Buffer.from('reader:test-password').toString('base64')}`,
        token: undefined,
      },
    ]);
    expect(calls.some((call) => call.path.endsWith('/inventory'))).toBe(false);
    expect(response.body).not.toContain('test-password');
  });

  it('streams the selected archive as an attachment without changing its bytes', async () => {
    const response = await app.inject(`${base}/support-assist/archives/${archive}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(`attachment; filename="${archive}"`);
    expect(response.headers['content-length']).toBe('8');
    expect(response.rawPayload).toEqual(Buffer.from([0x50, 0x4b, 0, 1, 2, 3, 4, 5]));
    expect(storageCalls.map((call) => call.path)).toEqual([`/supportassist-archives/${uuid}/${archive}`]);
    expect(vi.mocked(audit).mock.calls.map(([, entry]) => entry.outcome)).toEqual(['requested', 'succeeded']);
  });

  it('delivers bytes before storage finishes and closes storage when the browser disconnects', async () => {
    streaming = true;
    const origin = await app.listen({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve, reject) => {
      get(`${origin}${base}/support-assist/archives/${archive}`, (response) => {
        expect(response.statusCode).toBe(200);
        response.once('data', () => {
          response.destroy();
          resolve();
        });
        response.on('error', reject);
      }).on('error', reject);
    });
    await storageClosed;
    expect(vi.mocked(audit).mock.calls.map(([, entry]) => entry.outcome)).toEqual(['requested', 'failed']);
    expect(produced).toBeGreaterThan(0);
    expect(produced).toBeLessThan(4 * 1024 * 1024);
  });

  it('checks vendor permissions for both listing and direct downloads on every request', async () => {
    for (const status of [401, 403, 404]) {
      vendorStatus = status;
      for (const suffix of ['', `/${archive}`]) {
        expect((await app.inject(`${base}/support-assist/archives${suffix}`)).statusCode).toBe(status);
      }
    }
    expect(storageCalls).toEqual([]);
    expect(calls.filter((call) => call.path.endsWith('/methods'))).toHaveLength(6);
    vendorStatus = 200;
    authenticated = false;
    expect((await app.inject(`${base}/support-assist/archives/${archive}`)).statusCode).toBe(401);
  });

  it('refuses unsafe filenames and unsupported drivers before storage access', async () => {
    for (const name of [
      '%2e%2e%2fsecret',
      archive + '%0d%0aX-Test:evil',
      archive + '%0a',
      archive + '.tmp',
    ]) {
      expect((await app.inject(`${base}/support-assist/archives/${name}`)).statusCode).toBe(404);
    }
    supported = false;
    expect((await app.inject(`${base}/support-assist/archives/${archive}`)).statusCode).toBe(406);
    expect((await app.inject(`/api/nodes/unknown/${uuid}/support-assist/archives`)).statusCode).toBe(404);
    expect(storageCalls).toEqual([]);
  });

  it('reports unconfigured archive access without contacting storage', async () => {
    config.supportAssistArchives = {};
    const response = await app.inject(`${base}/support-assist/archives`);
    expect(response.statusCode).toBe(406);
    expect(response.json()).toEqual({ error: 'Archive downloads are not configured for this region.' });
    expect(storageCalls).toEqual([]);
  });

  it('requires a UUID before using a node identifier as a storage directory', async () => {
    for (const [value, status] of [
      ['node-1', 400],
      ['%2e%2e', 404], // The router normalizes dot segments before route matching.
      ['ABC1234', 400],
      ['%2e%2e%2fsecret', 400],
    ] as const) {
      for (const suffix of ['', `/${archive}`]) {
        expect(
          (await app.inject(`/api/nodes/north1/${value}/support-assist/archives${suffix}`)).statusCode,
        ).toBe(status);
      }
    }
    expect(storageCalls).toEqual([]);
  });

  it('keeps listing and downloads inside the authorized UUID directory', async () => {
    const other = 'aaaaaaaa-0000-4000-a000-00000000000a';
    const otherBase = `/api/nodes/north1/${other}/support-assist/archives`;
    expect((await app.inject(otherBase)).json()).toEqual([]);
    expect((await app.inject(`${otherBase}/${archive}`)).statusCode).toBe(404);
    expect(storageCalls.map((call) => call.path)).toEqual([
      `/supportassist-archives/${other}/`,
      `/supportassist-archives/${other}/${archive}`,
    ]);
    vendorStatus = 403;
    storageCalls = [];
    for (const suffix of ['', `/${archive}`]) {
      expect((await app.inject(`${otherBase}${suffix}`)).statusCode).toBe(403);
    }
    expect(storageCalls).toEqual([]);
  });

  it('returns an empty list for a missing node directory without trying the flat directory', async () => {
    storageStatus = 404;
    const response = await app.inject(`${base}/support-assist/archives`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(storageCalls.map((call) => call.path)).toEqual([`/supportassist-archives/${uuid}/`]);
  });

  it('rejects an oversized archive index as unavailable storage', async () => {
    oversizedIndex = true;
    const response = await app.inject(`${base}/support-assist/archives`);
    expect(response.statusCode).toBe(502);
  });
  it('sanitizes storage errors and preserves a missing archive as 404', async () => {
    for (const status of [401, 403, 302, 500, 404]) {
      storageStatus = status;
      const response = await app.inject(`${base}/support-assist/archives/${archive}`);
      expect(response.statusCode).toBe(status === 404 ? 404 : 502);
      expect(response.body).not.toContain('sensitive');
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(
        vi
          .mocked(audit)
          .mock.calls.slice(-2)
          .map(([, entry]) => entry.outcome),
      ).toEqual(['requested', 'failed']);
    }
  });

  it('reads EULA without accepting it and starts with Ironic defaults at the method path', async () => {
    expect((await app.inject(`${base}/support-assist/eula`)).json()).toEqual({ accepted: false });
    const started = await app.inject({ method: 'POST', url: `${base}/support-assist` });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toEqual({ task_monitor: monitor });
    const collect = calls.find((call) => call.path.endsWith('/support_assist_collect'))!;
    expect(collect).toMatchObject({
      method: 'POST',
      body: '{}',
      token: 'user-scoped-token',
      version: '1.114',
    });
    expect(calls.some((call) => call.path.includes('accept_eula'))).toBe(false);
  });

  it('sends polling arguments as a GET JSON body, preserves terminal failures and redacts responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/support-assist/job`,
      payload: { task_monitor: monitor },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task_state: 'Failed',
      is_processing: false,
      token: '**redacted**',
    });
    expect(calls.find((call) => call.path.endsWith('/get_job_status'))).toMatchObject({
      method: 'GET',
      body: JSON.stringify({ task_monitor: monitor }),
      token: 'user-scoped-token',
      version: '1.114',
    });
  });

  it('propagates job permission errors', async () => {
    jobStatus = 403;
    const response = await app.inject({
      method: 'POST',
      url: `${base}/support-assist/job`,
      payload: { task_monitor: monitor },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Job access denied');
  });

  it('rejects invalid monitors before contacting Ironic', async () => {
    for (const task_monitor of ['https://other.example.com/job', '/redfish/v1/TaskService/Tasks/../x', '']) {
      expect(
        (await app.inject({ method: 'POST', url: `${base}/support-assist/job`, payload: { task_monitor } }))
          .statusCode,
      ).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('requires a session and discovers the required verbs before starting', async () => {
    authenticated = false;
    expect((await app.inject(`${base}/support-assist/eula`)).statusCode).toBe(401);
    vi.mocked(audit).mockClear();
    authenticated = true;
    supported = false;
    expect((await app.inject({ method: 'POST', url: `${base}/support-assist` })).statusCode).toBe(406);
    expect(calls.some((call) => call.path.endsWith('/support_assist_collect'))).toBe(false);
    expect((await app.inject(`${base}/support-assist/old-id/download`)).statusCode).toBe(404);
  });
});
