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

import type { IronicPort, NodeInventory } from './ironic.ts';

/**
 * Where Neutron's VIF for a port is recorded, keyed by what the VIF is for.
 * Ironic keeps these in `internal_info`; the first one present wins, with the
 * tenant VIF first because it is the one an operator is almost always after.
 */
const VIF_KEYS = [
  ['tenant_vif_port_id', 'tenant'],
  ['provisioning_vif_port_id', 'provisioning'],
  ['cleaning_vif_port_id', 'cleaning'],
  ['rescuing_vif_port_id', 'rescuing'],
  ['inspection_vif_port_id', 'inspection'],
] as const;

export interface PortVif {
  id: string;
  purpose: (typeof VIF_KEYS)[number][1];
}

export function portVif(port: IronicPort): PortVif | null {
  const info = port.internal_info ?? {};
  for (const [key, purpose] of VIF_KEYS) {
    const id = info[key];
    if (typeof id === 'string' && id.length > 0) return { id, purpose };
  }
  return null;
}

/** Flat projection of a port for the Ports tab: where it plugs in, and what is attached. */
export interface PortRow {
  uuid: string;
  name: string | null;
  address: string;
  /** `switch_info` is the switch's name; fall back to its id (a MAC) when unnamed. */
  switchName: string | null;
  switchId: string | null;
  switchPort: string | null;
  pxeEnabled: boolean;
  portgroupUuid: string | null;
  vif: PortVif | null;
  physicalNetwork: string | null;
  category: string | null;
  isSmartnic: boolean;
}

export function toPortRow(port: IronicPort): PortRow {
  const link = port.local_link_connection ?? {};
  return {
    uuid: port.uuid,
    name: port.name ?? null,
    address: port.address,
    switchName: link.switch_info ?? null,
    switchId: link.switch_id ?? null,
    switchPort: link.port_id ?? null,
    pxeEnabled: port.pxe_enabled === true,
    portgroupUuid: port.portgroup_uuid ?? null,
    vif: portVif(port),
    physicalNetwork: port.physical_network ?? null,
    category: port.category ?? null,
    isSmartnic: port.is_smartnic === true,
  };
}

/** What the switch told the node over LLDP during inspection. */
export interface PortLldp {
  switchName: string | null;
  switchPort: string | null;
  chassisId: string | null;
}

/** What inspection writes for an interface that heard no LLDP frame, instead of leaving it out. */
const LLDP_ABSENT = 'not available';

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.toLowerCase() === LLDP_ABSENT ? null : value;
}

/**
 * LLDP neighbours by MAC address. Inspection records the parsed neighbour of each
 * interface under `plugin_data.parsed_lldp`, keyed by interface name, while the
 * MAC lives on the inventory's interface list, so the two are joined here. Ironic
 * ports are matched on that MAC. Interfaces that heard no neighbour are left out.
 *
 * Inspection records only the chassis id (a MAC) and port id; a switch name is
 * there only when the collector also parsed `switch_system_name`.
 */
export function lldpByMac(
  data: Pick<NodeInventory, 'inventory' | 'plugin_data'> | null | undefined,
): Map<string, PortLldp> {
  const result = new Map<string, PortLldp>();
  const parsed = data?.plugin_data?.parsed_lldp;
  if (!parsed || typeof parsed !== 'object') return result;

  for (const nic of data?.inventory.interfaces ?? []) {
    const neighbour = nic.name ? (parsed as Record<string, unknown>)[nic.name] : null;
    if (!nic.mac_address || !neighbour || typeof neighbour !== 'object') continue;
    const fields = neighbour as Record<string, unknown>;
    const lldp = {
      switchName: text(fields.switch_system_name),
      switchPort: text(fields.switch_port_id),
      chassisId: text(fields.switch_chassis_id),
    };
    if (lldp.switchName || lldp.switchPort || lldp.chassisId) result.set(nic.mac_address.toLowerCase(), lldp);
  }
  return result;
}

/**
 * True when the switch reports a different switch or port than Ironic is
 * configured with, which usually means the node was recabled or the port's
 * local_link_connection is stale. Only fields known on both sides are compared,
 * so missing data is never flagged. The switch is matched by chassis id against
 * Ironic's switch_id (both MACs) and, when the neighbour is named, by name too.
 */
export function lldpMismatch(
  port: Pick<PortRow, 'switchName' | 'switchId' | 'switchPort'>,
  lldp: PortLldp | null,
): boolean {
  if (!lldp) return false;
  const differs = (configured: string | null, seen: string | null) =>
    configured !== null && seen !== null && configured.toLowerCase() !== seen.toLowerCase();
  return (
    differs(port.switchId, lldp.chassisId) ||
    differs(port.switchName, lldp.switchName) ||
    differs(port.switchPort, lldp.switchPort)
  );
}
