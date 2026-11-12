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

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ironicEndpoints } from './keystone.ts';
import { buildServer } from './server.ts';

/**
 * Drives the real server through sign-in, region and project selection with
 * Keystone and Ironic faked at the fetch boundary, to pin down what the encrypted
 * session cookie has to carry and that no replica needs to have seen it before.
 */

const KEYSTONE = 'https://keystone.example.invalid';
const IRONIC_A = 'https://ironic-a.example.invalid';
const IRONIC_B = 'https://ironic-b.example.invalid';

// Federated Fernet tokens run to a few hundred characters; use a generous size
// so the cookie size check below means something.
const UNSCOPED = `gAAAAAunscoped${'u'.repeat(400)}`;
const scopedFor = (projectId: string) => `gAAAAAscoped-${projectId}-${'s'.repeat(400)}`;

const env = {
  PUBLIC_URL: 'https://nodes.example.invalid',
  KEYSTONE_URL: KEYSTONE,
  SESSION_KEYS: Buffer.alloc(32, 7).toString('base64'),
  IDENTITY_PROVIDERS: 'sso:openid:Corp SSO',
  LOG_LEVEL: 'silent',
};

const user = {
  id: 'user-1',
  name: 'operator@example.invalid',
  domain: { id: 'federated', name: 'Federated' },
  'OS-FEDERATION': { identity_provider: { id: 'sso' }, protocol: { id: 'openid' } },
};

const catalog = [
  {
    type: 'baremetal',
    endpoints: [
      { interface: 'public', region_id: 'region-a', url: `${IRONIC_A}/` },
      { interface: 'internal', region_id: 'region-a', url: 'http://ironic-a.internal.invalid' },
      { interface: 'public', region_id: 'region-b', url: IRONIC_B },
    ],
  },
  { type: 'identity', endpoints: [{ interface: 'public', region_id: 'region-a', url: KEYSTONE }] },
];

let scopedMints = 0;
let ironicCalls: Array<{ url: string; token: string | null; version: string | null }> = [];

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

async function fakeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const method = init.method ?? 'GET';

  if (url.origin === KEYSTONE) {
    if (url.pathname === '/v3/auth/tokens' && method === 'GET') {
      return json({ token: { expires_at: new Date(Date.now() + 3600_000).toISOString(), user } });
    }
    if (url.pathname === '/v3/auth/tokens' && method === 'POST') {
      scopedMints += 1;
      const projectId = JSON.parse(String(init.body)).auth.scope.project.id as string;
      return json(
        {
          token: {
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            user,
            project: { id: projectId, name: `name-${projectId}`, domain: { id: 'd1', name: 'infra' } },
            catalog,
          },
        },
        { status: 201, headers: { 'X-Subject-Token': scopedFor(projectId) } },
      );
    }
    if (url.pathname === '/v3/auth/tokens' && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.pathname === '/v3/regions') {
      return json({ regions: [{ id: 'region-b', description: 'B' }, { id: 'region-a', description: 'A' }] });
    }
    if (url.pathname === '/v3/auth/domains') return json({ error: { code: 403 } }, { status: 403 });
    if (url.pathname === '/v3/auth/projects') {
      return json({ projects: [{ id: 'p1', name: 'baremetal', domain_id: 'd1', enabled: true }] });
    }
  }

  if (url.origin === IRONIC_A || url.origin === IRONIC_B) {
    ironicCalls.push({
      url: url.toString(),
      token: headers.get('x-auth-token'),
      version: headers.get('x-openstack-ironic-api-version'),
    });
    if (url.pathname === '/v1') {
      return json({}, { headers: { 'X-OpenStack-Ironic-API-Maximum-Version': '1.112' } });
    }
    if (url.pathname === '/v1/nodes') return json({ nodes: [] });
  }

  return new Response('unexpected request in test', { status: 599 });
}

