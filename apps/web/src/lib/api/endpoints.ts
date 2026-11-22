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
  BiosSettingsListSchema,
  CapabilitiesResponseSchema,
  FirmwareListSchema,
  LocateResultSchema,
  NodeConsoleSchema,
  NodeInventorySchema,
  PortListSchema,
  NodeListSchema,
  NodeSchema,
  RunbookListSchema,
  LogEntryListSchema,
  LogServiceListSchema,
  NodeHealthSchema,
  NodeHistoryListSchema,
  NodeLogArchiveListSchema,
  NodeLogContentSchema,
  RegionListSchema,
  ScopeOptionsSchema,
  SessionSchema,
  SupportAssistEulaSchema,
  SupportAssistTaskSchema,
  SupportAssistJobSchema,
  VendorPassthruMethodsSchema,
  type IronicNode,
  type PowerTarget,
} from '@nodedash/shared';
import { IS_MOCK } from '@/lib/env';
import { ApiRequestError, request } from './client';

const enc = encodeURIComponent;

export const api = {
  session: () => request('/session', { schema: SessionSchema }),

  /**
   * Real deployments hand off to Keystone WebSSO, which has to be a full page
   * navigation: the IdP will not render inside fetch. The mock backend has no IdP,
   * so it gets a direct sign-in call instead.
   */
  async beginLogin(idp: string, nextPath: string): Promise<void> {
    if (IS_MOCK) {
      try {
        await request('/auth/dev-login', { method: 'POST', body: { idp } });
      } catch (error) {
        if (!(error instanceof ApiRequestError)) throw error;
        // Where the BFF sends the browser when Keystone rejects the callback token.
        const failed = new URL('/login', window.location.origin);
        failed.searchParams.set('error', 'login_failed');
        failed.searchParams.set('next', nextPath);
        window.location.assign(failed.toString());
      }
      return;
    }
    const url = new URL('/api/auth/login', window.location.origin);
    url.searchParams.set('idp', idp);
    url.searchParams.set('next', nextPath);
    window.location.assign(url.toString());
  },

  logout: () => request('/auth/logout', { method: 'POST' }),

  capabilities: (region: string) =>
    request(`/capabilities/${enc(region)}`, { schema: CapabilitiesResponseSchema }),

  regions: () => request('/regions', { schema: RegionListSchema }),

  scopeOptions: (params: { search?: string; domainId?: string } = {}) =>
    request('/scope/options', {
      schema: ScopeOptionsSchema,
      query: { search: params.search, domainId: params.domainId },
    }),

  setScope: (projectId: string) =>
    request('/scope', { method: 'PUT', body: { projectId }, schema: SessionSchema }),

  clearScope: () => request('/scope', { method: 'DELETE', schema: SessionSchema }),

  /**
   * Ironic pages node listings; the fleet view needs the whole set to sort and
   * filter locally, so walk the markers and report progress as we go.
   */
  async allNodes(
    region: string,
    options: {
      signal?: AbortSignal;
      onProgress?: (loaded: number) => void;
      pageSize?: number;
      maxPages?: number;
    } = {},
  ): Promise<IronicNode[]> {
    const { signal, onProgress, pageSize = 500, maxPages = 40 } = options;
    const nodes: IronicNode[] = [];
    let marker: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await request(`/nodes/${enc(region)}`, {
        schema: NodeListSchema,
        signal,
        query: { limit: pageSize, marker },
      });
      nodes.push(...result.nodes);
      onProgress?.(nodes.length);
      if (!result.next) break;
      marker = result.next;
    }
    return nodes;
  },

  node: (region: string, uuid: string, signal?: AbortSignal) =>
    request(`/nodes/${enc(region)}/${uuid}`, { schema: NodeSchema, signal }),

  locateNode: (region: string, uuid: string, signal?: AbortSignal) =>
    request(`/nodes/${enc(region)}/${uuid}/locate`, { method: 'POST', schema: LocateResultSchema, signal }),

  setExtra: (region: string, uuid: string, values: Record<string, string>) =>
    request(`/nodes/${enc(region)}/${uuid}/extra`, { method: 'PATCH', body: { values }, schema: NodeSchema }),

  setMaintenance: (region: string, uuid: string, reason: string) =>
    request(`/nodes/${enc(region)}/${uuid}/maintenance`, {
      method: 'PUT',
      body: { reason },
      schema: NodeSchema,
    }),

  clearMaintenance: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/maintenance`, { method: 'DELETE', schema: NodeSchema }),

  setPower: (region: string, uuid: string, target: PowerTarget) =>
    request(`/nodes/${enc(region)}/${uuid}/power`, { method: 'PUT', body: { target } }),

  inventory: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/inventory`, { schema: NodeInventorySchema }),

  ports: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/ports`, { schema: PortListSchema }),

  bios: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/bios`, { schema: BiosSettingsListSchema }),

  firmware: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/firmware`, { schema: FirmwareListSchema }),

  runbooks: (region: string) => request(`/runbooks/${enc(region)}`, { schema: RunbookListSchema }),

  runRunbook: (region: string, uuid: string, runbook: string) =>
    request(`/nodes/${enc(region)}/${uuid}/service`, { method: 'PUT', body: { runbook } }),

  history: (region: string, uuid: string, limit = 200) =>
    request(`/nodes/${enc(region)}/${uuid}/history`, { schema: NodeHistoryListSchema, query: { limit } }),

  nodeLogs: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/logs`, { schema: NodeLogArchiveListSchema }),

  nodeLog: (region: string, uuid: string, id: string) =>
    request(`/nodes/${enc(region)}/${uuid}/logs/${id}`, { schema: NodeLogContentSchema }),

  health: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/health`, { schema: NodeHealthSchema }),

  logServices: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/log-services`, { schema: LogServiceListSchema }),

  logEntries: (
    region: string,
    uuid: string,
    serviceId: string,
    params: { limit?: number; marker?: string; severity?: string } = {},
  ) =>
    request(`/nodes/${enc(region)}/${uuid}/log-services/${serviceId}/entries`, {
      schema: LogEntryListSchema,
      query: { limit: params.limit, marker: params.marker, severity: params.severity },
    }),

  vendorPassthruMethods: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/vendor-passthru/methods`, { schema: VendorPassthruMethodsSchema }),

  supportAssistEula: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/support-assist/eula`, { schema: SupportAssistEulaSchema }),

  startSupportAssist: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/support-assist`, {
      method: 'POST',
      schema: SupportAssistTaskSchema,
    }),

  supportAssistJob: (region: string, uuid: string, task_monitor: string) =>
    request(`/nodes/${enc(region)}/${uuid}/support-assist/job`, {
      method: 'POST',
      body: { task_monitor },
      schema: SupportAssistJobSchema,
    }),

  console: (region: string, uuid: string) =>
    request(`/nodes/${enc(region)}/${uuid}/console`, { schema: NodeConsoleSchema }),

  setConsole: (region: string, uuid: string, enabled: boolean) =>
    request(`/nodes/${enc(region)}/${uuid}/console`, { method: 'PUT', body: { enabled } }),
};
