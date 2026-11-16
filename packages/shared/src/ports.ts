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

import type { IronicPort } from './ironic.ts';

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
