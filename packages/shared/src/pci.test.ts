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
import { isPciBridge, lookupPci, normalizePciId, parsePciIds, pciClassLabel } from './pci.ts';

// Made-up ids in the real file's layout: vendor, one tab for a device, two for a subsystem.
const SAMPLE = [
  '# comment',
  '',
  '1234  Example Vendor, Inc.',
  '\t0001  Example NIC 25GbE',
  '\t\t1234 0010  Example NIC 25GbE OCP card',
  '\t\t5678 0020  Other Brand rebadge',
  '\t0002  Example RAID controller',
  '5678  Other Brand',
  '\t9abc  Other Brand device',
  '',
  'C 02  Network controller',
  '\t00  Ethernet controller',
  '',
].join('\n');

describe('normalizePciId', () => {
  it('strips 0x, lower-cases and pads', () => {
    expect(normalizePciId('0x15B3')).toBe('15b3');
    expect(normalizePciId('15b3')).toBe('15b3');
    expect(normalizePciId('0x1')).toBe('0001');
  });

  it('rejects anything that is not a 16-bit hex id', () => {
    expect(normalizePciId(null)).toBeNull();
    expect(normalizePciId('')).toBeNull();
    expect(normalizePciId('0x12345')).toBeNull();
    expect(normalizePciId('zzzz')).toBeNull();
  });
});

describe('parsePciIds / lookupPci', () => {
  const ids = parsePciIds(SAMPLE);

  it('names vendor, device and subsystem', () => {
    expect(
      lookupPci(ids, {
        vendor_id: '0x1234',
        product_id: '0x0001',
        subsystem_vendor_id: '0x5678',
        subsystem_id: '0x0020',
      }),
    ).toEqual({
      vendor: 'Example Vendor, Inc.',
      device: 'Example NIC 25GbE',
      subsystem: 'Other Brand rebadge',
    });
  });

  it('reads unprefixed ids and a product id reported only as device_id', () => {
    expect(
      lookupPci(ids, {
        vendor_id: '1234',
        device_id: '0001',
        subsystem_vendor_id: '1234',
        subsystem_id: '0010',
      }),
    ).toEqual({
      vendor: 'Example Vendor, Inc.',
      device: 'Example NIC 25GbE',
      subsystem: 'Example NIC 25GbE OCP card',
    });
  });

  it('falls back field by field when an id is unknown', () => {
    expect(lookupPci(ids, { vendor_id: '0x1234', product_id: '0xffff' })).toEqual({
      vendor: 'Example Vendor, Inc.',
      device: null,
      subsystem: null,
    });
    expect(lookupPci(ids, { vendor_id: '0xdead', product_id: '0x0001' })).toEqual({
      vendor: null,
      device: null,
      subsystem: null,
    });
  });

  it('reads a line padded with a long run of spaces in linear time', () => {
    const padded = `1234${' '.repeat(50_000)}Example Vendor\n9999${' '.repeat(50_000)}\n`;
    const started = Date.now();
    const parsed = parsePciIds(padded);
    expect(Date.now() - started).toBeLessThan(500);
    expect(parsed.get('1234')?.name).toBe('Example Vendor');
    expect(parsed.has('9999')).toBe(false);
  });

  it('does not read the class section as vendors', () => {
    expect(ids.size).toBe(2);
  });
});

describe('pciClassLabel / isPciBridge', () => {
  it('turns the enum name into words', () => {
    expect(pciClassLabel('DeviceClass.NETWORK_CONTROLLER')).toBe('Network controller');
    expect(pciClassLabel(null)).toBeNull();
  });

  it('reads the Redfish DeviceClass value as words too', () => {
    expect(pciClassLabel('NetworkController')).toBe('Network controller');
    expect(pciClassLabel('MassStorageController')).toBe('Mass storage controller');
    expect(pciClassLabel('Bridge')).toBe('Bridge');
  });

  it('recognises bridges and nothing else', () => {
    expect(isPciBridge({ class: 'DeviceClass.BRIDGE' })).toBe(true);
    expect(isPciBridge({ class: 'Bridge' })).toBe(true);
    expect(isPciBridge({ class: 'NetworkController' })).toBe(false);
    expect(isPciBridge({ class: 'DeviceClass.NETWORK_CONTROLLER' })).toBe(false);
    expect(isPciBridge({})).toBe(false);
  });
});
