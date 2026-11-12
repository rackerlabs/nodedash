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

import {
  createMockBackend,
  MockApiError,
  type MockBackend,
  type PersistedAuth,
} from '@nodedash/mock';
import { delay, http, HttpResponse } from 'msw';
import { activeScenario } from './scenario';

/**
 * Sign-in survives a reload, the same way a real session cookie would. Scoped to
 * the tab (sessionStorage) and to the scenario, so switching scenarios starts clean.
 */
const AUTH_KEY = `nodedash.mock.auth.${activeScenario().id}`;

const persistence = {
  load(): PersistedAuth | null {
    try {
      const raw = window.sessionStorage.getItem(AUTH_KEY);
      return raw ? (JSON.parse(raw) as PersistedAuth) : null;
    } catch {
      return null;
    }
  },
  save(auth: PersistedAuth): void {
    try {
      window.sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    } catch {
      // Nothing to do; the reviewer just has to sign in again after a reload.
    }
  },
};

export const backend: MockBackend = createMockBackend({
  scenario: activeScenario(),
  consoleBasePath: '/mock-console',
  persistence,
});

// Exposed so end-to-end tests (and a curious reviewer in the console) can reach
// the fixture set to build deep links and assert against known data.
declare global {
  interface Window {
    __mockBackend?: MockBackend;
  }
}
window.__mockBackend = backend;

/** A handler may return a ready-made Response (a file download) instead of JSON. */
type Handler = () => unknown;

