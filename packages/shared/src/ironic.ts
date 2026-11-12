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
  description: z.string().nullish(),
  properties: jsonRecord.nullish(),
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
      count: z.number().nullish(),
      model_name: z.string().nullish(),
      architecture: z.string().nullish(),
      frequency: z.union([z.string(), z.number()]).nullish(),
      flags: z.array(z.string()).nullish(),
    })
    .nullish(),
  disks: z.array(InventoryDiskSchema).nullish(),
  interfaces: z.array(InventoryInterfaceSchema).nullish(),
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