/** Minimal cookie jar: keeps whatever the server last set, drops cleared cookies. */
class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookie: string | string[] | undefined): void {
    for (const header of [setCookie ?? []].flat()) {
      const [pair = ''] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /max-age=0/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

type App = FastifyInstance;

async function call(
  app: App,
  jar: Jar,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
  options: { form?: boolean } = {},
) {
  const headers: Record<string, string> = { cookie: jar.header() };
  const csrf = jar.get('csrf_token');
  if (csrf) headers['x-csrf-token'] = csrf;
  let payload: string | undefined;
  if (body && options.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body as Record<string, string>).toString();
  } else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await app.inject({ method, url, headers, payload });
  jar.absorb(response.headers['set-cookie']);
  return response;
}

async function signIn(app: App, jar: Jar) {
  const login = await call(app, jar, 'GET', '/api/auth/login?idp=sso&next=/nodes');
  expect(login.statusCode).toBe(302);
  return postBack(app, jar);
}

/** Keystone's cross-site POST, which carries no cookies, then the browser following its redirect. */
async function postBack(app: App, jar: Jar) {
  const posted = await call(app, new Jar(), 'POST', '/api/auth/websso', { token: UNSCOPED }, { form: true });
  expect(posted.statusCode).toBe(303);
  expect(posted.headers.location).toBe('/api/auth/websso/complete');
  jar.absorb(posted.headers['set-cookie']);
  return call(app, jar, 'GET', '/api/auth/websso/complete');
}

let apps: App[] = [];

async function server(): Promise<App> {
  const { app } = await buildServer();
  apps.push(app);
  return app;
}

beforeEach(() => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  scopedMints = 0;
  ironicCalls = [];
});

