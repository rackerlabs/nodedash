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

import type { PciDevice } from './ironic.ts';

/**
 * The PCI ID database (pci.ids, https://pci-ids.ucw.cz/), parsed into lookups.
 *
 * Only the vendor, device and subsystem sections are read; the device class
 * section at the end is ignored because Ironic already reports each device's class.
 */
export interface PciVendor {
  name: string;
  devices: Map<string, PciDeviceName>;
}

export interface PciDeviceName {
  name: string;
  /** Keyed by `<subvendor>:<subdevice>`. */
  subsystems: Map<string, string>;
}

export type PciIds = Map<string, PciVendor>;

/** `0x1022` (as Ironic reports ids) and `1022` both become `1022`. */
export function normalizePciId(id: string | null | undefined): string | null {
  if (!id) return null;
  const hex = id.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{1,4}$/.test(hex) ? hex.padStart(4, '0') : null;
}

const VENDOR = /^([0-9a-f]{4})\s+(.+)$/;
const DEVICE = /^\t([0-9a-f]{4})\s+(.+)$/;
const SUBSYSTEM = /^\t\t([0-9a-f]{4}) ([0-9a-f]{4})\s+(.+)$/;

export function parsePciIds(text: string): PciIds {
  const ids: PciIds = new Map();
  let vendor: PciVendor | null = null;
  let device: PciDeviceName | null = null;

  for (const line of text.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue;
    // Class definitions (`C 00  Unclassified device`) follow every vendor.
    if (line.startsWith('C ')) break;

    let match = SUBSYSTEM.exec(line);
    if (match) {
      device?.subsystems.set(`${match[1]}:${match[2]}`, match[3]!.trim());
      continue;
    }
    match = DEVICE.exec(line);
    if (match) {
      device = { name: match[2]!.trim(), subsystems: new Map() };
      vendor?.devices.set(match[1]!, device);
      continue;
    }
    match = VENDOR.exec(line);
    if (match) {
      vendor = { name: match[2]!.trim(), devices: new Map() };
      device = null;
      ids.set(match[1]!, vendor);
    }
  }
  return ids;
}

export interface PciNames {
  vendor: string | null;
  device: string | null;
  subsystem: string | null;
}

export function lookupPci(
  ids: PciIds,
  device: Pick<PciDevice, 'vendor_id' | 'product_id' | 'subsystem_vendor_id' | 'subsystem_id'>,
): PciNames {
  const vendorId = normalizePciId(device.vendor_id);
  const productId = normalizePciId(device.product_id);
  const vendor = vendorId ? ids.get(vendorId) : undefined;
  const product = productId ? vendor?.devices.get(productId) : undefined;

  const subVendorId = normalizePciId(device.subsystem_vendor_id);
  const subProductId = normalizePciId(device.subsystem_id);
  const subsystem =
    subVendorId && subProductId ? product?.subsystems.get(`${subVendorId}:${subProductId}`) : undefined;

  return { vendor: vendor?.name ?? null, device: product?.name ?? null, subsystem: subsystem ?? null };
}

/** Ironic reports the class as a Python enum name, e.g. `DeviceClass.NETWORK_CONTROLLER`. */
export function pciClassLabel(deviceClass: string | null | undefined): string | null {
  if (!deviceClass) return null;
  const name = deviceClass
    .replace(/^DeviceClass\./, '')
    .replaceAll('_', ' ')
    .toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Bridges (host, PCI-to-PCI, ISA and so on) are plumbing: a server reports dozens
 * of them and none is something an operator acts on, so the table leaves them out.
 */
export function isPciBridge(device: Pick<PciDevice, 'class'>): boolean {
  return pciClassLabel(device.class)?.toLowerCase() === 'bridge';
}
