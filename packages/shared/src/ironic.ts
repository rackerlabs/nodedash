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

import { z } from 'zod';

/**
 * Schemas for the Ironic surface this UI touches.
 *
 * Every object schema is loose: Ironic returns a lot more than we display and
 * grows fields between microversions, so unknown keys must survive rather than
 * fail the parse. What we *do* name here is validated, so a shape change shows
 * up as a clear error instead of `undefined` leaking into the table.
 */

const jsonRecord = z.record(z.string(), z.unknown());

/** Ironic renders some driver-supplied booleans as the strings "True"/"False". */
const looseBoolean = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return /^(true|yes|1)$/i.test(value.trim());
    return null;
  });

export const NodeSchema = z.looseObject({
  uuid: z.string(),
  name: z.string().nullish(),
  power_state: z.string().nullish(),
  target_power_state: z.string().nullish(),
  provision_state: z.string().nullish(),
  target_provision_state: z.string().nullish(),
  maintenance: z.boolean().nullish(),
  maintenance_reason: z.string().nullish(),
  instance_uuid: z.string().nullish(),
  /** Present on recent servers; older ones carry it in instance_info instead. */
  instance_name: z.string().nullish(),
  instance_info: jsonRecord.nullish(),
  last_error: z.string().nullish(),
  driver: z.string().nullish(),
  resource_class: z.string().nullish(),
  conductor_group: z.string().nullish(),
  traits: z.array(z.string()).nullish(),
  console_enabled: z.boolean().nullish(),
  owner: z.string().nullish(),
  lessee: z.string().nullish(),
  /** Set on a child node (1.83+): the uuid of the node it hangs off. */
  parent_node: z.string().nullish(),
  description: z.string().nullish(),
  properties: jsonRecord.nullish(),
  /** Credentials are redacted by the BFF; absent fields are normal, so read it defensively. */
  driver_info: jsonRecord.nullish(),
  /** Free-form metadata operators and tooling attach to the node. */
  extra: jsonRecord.nullish(),
  /** When the last inspection began and ended; the stored inventory is from that run. */
  inspection_started_at: z.string().nullish(),
  inspection_finished_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type IronicNode = z.infer<typeof NodeSchema>;

export const NodeListSchema = z.looseObject({
  nodes: z.array(NodeSchema),
  next: z.string().nullish(),
});

export const BiosSettingSchema = z.looseObject({
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  attribute_type: z.string().nullish(),
  allowable_values: z.array(z.union([z.string(), z.number()])).nullish(),
  lower_bound: z.number().nullish(),
  upper_bound: z.number().nullish(),
  min_length: z.number().nullish(),
  max_length: z.number().nullish(),
  read_only: looseBoolean,
  reset_required: looseBoolean,
  unique: looseBoolean,
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type BiosSetting = z.infer<typeof BiosSettingSchema>;

export const BiosSettingsListSchema = z.looseObject({
  bios: z.array(BiosSettingSchema),
});

export const FirmwareComponentSchema = z.looseObject({
  component: z.string(),
  initial_version: z.string().nullish(),
  current_version: z.string().nullish(),
  last_version_flashed: z.string().nullish(),
  /** Added in 1.114. */
  vendor: z.string().nullish(),
  model: z.string().nullish(),
  serial_number: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type FirmwareComponent = z.infer<typeof FirmwareComponentSchema>;

export const FirmwareListSchema = z.looseObject({
  firmware: z.array(FirmwareComponentSchema),
});

/**
 * A baremetal port. `local_link_connection` is what the node's NIC is cabled to;
 * `physical_network` (1.34), `category` and `vendor` appear only on newer
 * microversions, so every one of them is optional.
 */
export const IronicPortSchema = z.looseObject({
  uuid: z.string(),
  address: z.string(),
  name: z.string().nullish(),
  node_uuid: z.string().nullish(),
  portgroup_uuid: z.string().nullish(),
  pxe_enabled: z.boolean().nullish(),
  is_smartnic: z.boolean().nullish(),
  physical_network: z.string().nullish(),
  category: z.string().nullish(),
  vendor: z.string().nullish(),
  local_link_connection: z
    .looseObject({
      switch_id: z.string().nullish(),
      port_id: z.string().nullish(),
      switch_info: z.string().nullish(),
    })
    .nullish(),
  internal_info: jsonRecord.nullish(),
  extra: jsonRecord.nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type IronicPort = z.infer<typeof IronicPortSchema>;

export const PortListSchema = z.looseObject({
  ports: z.array(IronicPortSchema),
});

export const InventoryDiskSchema = z.looseObject({
  name: z.string().nullish(),
  model: z.string().nullish(),
  size: z.number().nullish(),
  serial: z.string().nullish(),
  wwn: z.string().nullish(),
  vendor: z.string().nullish(),
  rotational: z.boolean().nullish(),
  by_path: z.string().nullish(),
});

export const InventoryInterfaceSchema = z.looseObject({
  name: z.string().nullish(),
  mac_address: z.string().nullish(),
  ipv4_address: z.string().nullish(),
  ipv6_address: z.string().nullish(),
  has_carrier: z.boolean().nullish(),
  speed_mbps: z.number().nullish(),
  pxe_enabled: z.boolean().nullish(),
  vendor: z.string().nullish(),
  product: z.string().nullish(),
});

/**
 * Ids are hex strings, with or without a `0x` prefix depending on the ramdisk. `class`
 * is a name: `NetworkController` from current ramdisks, `DeviceClass.NETWORK_CONTROLLER`
 * from older ones. Current ramdisks also report the product id as `device_id`.
 */
export const PciDeviceSchema = z.looseObject({
  class: z.string().nullish(),
  vendor_id: z.string().nullish(),
  product_id: z.string().nullish(),
  device_id: z.string().nullish(),
  subsystem_vendor_id: z.string().nullish(),
  subsystem_id: z.string().nullish(),
  revision: z.string().nullish(),
});
export type PciDevice = z.infer<typeof PciDeviceSchema>;

export const InventorySchema = z.looseObject({
  hostname: z.string().nullish(),
  memory: z
    .looseObject({
      total: z.number().nullish(),
      physical_mb: z.number().nullish(),
    })
    .nullish(),
  cpu: z
    .looseObject({
      /** Logical CPUs, i.e. hardware threads across every socket. */
      count: z.number().nullish(),
      /** Topology, reported by newer ramdisks only. */
      socket_count: z.number().nullish(),
      core_count: z.number().nullish(),
      thread_count: z.number().nullish(),
      model_name: z.string().nullish(),
      architecture: z.string().nullish(),
      frequency: z.union([z.string(), z.number()]).nullish(),
      flags: z.array(z.string()).nullish(),
    })
    .nullish(),
  disks: z.array(InventoryDiskSchema).nullish(),
  interfaces: z.array(InventoryInterfaceSchema).nullish(),
  pci_devices: z.array(PciDeviceSchema).nullish(),
  system_vendor: z
    .looseObject({
      product_name: z.string().nullish(),
      serial_number: z.string().nullish(),
      manufacturer: z.string().nullish(),
      firmware: z
        .looseObject({
          vendor: z.string().nullish(),
          version: z.string().nullish(),
          build_date: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  boot: z
    .looseObject({
      current_boot_mode: z.string().nullish(),
      pxe_interface: z.string().nullish(),
    })
    .nullish(),
});
export type Inventory = z.infer<typeof InventorySchema>;

/** GET /v1/nodes/{node}/inventory wraps the payload and adds plugin data. */
export const NodeInventorySchema = z.looseObject({
  inventory: InventorySchema,
  plugin_data: jsonRecord.nullish(),
});
export type NodeInventory = z.infer<typeof NodeInventorySchema>;

export const RunbookStepSchema = z.looseObject({
  interface: z.string(),
  step: z.string(),
  args: jsonRecord.nullish(),
  order: z.number().nullish(),
});
export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookSchema = z.looseObject({
  uuid: z.string(),
  name: z.string(),
  /** 1.112: runbooks carry their own traits and a human description. */
  description: z.string().nullish(),
  traits: z.array(z.string()).nullish(),
  steps: z.array(RunbookStepSchema),
  disable_ramdisk: z.boolean().nullish(),
  public: z.boolean().nullish(),
  owner: z.string().nullish(),
  extra: jsonRecord.nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type Runbook = z.infer<typeof RunbookSchema>;

export const RunbookListSchema = z.looseObject({
  runbooks: z.array(RunbookSchema),
});

export const ConsoleInfoSchema = z.looseObject({
  type: z.string().nullish(),
  url: z.string().nullish(),
});

export const NodeConsoleSchema = z.looseObject({
  console_enabled: z.boolean().nullish(),
  console_info: ConsoleInfoSchema.nullish(),
});
export type NodeConsole = z.infer<typeof NodeConsoleSchema>;

export const IronicErrorSchema = z.looseObject({
  error_message: z.union([z.string(), jsonRecord]).nullish(),
});
