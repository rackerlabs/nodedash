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
  capabilities: (region: string, projectId: string | null) =>
    ['capabilities', region, projectId] as const,
  regions: ['regions'] as const,
  scopeOptions: (search: string, domainId: string | null) => ['scope-options', search, domainId] as const,
  nodes: (region: string, projectId: string | null) => ['nodes', region, projectId] as const,
  node: (region: string, uuid: string) => ['node', region, uuid] as const,
  inventory: (region: string, uuid: string) => ['node', region, uuid, 'inventory'] as const,
  bios: (region: string, uuid: string) => ['node', region, uuid, 'bios'] as const,
  firmware: (region: string, uuid: string) => ['node', region, uuid, 'firmware'] as const,
  console: (region: string, uuid: string) => ['node', region, uuid, 'console'] as const,
  vendorPassthru: (region: string, uuid: string) => ['node', region, uuid, 'vendor-passthru'] as const,
  history: (region: string, uuid: string) => ['node', region, uuid, 'history'] as const,
  nodeLogs: (region: string, uuid: string) => ['node', region, uuid, 'logs'] as const,
  nodeLog: (region: string, uuid: string, id: string) => ['node', region, uuid, 'logs', id] as const,
  health: (region: string, uuid: string) => ['node', region, uuid, 'health'] as const,
  logServices: (region: string, uuid: string) => ['node', region, uuid, 'log-services'] as const,
  logEntries: (region: string, uuid: string, serviceId: string, severity: string | null) =>
    ['node', region, uuid, 'log-services', serviceId, severity] as const,
  supportAssist: (region: string, uuid: string) => ['node', region, uuid, 'support-assist'] as const,
  runbooks: (region: string) => ['runbooks', region] as const,
};
