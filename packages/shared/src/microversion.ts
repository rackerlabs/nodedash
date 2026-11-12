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

/**
 * Ironic API microversion handling.
 *
 * Every feature this UI depends on landed in a specific microversion, so rather
 * than pinning a floor and failing on older regions we negotiate the highest
 * version the server offers and derive a capability set from it.
 */

/** Highest microversion this client knows how to speak. */
export const CLIENT_MAX_MICROVERSION = '1.114';

export interface Microversion {
  major: number;
  minor: number;
}

export function parseMicroversion(value: string | null | undefined): Microversion | null {
  if (!value) return null;
  const match = /^(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function formatMicroversion(v: Microversion): string {
  return `${v.major}.${v.minor}`;
}

/** Negative if a < b, zero if equal, positive if a > b. */
export function compareMicroversion(a: Microversion, b: Microversion): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

export function atLeast(current: Microversion | null, required: string): boolean {
  const needed = parseMicroversion(required);
  if (!current || !needed) return false;
  return compareMicroversion(current, needed) >= 0;
}

/**
 * The microversion we actually send: the lower of what the server supports and
 * what this client understands. Sending a version the server does not know
 * makes it reject the request outright.
 */
export function negotiateMicroversion(serverMax: string | null | undefined): string {
  const server = parseMicroversion(serverMax);
  const client = parseMicroversion(CLIENT_MAX_MICROVERSION)!;
  if (!server) return '1.1';
  return formatMicroversion(compareMicroversion(server, client) < 0 ? server : client);
}

/**
 * Microversion each capability requires, for gating UI and error messages.
 *
 * `graphicalConsole` is the one number here that is not confirmed against
 * upstream release notes; it is overridable so it can be corrected once we have
 * verified it against a live deployment (see IRONIC_GRAPHICAL_CONSOLE_MICROVERSION).
 *
 * Note there is deliberately no entry for `instance_name`: it exists as a real
 * node field on recent servers but the upstream api-ref does not say from which
 * microversion, so `resolveInstanceName` detects it by presence instead.
 */
export const CAPABILITY_MICROVERSIONS = {
  nodeHistory: '1.78',
  inventory: '1.81',
  firmware: '1.86',
  serviceSteps: '1.87',
  runbooks: '1.92',
  runbookTraits: '1.112',
  graphicalConsole: '1.99',
} as const;

export type CapabilityName = keyof typeof CAPABILITY_MICROVERSIONS;

export type Capabilities = Record<CapabilityName, boolean>;

export interface CapabilityReport {
  /** Raw value of x-openstack-ironic-api-maximum-version from the server. */
  serverMaxVersion: string | null;
  /** Version we negotiated and send on every request. */
  negotiatedVersion: string;
  capabilities: Capabilities;
}

export function deriveCapabilities(negotiated: string | null | undefined): Capabilities {
  const current = parseMicroversion(negotiated);
  const out = {} as Capabilities;
  for (const name of Object.keys(CAPABILITY_MICROVERSIONS) as CapabilityName[]) {
    out[name] = atLeast(current, CAPABILITY_MICROVERSIONS[name]);
  }
  return out;
}

export function buildCapabilityReport(serverMaxVersion: string | null | undefined): CapabilityReport {
  const negotiatedVersion = negotiateMicroversion(serverMaxVersion);
  return {
    serverMaxVersion: serverMaxVersion ?? null,
    negotiatedVersion,
    capabilities: deriveCapabilities(negotiatedVersion),
  };
}
