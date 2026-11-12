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

import type { IronicNode, Runbook } from './ironic.ts';
import { toneLookup, type Tone } from './tone.ts';

/**
 * Ironic exposes `instance_name` as a real node field on recent servers. Older
 * ones only carry the Nova-supplied name inside `instance_info`, so resolve the
 * native field first and fall back. Both the mock backend and the real client go
 * through this one function so the two paths cannot disagree.
 */
export function resolveInstanceName(node: IronicNode): string | null {
  if (typeof node.instance_name === 'string' && node.instance_name.length > 0) {
    return node.instance_name;
  }
  const info = node.instance_info ?? {};
  for (const key of ['display_name', 'hostname', 'name'] as const) {
    const candidate = info[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

/** Flat, string-friendly projection used by the node table for sort and search. */
export interface NodeRow {
  uuid: string;
  name: string | null;
  provisionState: string | null;
  targetProvisionState: string | null;
  powerState: string | null;
  targetPowerState: string | null;
  instanceUuid: string | null;
  instanceName: string | null;
  maintenance: boolean;
  maintenanceReason: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export function toNodeRow(node: IronicNode): NodeRow {
  return {
    uuid: node.uuid,
    name: node.name ?? null,
    provisionState: node.provision_state ?? null,
    targetProvisionState: node.target_provision_state ?? null,
    powerState: node.power_state ?? null,
    targetPowerState: node.target_power_state ?? null,
    instanceUuid: node.instance_uuid ?? null,
    instanceName: resolveInstanceName(node),
    maintenance: node.maintenance === true,
    maintenanceReason: node.maintenance_reason ?? null,
    lastError: node.last_error ?? null,
    updatedAt: node.updated_at ?? null,
  };
}

/** Label shown to the operator for a node with no name set. */
export function nodeDisplayName(node: Pick<NodeRow, 'name' | 'uuid'>): string {
  return node.name ?? node.uuid;
}

export const POWER_TARGETS = [
  'power on',
  'power off',
  'rebooting',
  'soft power off',
  'soft rebooting',
] as const;
export type PowerTarget = (typeof POWER_TARGETS)[number];

export const POWER_TARGET_LABELS: Record<PowerTarget, string> = {
  'power on': 'Power on',
  'power off': 'Power off (hard)',
  rebooting: 'Reboot (hard)',
  'soft power off': 'Power off (graceful)',
  'soft rebooting': 'Reboot (graceful)',
};

/** Hard power actions cut power without telling the OS. */
export function isHardPowerTarget(target: PowerTarget): boolean {
  return target === 'power off' || target === 'rebooting';
}

/**
 * A hard power action on a node that is running a tenant instance can destroy
 * work, so the UI demands the node name be typed before it will submit.
 */
export function requiresTypedConfirmation(
  target: PowerTarget,
  node: Pick<NodeRow, 'instanceUuid'>,
): boolean {
  return isHardPowerTarget(target) && Boolean(node.instanceUuid);
}

/** @deprecated name kept for existing call sites; this is just {@link Tone}. */
export type ProvisionTone = Tone;

const PROVISION_TONES: Record<string, Tone> = {
  active: 'active',
  available: 'available',
  enroll: 'neutral',
  manageable: 'neutral',
  verifying: 'transient',
  inspecting: 'transient',
  'inspect wait': 'transient',
  cleaning: 'transient',
  'clean wait': 'transient',
  deploying: 'transient',
  'wait call-back': 'transient',
  deleting: 'transient',
  rescuing: 'transient',
  unrescuing: 'transient',
  servicing: 'transient',
  'service wait': 'transient',
  adopting: 'transient',
  error: 'error',
  'deploy failed': 'error',
  'clean failed': 'error',
  'inspect failed': 'error',
  'rescue failed': 'error',
  'unrescue failed': 'error',
  'service failed': 'error',
  'adopt failed': 'error',
  rescue: 'active',
};

export const provisionTone = toneLookup(PROVISION_TONES);

/** States that mean Ironic is mid-operation and the page should keep polling. */
export function isTransientProvisionState(state: string | null | undefined): boolean {
  return provisionTone(state) === 'transient';
}

/**
 * Runbooks can only be applied through the `service` verb, which Ironic accepts
 * only on an already-deployed node.
 */
export function canRunServiceSteps(node: Pick<NodeRow, 'provisionState' | 'maintenance'>): {
  allowed: boolean;
  reason?: string;
} {
  if (node.provisionState !== 'active') {
    return {
      allowed: false,
      reason: `Service steps require the node to be active (currently ${node.provisionState ?? 'unknown'}).`,
    };
  }
  if (node.maintenance) {
    return {
      allowed: false,
      reason: 'Ironic will not accept provisioning actions while the node is in maintenance.',
    };
  }
  return { allowed: true };
}

/**
 * Ironic matches a runbook to a node by trait: the node must carry a trait the
 * runbook declares. On 1.112+ the runbook reports its traits directly, which is
 * what we match on; before that a runbook's *name* had to be a trait the node
 * carried, so fall back to that rule.
 */
export function runbookMatchesNode(
  runbook: Pick<Runbook, 'name' | 'traits'>,
  nodeTraits: readonly string[],
  options: { runbookTraits: boolean },
): boolean {
  const traits = new Set(nodeTraits);
  if (options.runbookTraits && runbook.traits && runbook.traits.length > 0) {
    return runbook.traits.some((trait) => traits.has(trait));
  }
  return traits.has(runbook.name);
}
