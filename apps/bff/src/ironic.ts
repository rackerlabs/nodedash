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
  buildCapabilityReport,
  negotiateMicroversion,
  type CapabilityReport,
  type IronicNode,
} from '@nodedash/shared';
import type { Config } from './config.ts';
import { fromUpstream } from './errors.ts';
import { redactSecrets } from './redact.ts';

/** How long to trust a cached microversion negotiation. */
const VERSION_CACHE_MS = 10 * 60_000;

interface IronicResponse {
  status: number;
  body: unknown;
  text: string;
}

/** Where an Ironic call goes and with which credential: one project in one region. */
export interface IronicTarget {
  token: string;
  /** Ironic base URL from the scoped token's catalog, without a trailing slash. */
  endpoint: string;
}

type RequestInit = { method?: string; body?: unknown; query?: Record<string, string | number | undefined> };

export class IronicClient {
  /**
   * Keyed by endpoint, because each region can run a different Ironic release.
   * This holds no user data: the version document is unauthenticated.
   */
  private readonly versionCache = new Map<string, { report: CapabilityReport; fetchedAt: number }>();
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Asks Ironic what it supports and settles on the highest microversion both
   * sides understand. Cached, because it only changes when the service is upgraded.
   */
  async capabilities(endpoint: string): Promise<CapabilityReport> {
    const cached = this.versionCache.get(endpoint);
    if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_MS) return cached.report;

    const response = await fetch(`${endpoint}/v1`, {
      headers: { Accept: 'application/json' },
    });
    const serverMax = response.headers.get('x-openstack-ironic-api-maximum-version');
    const report = buildCapabilityReport(serverMax);
    this.versionCache.set(endpoint, { report, fetchedAt: Date.now() });
    return report;
  }

  private async negotiatedVersion(endpoint: string): Promise<string> {
    const report = await this.capabilities(endpoint);
    return negotiateMicroversion(report.serverMaxVersion);
  }

  async request(target: IronicTarget, path: string, init: RequestInit = {}): Promise<IronicResponse> {
    const url = new URL(`${target.endpoint}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Auth-Token': target.token,
      'X-OpenStack-Ironic-API-Version': await this.negotiatedVersion(target.endpoint),
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, text };
  }

  /** Request that throws our HttpError on any non-2xx, with the upstream message. */
  async json<T = unknown>(target: IronicTarget, path: string, init: RequestInit = {}): Promise<T> {
    const result = await this.request(target, path, init);
    if (result.status >= 400) throw fromUpstream(result.status, ironicMessage(result), null);
    return redactSecrets(result.body) as T;
  }

  /**
   * Walks Ironic's marker pagination to collect a whole node listing. Bounded by
   * MAX_NODE_PAGES so a badly sized page limit cannot spin forever.
   */
  async allNodes(
    target: IronicTarget,
    options: { pageSize?: number; marker?: string } = {},
  ): Promise<{ nodes: IronicNode[]; next: string | null }> {
    const limit = options.pageSize ?? this.config.nodePageSize;
    const nodes: IronicNode[] = [];
    let marker = options.marker;

    for (let page = 0; page < this.config.maxNodePages; page += 1) {
      const result = await this.json<{ nodes: IronicNode[] }>(target, '/v1/nodes', {
        query: { detail: 'true', limit, marker },
      });
      nodes.push(...result.nodes);
      if (result.nodes.length < limit) return { nodes, next: null };
      marker = result.nodes[result.nodes.length - 1]?.uuid;
      if (!marker) return { nodes, next: null };
    }

    // Hit the page cap: hand the caller a marker so it can decide to continue.
    return { nodes, next: marker ?? null };
  }
}

/** Ironic puts its human-readable error in error_message, sometimes as JSON. */
export function ironicMessage(result: IronicResponse): string {
  const body = result.body as { error_message?: unknown } | null;
  const raw = body?.error_message;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { faultstring?: string; error_message?: { faultstring?: string } };
      return parsed.faultstring ?? parsed.error_message?.faultstring ?? raw;
    } catch {
      return raw;
    }
  }
  if (raw && typeof raw === 'object') {
    const faultstring = (raw as { faultstring?: string }).faultstring;
    if (faultstring) return faultstring;
  }
  return result.text.slice(0, 300) || `Ironic returned status ${result.status}.`;
}
