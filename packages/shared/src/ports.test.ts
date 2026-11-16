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

import { describe, expect, it } from 'vitest';
import type { IronicPort } from './ironic.ts';
import { portVif, toPortRow } from './ports.ts';

function port(overrides: Partial<IronicPort> = {}): IronicPort {
  return {
    uuid: 'aaaaaaaa-0000-4000-a000-000000000001',
    address: '02:00:5e:00:53:01',
    ...overrides,
  };
}

describe('portVif', () => {
  it('is null when nothing is attached', () => {
    expect(portVif(port())).toBeNull();
    expect(portVif(port({ internal_info: {} }))).toBeNull();
  });

  it('names the purpose from the internal_info key', () => {
    const info = { cleaning_vif_port_id: 'vif-1' };
    expect(portVif(port({ internal_info: info }))).toEqual({ id: 'vif-1', purpose: 'cleaning' });
  });

  it('prefers the tenant VIF when several are recorded', () => {
    const info = { cleaning_vif_port_id: 'vif-1', tenant_vif_port_id: 'vif-2' };
    expect(portVif(port({ internal_info: info }))).toEqual({ id: 'vif-2', purpose: 'tenant' });
  });

  it('ignores an empty or non-string value', () => {
    expect(portVif(port({ internal_info: { tenant_vif_port_id: '' } }))).toBeNull();
    expect(portVif(port({ internal_info: { tenant_vif_port_id: 7 } }))).toBeNull();
  });
});

describe('toPortRow', () => {
  it('normalises a port with nothing optional set', () => {
    expect(toPortRow(port())).toEqual({
      uuid: 'aaaaaaaa-0000-4000-a000-000000000001',
      name: null,
      address: '02:00:5e:00:53:01',
      switchName: null,
      switchId: null,
      switchPort: null,
      pxeEnabled: false,
      portgroupUuid: null,
      vif: null,
      physicalNetwork: null,
      category: null,
      isSmartnic: false,
    });
  });

  it('reads the switch and port from local_link_connection', () => {
    const row = toPortRow(
      port({
        local_link_connection: {
          switch_id: '02:00:5e:00:53:ff',
          port_id: 'Ethernet1/35',
          switch_info: 'sw01.north1.example.invalid',
        },
        physical_network: 'north1-network',
        category: 'network',
      }),
    );
    expect(row).toMatchObject({
      switchName: 'sw01.north1.example.invalid',
      switchId: '02:00:5e:00:53:ff',
      switchPort: 'Ethernet1/35',
      physicalNetwork: 'north1-network',
      category: 'network',
    });
  });
});
