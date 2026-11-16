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
import { lldpByMac, lldpMismatch, portVif, toPortRow } from './ports.ts';

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

describe('lldpByMac', () => {
  const inventory = {
    interfaces: [
      { name: 'eno1', mac_address: '02:00:5E:00:53:01' },
      { name: 'eno2', mac_address: '02:00:5e:00:53:02' },
    ],
  };

  it('joins the parsed neighbour of each interface to its MAC, lower-cased', () => {
    const map = lldpByMac({
      inventory,
      plugin_data: {
        parsed_lldp: {
          eno1: {
            switch_system_name: 'sw01.north1.example.invalid',
            switch_port_id: 'Ethernet1/35',
            switch_chassis_id: '02:00:5e:00:53:ff',
          },
        },
      },
    });
    expect(map.get('02:00:5e:00:53:01')).toEqual({
      switchName: 'sw01.north1.example.invalid',
      switchPort: 'Ethernet1/35',
      chassisId: '02:00:5e:00:53:ff',
    });
    expect(map.has('02:00:5e:00:53:02')).toBe(false);
  });

  it('treats the "Not Available" placeholder as no neighbour', () => {
    const map = lldpByMac({
      inventory,
      plugin_data: {
        parsed_lldp: {
          eno1: { switch_chassis_id: 'Not Available', switch_port_id: 'Not Available' },
          eno2: { switch_chassis_id: '02:00:5e:00:53:ff', switch_port_id: 'Ethernet1/35' },
        },
      },
    });
    expect([...map.keys()]).toEqual(['02:00:5e:00:53:02']);
    expect(map.get('02:00:5e:00:53:02')).toEqual({
      switchName: null,
      switchPort: 'Ethernet1/35',
      chassisId: '02:00:5e:00:53:ff',
    });
  });

  it('is empty when inspection recorded no LLDP', () => {
    expect(lldpByMac(null).size).toBe(0);
    expect(lldpByMac({ inventory, plugin_data: {} }).size).toBe(0);
    expect(lldpByMac({ inventory, plugin_data: { parsed_lldp: 'nope' } }).size).toBe(0);
  });
});

describe('lldpMismatch', () => {
  const configured = {
    switchName: 'sw01.north1.example.invalid',
    switchId: '02:00:5e:00:53:ff',
    switchPort: 'Ethernet1/35',
  };
  const seen = {
    switchName: 'SW01.north1.example.invalid',
    switchPort: 'Ethernet1/35',
    chassisId: '02:00:5E:00:53:FF',
  };

  it('is false when the switch reports what Ironic has, ignoring case', () => {
    expect(lldpMismatch(configured, seen)).toBe(false);
  });

  it('flags a different port or a different switch', () => {
    expect(lldpMismatch(configured, { ...seen, switchPort: 'Ethernet1/51' })).toBe(true);
    expect(lldpMismatch(configured, { ...seen, switchName: 'sw02.north1.example.invalid' })).toBe(true);
    expect(lldpMismatch(configured, { ...seen, chassisId: '02:00:5e:00:53:aa' })).toBe(true);
  });

  it('never flags missing data', () => {
    expect(lldpMismatch(configured, null)).toBe(false);
    expect(lldpMismatch(configured, { switchName: null, switchPort: null, chassisId: null })).toBe(false);
    expect(lldpMismatch({ switchName: null, switchId: null, switchPort: null }, seen)).toBe(false);
  });
});