async function respond(handler: Handler, options: { read?: boolean } = {}) {
  await delay(backend.latencyMs());
  if (options.read && backend.shouldFailRead()) {
    return HttpResponse.json(
      { error: { code: 'upstream_error', message: 'Ironic API returned 500 (simulated failure).' } },
      { status: 502 },
    );
  }
  try {
    if (!options.read) backend.assertMutationAllowed();
    const payload = handler();
    if (payload instanceof Response) return payload;
    return payload === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(payload);
  } catch (error) {
    if (error instanceof MockApiError) {
      return HttpResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return HttpResponse.json(
      { error: { code: 'upstream_error', message: String(error) } },
      { status: 500 },
    );
  }
}

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export const handlers = [
  http.get('/api/session', () => respond(() => backend.getSession(), { read: true })),
  http.post('/api/auth/dev-login', async ({ request }) => {
    const { idp } = await body<{ idp?: string }>(request);
    return respond(() => backend.login(idp ?? 'corp-sso'));
  }),
  http.post('/api/auth/logout', () =>
    respond(() => {
      backend.logout();
      return undefined;
    }),
  ),

  http.get('/api/capabilities', () => respond(() => backend.getCapabilities(), { read: true })),

  http.get('/api/regions', () => respond(() => backend.getRegions(), { read: true })),
  http.put('/api/region', async ({ request }) => {
    const { region } = await body<{ region: string }>(request);
    return respond(() => backend.setRegion(region));
  }),

  http.get('/api/scope/options', ({ request }) => {
    const url = new URL(request.url);
    return respond(
      () =>
        backend.getScopeOptions({
          search: url.searchParams.get('search') ?? undefined,
          domainId: url.searchParams.get('domainId') ?? undefined,
        }),
      { read: true },
    );
  }),
  http.put('/api/scope', async ({ request }) => {
    const { projectId } = await body<{ projectId: string }>(request);
    return respond(() => backend.setScope(projectId));
  }),
  http.delete('/api/scope', () => respond(() => backend.clearScope())),

  http.get('/api/nodes', ({ request }) => {
    const url = new URL(request.url);
    return respond(
      () =>
        backend.listNodes({
          limit: Number(url.searchParams.get('limit') ?? 500),
          marker: url.searchParams.get('marker') ?? undefined,
        }),
      { read: true },
    );
  }),
  http.get('/api/nodes/:uuid', ({ params }) =>
    respond(() => backend.getNode(String(params.uuid)), { read: true }),
  ),
  http.post('/api/nodes/:uuid/locate', ({ params }) =>
    respond(() => backend.locateNode(String(params.uuid))),
  ),

  http.put('/api/nodes/:uuid/maintenance', async ({ params, request }) => {
    const { reason } = await body<{ reason: string }>(request);
    return respond(() => backend.setMaintenance(String(params.uuid), reason ?? ''));
  }),
  http.delete('/api/nodes/:uuid/maintenance', ({ params }) =>
    respond(() => backend.clearMaintenance(String(params.uuid))),
  ),
  http.put('/api/nodes/:uuid/power', async ({ params, request }) => {
    const { target } = await body<{ target: never }>(request);
    return respond(() => {
      backend.setPower(String(params.uuid), target);
      return undefined;
    });
  }),

  http.get('/api/nodes/:uuid/inventory', ({ params }) =>
    respond(() => backend.getInventory(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/bios', ({ params }) =>
    respond(() => backend.getBios(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/firmware', ({ params }) =>
    respond(() => backend.getFirmware(String(params.uuid)), { read: true }),
  ),

  http.get('/api/runbooks', () => respond(() => backend.listRunbooks(), { read: true })),
  http.put('/api/nodes/:uuid/service', async ({ params, request }) => {
    const { runbook } = await body<{ runbook: string }>(request);
    return respond(() => {
      backend.runRunbook(String(params.uuid), runbook);
      return undefined;
    });
  }),

  http.get('/api/nodes/:uuid/history', ({ params, request }) => {
    const url = new URL(request.url);
    return respond(
      () =>
        backend.getHistory(String(params.uuid), {
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
        }),
      { read: true },
    );
  }),
  http.get('/api/nodes/:uuid/logs', ({ params }) =>
    respond(() => backend.listNodeLogs(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/logs/:id', ({ params }) =>
    respond(() => backend.getNodeLog(String(params.uuid), String(params.id)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/health', ({ params }) =>
    respond(() => backend.getHealth(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/log-services', ({ params }) =>
    respond(() => backend.listLogServices(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/log-services/:serviceId/entries', ({ params, request }) => {
    const url = new URL(request.url);
    return respond(
      () =>
        backend.getLogEntries(String(params.uuid), String(params.serviceId), {
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          marker: url.searchParams.get('marker') ?? undefined,
          severity: url.searchParams.get('severity') ?? undefined,
        }),
      { read: true },
    );
  }),

  http.get('/api/nodes/:uuid/vendor-passthru/methods', ({ params }) =>
    respond(() => backend.vendorPassthruMethods(String(params.uuid)), { read: true }),
  ),
  http.get('/api/nodes/:uuid/support-assist', ({ params }) =>
    respond(() => backend.listSupportAssist(String(params.uuid)), { read: true }),
  ),
  http.post('/api/nodes/:uuid/support-assist', async ({ params, request }) => {
    const payload = await body<{ data_selectors?: never[]; filter_pii?: boolean }>(request);
    return respond(() =>
      backend.startSupportAssist(String(params.uuid), {
        data_selectors: payload.data_selectors ?? [],
        filter_pii: payload.filter_pii !== false,
      }),
    );
  }),
  /**
   * The real BFF redirects to short-lived object storage. The mock has no storage,
   * so it serves the placeholder bundle directly — either way the browser follows
   * one URL and gets a file, which is what the UI depends on.
   */
  http.get('/api/nodes/:uuid/support-assist/:id/download', ({ params }) =>
    respond(() => {
      const file = backend.downloadSupportAssist(String(params.uuid), String(params.id));
      return new HttpResponse(file.body, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
        },
      });
    }, { read: true }),
  ),

  http.get('/api/nodes/:uuid/console', ({ params }) =>
    respond(() => backend.getConsole(String(params.uuid)), { read: true }),
  ),
  http.put('/api/nodes/:uuid/console', async ({ params, request }) => {
    const { enabled } = await body<{ enabled: boolean }>(request);
    return respond(() => {
      backend.setConsole(String(params.uuid), Boolean(enabled));
      return undefined;
    });
  }),
];