afterEach(async () => {
  await Promise.all(apps.map((app) => app.close()));
  apps = [];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('encrypted session cookie', () => {
  it('signs in through WebSSO without exposing the Keystone token to the browser', async () => {
    const app = await server();
    const jar = new Jar();

    const callback = await signIn(app, jar);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/nodes');

    const sessionCookie = [callback.headers['set-cookie'] ?? []]
      .flat()
      .find((header) => header.startsWith('nodedash_session='));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).not.toContain(UNSCOPED.slice(0, 20));

    const session = await call(app, jar, 'GET', '/api/session');
    expect(session.json()).toMatchObject({ authenticated: true, region: null, scope: null });
  });

  it('refuses a WebSSO callback that was not started from this browser', async () => {
    const app = await server();
    const response = await postBack(app, new Jar());
    expect(response.statusCode).toBe(400);
  });

  it('tells the browser to drop the WebSSO state once the callback has used it', async () => {
    // Nothing server-side records that the state was spent, as before with the
    // signed cookie: a copy of the state cookie stays valid until it expires.
    const app = await server();
    const jar = new Jar();
    await call(app, jar, 'GET', '/api/auth/login?idp=sso');
    expect(jar.get('websso_state')).toBeDefined();

    await postBack(app, jar);
    expect(jar.get('websso_state')).toBeUndefined();
    expect(jar.get('websso_pending')).toBeUndefined();
  });

  it('names domains from a scoped token when Keystone will not list them, once per domain', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);

    const first = await call(app, jar, 'GET', '/api/scope/options');
    expect(first.json().domains).toEqual([{ id: 'd1', name: 'infra' }]);
    await call(app, jar, 'GET', '/api/scope/options');
    expect(scopedMints).toBe(1);
  });

  it('takes Ironic from the catalog of the selected region and reuses the scoped token', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);

    const regions = await call(app, jar, 'GET', '/api/regions');
    expect(regions.json().regions.map((region: { id: string }) => region.id)).toEqual(['region-a', 'region-b']);

    expect((await call(app, jar, 'PUT', '/api/region', { region: 'region-a' })).json().region).toBe('region-a');
    expect((await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' })).statusCode).toBe(200);

    expect((await call(app, jar, 'GET', '/api/nodes')).statusCode).toBe(200);
    expect((await call(app, jar, 'GET', '/api/nodes')).statusCode).toBe(200);

    const nodeCalls = ironicCalls.filter((entry) => entry.url.includes('/v1/nodes'));
    expect(nodeCalls).toHaveLength(2);
    expect(nodeCalls.every((entry) => entry.url.startsWith(`${IRONIC_A}/v1/nodes`))).toBe(true);
    expect(nodeCalls.every((entry) => entry.token === scopedFor('p1'))).toBe(true);
    // Below the client's own maximum, so this proves the server's header was read.
    expect(nodeCalls.every((entry) => entry.version === '1.112')).toBe(true);
    // Minted once when the project was picked; the cookie carried it after that.
    expect(scopedMints).toBe(1);
  });

  it('drops the selected project on a region change and talks to the new region', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);
    await call(app, jar, 'PUT', '/api/region', { region: 'region-a' });
    await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' });

    const switched = await call(app, jar, 'PUT', '/api/region', { region: 'region-b' });
    expect(switched.json()).toMatchObject({ region: 'region-b', scope: null });
    expect((await call(app, jar, 'GET', '/api/nodes')).json().error.code).toBe('no_scope');

    await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' });
    await call(app, jar, 'GET', '/api/nodes');
    expect(ironicCalls.at(-1)?.url.startsWith(`${IRONIC_B}/v1/nodes`)).toBe(true);
  });

  it('refuses a region Keystone does not know', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);
    expect((await call(app, jar, 'PUT', '/api/region', { region: 'nowhere' })).statusCode).toBe(400);
  });

  it('needs a region before node data or a project', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);
    expect((await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' })).json().error.code).toBe('no_region');
  });

  it('is served by any replica holding the same key, with nothing shared between them', async () => {
    const first = await server();
    const second = await server();
    const jar = new Jar();
    await signIn(first, jar);
    await call(first, jar, 'PUT', '/api/region', { region: 'region-a' });
    await call(first, jar, 'PUT', '/api/scope', { projectId: 'p1' });

    expect((await call(second, jar, 'GET', '/api/nodes')).statusCode).toBe(200);
    expect(scopedMints).toBe(1);
  });

  it('is unreadable to a server with a different key', async () => {
    const jar = new Jar();
    await signIn(await server(), jar);

    vi.stubEnv('SESSION_KEYS', Buffer.alloc(32, 9).toString('base64'));
    const stranger = await server();
    expect((await call(stranger, jar, 'GET', '/api/session')).json().authenticated).toBe(false);
  });

  it('keeps sessions signed in across a key rotation', async () => {
    const oldKey = Buffer.alloc(32, 7).toString('base64');
    const jar = new Jar();
    await signIn(await server(), jar);

    vi.stubEnv('SESSION_KEYS', `${Buffer.alloc(32, 8).toString('base64')},${oldKey}`);
    const rotated = await server();
    expect((await call(rotated, jar, 'GET', '/api/session')).json().authenticated).toBe(true);
  });

  it('fits a fully populated session in one cookie', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);
    await call(app, jar, 'PUT', '/api/region', { region: 'region-a' });
    await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' });

    const cookie = `nodedash_session=${jar.get('nodedash_session')}`;
    // Browsers drop cookies over 4096 bytes silently, which would look like an
    // endless sign-in loop. Leave headroom for larger tokens and longer names.
    expect(cookie.length).toBeLessThan(3072);
  });

  it('signs out by revoking the tokens and clearing the cookie', async () => {
    const app = await server();
    const jar = new Jar();
    await signIn(app, jar);
    await call(app, jar, 'PUT', '/api/region', { region: 'region-a' });
    await call(app, jar, 'PUT', '/api/scope', { projectId: 'p1' });

    expect((await call(app, jar, 'POST', '/api/auth/logout')).statusCode).toBe(204);
    const revoked = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'DELETE')
      .map(([, init]) => new Headers(init?.headers).get('x-subject-token'));
    expect(revoked).toEqual([UNSCOPED, scopedFor('p1')]);
    expect(jar.get('nodedash_session')).toBeUndefined();
  });
});

describe('ironicEndpoints', () => {
  it('maps each region to its baremetal URL on the wanted interface', () => {
    expect(ironicEndpoints(catalog, 'public')).toEqual({ 'region-a': IRONIC_A, 'region-b': IRONIC_B });
    expect(ironicEndpoints(catalog, 'internal')).toEqual({ 'region-a': 'http://ironic-a.internal.invalid' });
  });

  it('falls back to the older region field when region_id is missing', () => {
    const legacy = [{ type: 'baremetal', endpoints: [{ interface: 'public', region: 'old', url: IRONIC_A }] }];
    expect(ironicEndpoints(legacy, 'public')).toEqual({ old: IRONIC_A });
  });

  it('returns nothing when the catalog has no baremetal service', () => {
    expect(ironicEndpoints([catalog[1]!], 'public')).toEqual({});
  });
});
