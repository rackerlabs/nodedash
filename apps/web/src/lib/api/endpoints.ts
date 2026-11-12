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
  SupportAssistCollectionListSchema,
  SupportAssistCollectionSchema,
  VendorPassthruMethodsSchema,
  type IronicNode,
  type PowerTarget,
  type SupportAssistStartRequest,
} from '@nodedash/shared';
import { IS_MOCK } from '@/lib/env';
import { request } from './client';

export const api = {
  session: () => request('/session', { schema: SessionSchema }),

  /**
   * Real deployments hand off to Keystone WebSSO, which has to be a full page
   * navigation: the IdP will not render inside fetch. The mock backend has no IdP,
   * so it gets a direct sign-in call instead.
   */
  async beginLogin(idp: string, nextPath: string): Promise<void> {
    if (IS_MOCK) {
      await request('/auth/dev-login', { method: 'POST', body: { idp } });
      return;
    }
    const url = new URL('/api/auth/login', window.location.origin);
    url.searchParams.set('idp', idp);
    url.searchParams.set('next', nextPath);
    window.location.assign(url.toString());
  },

  logout: () => request('/auth/logout', { method: 'POST' }),

  capabilities: () => request('/capabilities', { schema: CapabilitiesResponseSchema }),

  regions: () => request('/regions', { schema: RegionListSchema }),

  setRegion: (region: string) =>
    request('/region', { method: 'PUT', body: { region }, schema: SessionSchema }),

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
  async allNodes(options: {
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
    pageSize?: number;
    maxPages?: number;
  } = {}): Promise<IronicNode[]> {
    const { signal, onProgress, pageSize = 500, maxPages = 40 } = options;
    const nodes: IronicNode[] = [];
    let marker: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await request('/nodes', {
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

  node: (uuid: string, signal?: AbortSignal) =>
    request(`/nodes/${uuid}`, { schema: NodeSchema, signal }),

  locateNode: (uuid: string, signal?: AbortSignal) =>
    request(`/nodes/${uuid}/locate`, { method: 'POST', schema: LocateResultSchema, signal }),

  setMaintenance: (uuid: string, reason: string) =>
    request(`/nodes/${uuid}/maintenance`, { method: 'PUT', body: { reason }, schema: NodeSchema }),

  clearMaintenance: (uuid: string) =>
    request(`/nodes/${uuid}/maintenance`, { method: 'DELETE', schema: NodeSchema }),

  setPower: (uuid: string, target: PowerTarget) =>
    request(`/nodes/${uuid}/power`, { method: 'PUT', body: { target } }),

  inventory: (uuid: string) => request(`/nodes/${uuid}/inventory`, { schema: NodeInventorySchema }),

  bios: (uuid: string) => request(`/nodes/${uuid}/bios`, { schema: BiosSettingsListSchema }),

  firmware: (uuid: string) => request(`/nodes/${uuid}/firmware`, { schema: FirmwareListSchema }),

  runbooks: () => request('/runbooks', { schema: RunbookListSchema }),

  runRunbook: (uuid: string, runbook: string) =>
    request(`/nodes/${uuid}/service`, { method: 'PUT', body: { runbook } }),

  history: (uuid: string, limit = 200) =>
    request(`/nodes/${uuid}/history`, { schema: NodeHistoryListSchema, query: { limit } }),

  nodeLogs: (uuid: string) => request(`/nodes/${uuid}/logs`, { schema: NodeLogArchiveListSchema }),

  nodeLog: (uuid: string, id: string) =>
    request(`/nodes/${uuid}/logs/${id}`, { schema: NodeLogContentSchema }),

  health: (uuid: string) => request(`/nodes/${uuid}/health`, { schema: NodeHealthSchema }),

  logServices: (uuid: string) =>
    request(`/nodes/${uuid}/log-services`, { schema: LogServiceListSchema }),

  logEntries: (
    uuid: string,
    serviceId: string,
    params: { limit?: number; marker?: string; severity?: string } = {},
  ) =>
    request(`/nodes/${uuid}/log-services/${serviceId}/entries`, {
      schema: LogEntryListSchema,
      query: { limit: params.limit, marker: params.marker, severity: params.severity },
    }),

  vendorPassthruMethods: (uuid: string) =>
    request(`/nodes/${uuid}/vendor-passthru/methods`, { schema: VendorPassthruMethodsSchema }),

  supportAssist: (uuid: string) =>
    request(`/nodes/${uuid}/support-assist`, { schema: SupportAssistCollectionListSchema }),

  startSupportAssist: (uuid: string, body: SupportAssistStartRequest) =>
    request(`/nodes/${uuid}/support-assist`, {
      method: 'POST',
      body,
      schema: SupportAssistCollectionSchema,
    }),

  /**
   * A plain URL rather than a fetch: the bundle is large and the server answers
   * with a redirect to storage, so the browser should own the download.
   */
  supportAssistDownloadUrl: (uuid: string, id: string) =>
    `/api/nodes/${encodeURIComponent(uuid)}/support-assist/${encodeURIComponent(id)}/download`,

  console: (uuid: string) => request(`/nodes/${uuid}/console`, { schema: NodeConsoleSchema }),

  setConsole: (uuid: string, enabled: boolean) =>
    request(`/nodes/${uuid}/console`, { method: 'PUT', body: { enabled } }),
};
