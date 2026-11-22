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

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORT_ASSIST_METHODS } from '@nodedash/shared';
import { loadConfig } from '../config.ts';
import { HttpError } from '../errors.ts';
import { IronicClient } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { registerSupportAssistRoutes } from './support-assist.ts';

const monitor = '/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/JID_123';
const base = '/api/nodes/north1/node-1';
const methods = Object.fromEntries(
  Object.entries(SUPPORT_ASSIST_METHODS).map(([key, name]) => [
    name,
    { http_methods: [key === 'collect' ? 'POST' : 'GET'], async: false },
  ]),
);

describe('SupportAssist routes with real Ironic HTTP transport', () => {
  let upstream: Server;
  let app: FastifyInstance;
  let authenticated: boolean;
  let supported: boolean;
  let jobStatus: number;
  let calls: Array<{ path: string; method: string; body: string; token?: string; version?: string }>;

  beforeEach(async () => {
    authenticated = true;
    supported = true;
    jobStatus = 200;
    calls = [];
    upstream = createServer(async (req, res) => {
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
      } else if (req.url?.endsWith('/methods')) res.end(JSON.stringify(supported ? methods : {}));
      else if (req.url?.endsWith('/support_assist_get_eula_status'))
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
    const config = loadConfig({
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
    registerSupportAssistRoutes(app, {} as KeystoneClient, new IronicClient(config));
  });

  afterEach(async () => {
    await app?.close();
    if (upstream?.listening)
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
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
    authenticated = true;
    supported = false;
    expect((await app.inject({ method: 'POST', url: `${base}/support-assist` })).statusCode).toBe(406);
    expect(calls.some((call) => call.path.endsWith('/support_assist_collect'))).toBe(false);
    expect((await app.inject(`${base}/support-assist/old-id/download`)).statusCode).toBe(404);
  });
});
