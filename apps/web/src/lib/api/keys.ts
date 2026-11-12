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

/** Single source of truth for query keys, so invalidation cannot drift. */
export const qk = {
  session: ['session'] as const,
  /** Per region and project: each region's Ironic negotiates its own microversion. */
  capabilities: (region: string | null, projectId: string | null) =>
    ['capabilities', region, projectId] as const,
  regions: ['regions'] as const,
  scopeOptions: (search: string, domainId: string | null) => ['scope-options', search, domainId] as const,
  nodes: (projectId: string | null) => ['nodes', projectId] as const,
  node: (uuid: string) => ['node', uuid] as const,
  inventory: (uuid: string) => ['node', uuid, 'inventory'] as const,
  bios: (uuid: string) => ['node', uuid, 'bios'] as const,
  firmware: (uuid: string) => ['node', uuid, 'firmware'] as const,
  console: (uuid: string) => ['node', uuid, 'console'] as const,
  vendorPassthru: (uuid: string) => ['node', uuid, 'vendor-passthru'] as const,
  history: (uuid: string) => ['node', uuid, 'history'] as const,
  nodeLogs: (uuid: string) => ['node', uuid, 'logs'] as const,
  nodeLog: (uuid: string, id: string) => ['node', uuid, 'logs', id] as const,
  health: (uuid: string) => ['node', uuid, 'health'] as const,
  logServices: (uuid: string) => ['node', uuid, 'log-services'] as const,
  logEntries: (uuid: string, serviceId: string, severity: string | null) =>
    ['node', uuid, 'log-services', serviceId, severity] as const,
  supportAssist: (uuid: string) => ['node', uuid, 'support-assist'] as const,
  runbooks: ['runbooks'] as const,
};
