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

import {
  SUPPORT_ASSIST_METHODS,
  type BiosSetting,
  type Domain,
  type FirmwareComponent,
  type IronicNode,
  type NodeInventory,
  type Project,
  type Runbook,
  type SupportAssistCollection,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import { buildDiagnostics, type Diagnostics } from './diagnostics.ts';
import { createRng, type Rng } from './rng.ts';

export interface FixtureOptions {
  seed: number;
  projectCount: number;
  nodeCount: number;
}

export interface Fixtures {
  domains: Domain[];
  projects: Project[];
  nodes: IronicNode[];
  runbooks: Runbook[];
  /** node uuid -> inventory, only for nodes that have been inspected. */
  inventory: Map<string, NodeInventory>;
  bios: Map<string, BiosSetting[]>;
  firmware: Map<string, FirmwareComponent[]>;
  /**
   * node uuid -> past SupportAssist collections, newest first. Only populated for
   * nodes whose driver offers the passthru, and seeded with a finished and a failed
   * collection so both outcomes are visible without waiting for one to run.
   */
  supportAssist: Map<string, SupportAssistCollection[]>;
  /**
   * Node history, ramdisk logs, BMC health and Redfish event logs. Built lazily:
   * generating them for 5,000 nodes up front costs seconds and a lot of memory for
   * data a reviewer will look at on a handful of nodes.
   */
  diagnostics: (uuid: string) => Diagnostics | null;
}

/**
 * Vendor passthru is driver-specific, so this is what decides whether a node can
 * do SupportAssist at all. Only Dell's `idrac` hardware type carries the Dell OEM
 * calls; the same box on the generic `redfish` driver cannot.
 */
export function vendorPassthruMethodsFor(driver: string | null | undefined): VendorPassthruMethods {
  if (driver !== 'idrac') return {};
  return {
    list_unfinished_jobs: {
      http_methods: ['GET'],
      async: false,
      description: 'List unfinished iDRAC lifecycle controller jobs.',
      require_exclusive_lock: false,
    },
    [SUPPORT_ASSIST_METHODS.collect]: {
      http_methods: ['POST'],
      async: true,
      description: 'Start a Dell SupportAssist collection and upload it to object storage.',
      require_exclusive_lock: true,
    },
    [SUPPORT_ASSIST_METHODS.list]: {
      http_methods: ['GET'],
      async: false,
      description: 'List SupportAssist collections held for this node.',
      require_exclusive_lock: false,
    },
    [SUPPORT_ASSIST_METHODS.downloadUrl]: {
      http_methods: ['GET'],
      async: false,
      description: 'Mint a short-lived download URL for one SupportAssist collection.',
      require_exclusive_lock: false,
    },
  };
}

export function supportAssistFilename(node: Pick<IronicNode, 'name' | 'uuid'>, at: string): string {
  const stamp = at.slice(0, 19).replace(/[:-]/g, '').replace('T', '-');
  return `supportassist-${node.name ?? node.uuid}-${stamp}.tar.gz`;
}

/**
 * Three real domains. `infra` holds the projects that own the hardware; `sddc` and
 * `rxdb` hold the tenant projects that lease it.
 */
const DOMAINS: Array<{ name: string; description: string }> = [
  { name: 'sddc', description: 'Software-defined datacentre tenants' },
  { name: 'rxdb', description: 'Managed database tenants' },
  { name: 'infra', description: 'Infrastructure projects that own the bare metal' },
];

/** Projects under `infra`, which are the owners of every node. */
const OWNER_PROJECTS: Array<{ name: string; description: string }> = [
  { name: 'baremetal', description: 'Dell bare metal fleet' },
  { name: 'netdev', description: 'Network hardware and non-Dell appliances' },
];

const PROJECT_PREFIXES = [
  'platform',
  'compute',
  'storage-hci',
  'network-edge',
  'ceph',
  'k8s-workers',
  'gpu-pool',
  'ironic-lab',
  'overcloud',
];

const PROJECT_SUFFIXES = [
  'prod',
  'staging',
  'dev',
  'north1',
  'east2',
  'west3',
  'south4',
  'lab5',
  'edge6',
  'blue',
  'green',
  'canary',
  'migration',
  'rebuild',
];

const SITES = ['north1', 'east2', 'west3', 'south4', 'lab5', 'edge6'];

const PROVISION_STATES: Array<[string, number]> = [
  ['active', 62],
  ['available', 14],
  ['manageable', 6],
  ['clean wait', 4],
  ['deploying', 3],
  ['wait call-back', 1],
  ['inspect wait', 2],
  ['error', 3],
  ['deploy failed', 3],
  ['clean failed', 1],
  ['enroll', 1],
];

const HARDWARE_TRAITS = [
  'CUSTOM_DELL_R650',
  'CUSTOM_DELL_R750',
  'CUSTOM_HPE_DL380_GEN10',
  'CUSTOM_SUPERMICRO_SYS_620',
] as const;

type HardwareTrait = (typeof HARDWARE_TRAITS)[number];

/**
 * Weighted so roughly three quarters of the fleet is Dell, which is what the
 * estate actually looks like and what makes `baremetal` the main fleet while
 * `netdev` stays a smaller set of non-Dell kit.
 */
const HARDWARE_WEIGHTS: Array<[HardwareTrait, number]> = [
  ['CUSTOM_DELL_R650', 40],
  ['CUSTOM_DELL_R750', 35],
  ['CUSTOM_HPE_DL380_GEN10', 15],
  ['CUSTOM_SUPERMICRO_SYS_620', 10],
];

function pickHardwareTrait(rng: Rng): HardwareTrait {
  const total = HARDWARE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.int(total);
  for (const [trait, weight] of HARDWARE_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return trait;
  }
  return HARDWARE_WEIGHTS[0]![0];
}

function isDell(trait: HardwareTrait): boolean {
  return trait === 'CUSTOM_DELL_R650' || trait === 'CUSTOM_DELL_R750';
}

/**
 * Keeps traits, inventory, firmware and driver all describing the same physical
 * machine. The driver matters beyond cosmetics: vendor passthru methods come from
 * the hardware type, so only the `idrac` nodes can offer SupportAssist -- a Dell
 * box managed by the generic `redfish` driver cannot, and that is a case worth
 * being able to see in the UI.
 */
const HARDWARE_MODELS: Record<
  HardwareTrait,
  { manufacturer: string; product: string; drivers: string[] }
> = {
  CUSTOM_DELL_R650: {
    manufacturer: 'Dell Inc.',
    product: 'PowerEdge R650',
    drivers: ['idrac', 'idrac', 'idrac', 'redfish'],
  },
  CUSTOM_DELL_R750: {
    manufacturer: 'Dell Inc.',
    product: 'PowerEdge R750',
    drivers: ['idrac', 'idrac', 'idrac', 'redfish'],
  },
  CUSTOM_HPE_DL380_GEN10: {
    manufacturer: 'HPE',
    product: 'ProLiant DL380 Gen10',
    drivers: ['ilo5', 'redfish'],
  },
  CUSTOM_SUPERMICRO_SYS_620: {
    manufacturer: 'Supermicro',
    product: 'SYS-620U-TNR',
    drivers: ['ipmi', 'redfish'],
  },
};

const CAPABILITY_TRAITS = ['CUSTOM_NVME', 'CUSTOM_GPU_A100', 'CUSTOM_25G_NIC', 'CUSTOM_TPM'];

/**
 * Nodes are named after the chassis serial the vendor stamps on them -- for Dell
 * that is the seven-character service tag, which is what anyone raising a support
 * case will be quoting. Ambiguous characters are left out the way Dell leaves them
 * out, so a tag read off a pull-out tag cannot be mistyped as a different node.
 */
const SERIAL_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const NAME_PREFIXES: Record<string, string> = {
  'Dell Inc.': 'Dell',
  HPE: 'HPE',
  Supermicro: 'SMC',
};

function serviceTag(rng: Rng, length: number): string {
  let tag = '';
  for (let index = 0; index < length; index += 1) {
    tag += SERIAL_ALPHABET[rng.int(SERIAL_ALPHABET.length)];
  }
  return tag;
}

function nodeName(rng: Rng, manufacturer: string): string {
  const prefix = NAME_PREFIXES[manufacturer] ?? 'NODE';
  // Dell service tags are seven characters; other vendors run longer serials.
  return `${prefix}-${serviceTag(rng, prefix === 'Dell' ? 7 : 10)}`;
}

const CPU_MODELS = [
  'Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz',
  'Intel(R) Xeon(R) Silver 4314 CPU @ 2.40GHz',
  'AMD EPYC 7443P 24-Core Processor',
];

const LAST_ERRORS = [
  'Timeout reached while waiting for callback for node',
  'Failed to prepare to deploy: Validation of image href failed',
  'Node failed to power on within 300 seconds',
  'Agent returned error: Command execution failed: clean_disk_metadata',
];

function weightedState(rng: Rng): string {
  const total = PROVISION_STATES.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.int(total);
  for (const [state, weight] of PROVISION_STATES) {
    roll -= weight;
    if (roll < 0) return state;
  }
  return 'active';
}

/**
 * Diagnostics are anchored to real time rather than the fixed fixture date, so
 * "3 minutes ago" on the health page reads as recent whenever the app is opened.
 */
const DIAGNOSTIC_ANCHOR_MS = Date.now();

/** Stable per-node seed offset, so each node's diagnostics differ but never shift. */
function hashUuid(uuid: string): number {
  let hash = 0;
  for (let index = 0; index < uuid.length; index += 1) {
    hash = (hash * 31 + uuid.charCodeAt(index)) % 1_000_003;
  }
  return hash;
}

function isoDaysAgo(rng: Rng, maxDays: number): string {
  // Anchored to a fixed date so fixtures never shift between runs.
  const anchor = Date.UTC(2026, 7, 19, 12, 0, 0);
  const offset = rng.int(maxDays * 24 * 60) * 60_000;
  return new Date(anchor - offset).toISOString();
}

/**
 * How often a node is leased out to a tenant project. Deployed nodes are much more
 * likely to be leased than idle ones, because a lease is what a tenant workload
 * sitting on the box looks like in Ironic.
 */
const LEASE_ODDS = { active: 0.75, idle: 0.15 };

/**
 * Picks which tenant project leases a node, with a cubic bias toward the head of
 * the list. That mimics a few large tenants and a long tail of small ones, and
 * leaves some tenant projects with nothing leased at all.
 */
function pickLessee(rng: Rng, tenants: Project[]): Project | null {
  if (tenants.length === 0) return null;
  const skewed = rng.next() ** 3;
  return tenants[Math.min(tenants.length - 1, Math.floor(skewed * tenants.length))] ?? null;
}

export function buildFixtures(options: FixtureOptions): Fixtures {
  const rng = createRng(options.seed);

  const domains: Domain[] = DOMAINS.map((domain) => ({
    id: rng.hex(32),
    name: domain.name,
    description: domain.description,
    enabled: true,
  }));
  const domainByName = new Map(domains.map((domain) => [domain.name, domain]));
  const infra = domainByName.get('infra')!;
  const tenantDomains = domains.filter((domain) => domain.name !== 'infra');

  // The two infra projects own every node.
  const owners: Project[] = OWNER_PROJECTS.map((project) => ({
    id: rng.hex(32),
    name: project.name,
    domain_id: infra.id,
    description: project.description,
    enabled: true,
  }));

  // Everything under sddc and rxdb is a tenant: it owns no hardware and sees only
  // what has been leased to it.
  const tenants: Project[] = [];
  const seenNames = new Set(owners.map((project) => project.name));
  while (owners.length + tenants.length < options.projectCount) {
    const domain = tenantDomains[rng.int(tenantDomains.length)]!;
    const prefix = rng.pick(PROJECT_PREFIXES);
    const suffix = rng.pick(PROJECT_SUFFIXES);
    const name = `${prefix}-${suffix}`;
    const unique = seenNames.has(name) ? `${name}-${tenants.length}` : name;
    seenNames.add(unique);
    tenants.push({
      id: rng.hex(32),
      name: unique,
      domain_id: domain.id,
      description: `${prefix} capacity leased in ${suffix}`,
      enabled: true,
    });
  }

  const baremetal = owners.find((project) => project.name === 'baremetal')!;
  const netdev = owners.find((project) => project.name === 'netdev')!;

  const projects: Project[] = [...owners, ...tenants];

  // Sorted so the project a reviewer clicks first is deterministic.
  projects.sort((a, b) => a.name.localeCompare(b.name));

  const runbooks = buildRunbooks(rng);

  const nodes: IronicNode[] = [];
  const inventory = new Map<string, NodeInventory>();
  const bios = new Map<string, BiosSetting[]>();
  const firmware = new Map<string, FirmwareComponent[]>();
  const supportAssist = new Map<string, SupportAssistCollection[]>();
  const diagnosticsCache = new Map<string, Diagnostics>();

  for (let index = 0; index < options.nodeCount; index += 1) {
    const site = rng.pick(SITES);
    const rack = 1 + rng.int(24);
    const unit = 1 + rng.int(42);
    const provisionState = weightedState(rng);
    const isActive = provisionState === 'active';
    const maintenance = rng.bool(isActive ? 0.05 : 0.16);
    const uuid = rng.uuid();
    const hardwareTrait = pickHardwareTrait(rng);

    // Ownership follows the hardware: Dell in baremetal, everything else in
    // netdev. Tenant projects never own a node, they lease one.
    const owner = isDell(hardwareTrait) ? baremetal : netdev;
    const leased = rng.bool(isActive ? LEASE_ODDS.active : LEASE_ODDS.idle);
    const lessee = leased ? pickLessee(rng, tenants) : null;
    const hardware = HARDWARE_MODELS[hardwareTrait];
    // The model trait is what the per-model firmware runbooks match on, so every
    // node already has something offered to it. A capability trait on top is what
    // the NVMe, GPU, NIC and TPM runbooks match on.
    //
    // Deliberately never borrows a trait from an arbitrary runbook: that used to
    // hand an HPE box a CUSTOM_DELL_R650 trait and offer it Dell BIOS runbooks.
    const traits: string[] = [hardwareTrait];
    if (rng.bool(isActive ? 0.7 : 0.4)) traits.push(rng.pick(CAPABILITY_TRAITS));

    const instanceUuid = isActive ? rng.uuid() : null;
    const instanceName = isActive
      ? `${rng.pick(['web', 'db', 'cache', 'worker', 'ctrl'])}-${site}-${String(index).padStart(4, '0')}`
      : null;
    const failed = provisionState.includes('failed') || provisionState === 'error';

    nodes.push({
      uuid,
      name: nodeName(rng, hardware.manufacturer),
      power_state: provisionState === 'enroll' ? null : isActive || rng.bool(0.3) ? 'power on' : 'power off',
      target_power_state: null,
      provision_state: provisionState,
      target_provision_state: provisionState.endsWith('wait') ? 'active' : null,
      maintenance,
      maintenance_reason: maintenance
        ? rng.pick([
            'Awaiting DIMM replacement, RMA 8842119',
            'Failed disk in slot 3, parts dispatched',
            'Held for firmware baseline update',
            'Suspected PSU fault, scheduled for onsite',
            null,
          ])
        : null,
      instance_uuid: instanceUuid,
      // Recent Ironic reports instance_name natively; some nodes below
      // deliberately omit it to exercise the instance_info fallback.
      instance_name: isActive && rng.bool(0.85) ? instanceName : null,
      instance_info: isActive
        ? { display_name: instanceName, image_source: `glance://${rng.hex(8)}`, root_gb: 40 }
        : {},
      last_error: failed ? rng.pick(LAST_ERRORS) : null,
      driver: rng.pick(hardware.drivers),
      resource_class: rng.pick(['baremetal-large', 'baremetal-xlarge', 'baremetal-gpu']),
      conductor_group: site,
      traits,
      console_enabled: false,
      owner: owner.id,
      lessee: lessee?.id ?? null,
      // Rack position used to be encoded in the node name; it lives here now that
      // the name carries the service tag instead.
      description: `${hardware.product} — ${site} rack ${rack}, U${String(unit).padStart(2, '0')}`,
      properties: {
        cpus: rng.pick([32, 48, 64]),
        memory_mb: rng.pick([131072, 262144, 524288]),
        local_gb: rng.pick([446, 893, 1788]),
        cpu_arch: 'x86_64',
      },
      created_at: isoDaysAgo(rng, 720),
      updated_at: isoDaysAgo(rng, 14),
    });

    // Not every node has been inspected, so inventory is legitimately missing
    // for some of them and the UI has to say so.
    if (rng.bool(0.85)) inventory.set(uuid, buildInventory(rng, uuid, hardware));
    if (rng.bool(0.9)) bios.set(uuid, buildBiosSettings(rng));
    if (rng.bool(0.8)) firmware.set(uuid, buildFirmware(rng, hardware));

    const node = nodes[nodes.length - 1]!;
    if (node.driver === 'idrac' && rng.bool(0.6)) {
      supportAssist.set(uuid, buildSupportAssistHistory(rng, node));
    }
  }

  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));

  return {
    domains,
    projects,
    nodes,
    runbooks,
    inventory,
    bios,
    firmware,
    supportAssist,
    diagnostics(uuid: string) {
      const node = nodesByUuid.get(uuid);
      if (!node) return null;
      const cached = diagnosticsCache.get(uuid);
      if (cached) return cached;
      // Seeded per node so a reload shows the same history, not a fresh shuffle.
      const built = buildDiagnostics(createRng(options.seed + hashUuid(uuid)), node, DIAGNOSTIC_ANCHOR_MS);
      diagnosticsCache.set(uuid, built);
      return built;
    },
  };
}

/**
 * Runbook names are free-form from microversion 1.112 onward: a runbook carries its
 * own `traits` field, so the name no longer has to double as a trait the node
 * carries and can read like something an operator recognises. Node traits are still
 * `CUSTOM_`-prefixed, because Ironic requires that of traits.
 *
 * Firmware runbooks are per approved version, so a fleet accumulates a lot of them --
 * one per model per component per version we allow. That is modelled here rather
 * than hand-written, because a long matching list is the case the UI has to survive.
 */
const BASELINE_RUNBOOKS: Array<{
  name: string;
  description: string;
  traits: string[];
  steps: Runbook['steps'];
}> = [
  {
    name: 'bios-baseline-dell-poweredge',
    description: 'Apply the standard BIOS baseline (boot mode, SR-IOV, power profile) and reboot.',
    traits: ['CUSTOM_DELL_R650', 'CUSTOM_DELL_R750'],
    steps: [
      {
        interface: 'bios',
        step: 'apply_configuration',
        args: { settings: [{ name: 'BootMode', value: 'Uefi' }] },
      },
      { interface: 'management', step: 'restart', args: {} },
    ],
  },
  {
    name: 'nvme-secure-erase',
    description: 'Secure-erase all NVMe namespaces. Destroys data on the node.',
    traits: ['CUSTOM_NVME'],
    steps: [{ interface: 'deploy', step: 'erase_devices_metadata', args: {} }],
  },
  {
    name: 'gpu-healthcheck-a100',
    description: 'Run the GPU burn-in and ECC health report without touching host data.',
    traits: ['CUSTOM_GPU_A100'],
    steps: [{ interface: 'deploy', step: 'gpu_healthcheck', args: { duration_minutes: 15 } }],
  },
  {
    name: 'tpm-attestation-refresh',
    description: 'Re-provision TPM ownership and refresh the attestation baseline.',
    traits: ['CUSTOM_TPM'],
    steps: [{ interface: 'management', step: 'refresh_attestation', args: {} }],
  },
];

/** One runbook per approved firmware version, which is where the volume comes from. */
const FIRMWARE_RUNBOOK_FAMILIES: Array<{
  trait: string;
  model: string;
  component: string;
  label: string;
  versions: string[];
}> = [
  {
    trait: 'CUSTOM_DELL_R650',
    model: 'dell-r650',
    component: 'bios',
    label: 'BIOS',
    versions: ['1.15.2', '1.14.0', '1.12.1'],
  },
  {
    trait: 'CUSTOM_DELL_R650',
    model: 'dell-r650',
    component: 'idrac',
    label: 'iDRAC',
    versions: ['7.10.30.00', '7.00.00.181', '6.10.80.00'],
  },
  {
    trait: 'CUSTOM_DELL_R750',
    model: 'dell-r750',
    component: 'bios',
    label: 'BIOS',
    versions: ['1.13.2', '1.11.2'],
  },
  {
    trait: 'CUSTOM_DELL_R750',
    model: 'dell-r750',
    component: 'idrac',
    label: 'iDRAC',
    versions: ['7.10.30.00', '6.10.80.00'],
  },
  {
    trait: 'CUSTOM_HPE_DL380_GEN10',
    model: 'hpe-dl380-gen10',
    component: 'ilo',
    label: 'iLO 5',
    versions: ['3.09', '2.98'],
  },
  {
    trait: 'CUSTOM_HPE_DL380_GEN10',
    model: 'hpe-dl380-gen10',
    component: 'bios',
    label: 'System ROM U30',
    versions: ['2.90', '2.78'],
  },
  {
    trait: 'CUSTOM_SUPERMICRO_SYS_620',
    model: 'supermicro-sys-620',
    component: 'bmc',
    label: 'BMC',
    versions: ['1.73.06', '1.71.02'],
  },
  {
    trait: 'CUSTOM_25G_NIC',
    model: 'mellanox-cx6',
    component: 'nic',
    label: 'ConnectX-6 firmware',
    versions: ['22.36.1010', '22.35.2000'],
  },
];

function buildRunbooks(rng: Rng): Runbook[] {
  const definitions = [...BASELINE_RUNBOOKS];

  for (const family of FIRMWARE_RUNBOOK_FAMILIES) {
    for (const [index, version] of family.versions.entries()) {
      definitions.push({
        name: `firmware-${family.model}-${family.component}-${version}`,
        description: `Flash ${family.label} ${version} and verify the reported version.${
          index === 0 ? ' Current approved baseline.' : ' Superseded; kept for rollback.'
        }`,
        traits: [family.trait],
        steps: [
          {
            interface: 'firmware',
            step: 'update',
            args: {
              settings: [
                {
                  component: family.component,
                  url: `https://fw.example.invalid/${family.model}/${family.component}-${version}.bin`,
                },
              ],
            },
          },
          { interface: 'management', step: 'restart', args: {} },
        ],
      });
    }
  }

  return definitions.map((definition) => ({
    uuid: rng.uuid(),
    name: definition.name,
    description: definition.description,
    traits: definition.traits,
    steps: definition.steps,
    disable_ramdisk: false,
    public: true,
    owner: null,
    extra: {},
    created_at: isoDaysAgo(rng, 400),
    updated_at: isoDaysAgo(rng, 30),
  }));
}

function buildInventory(
  rng: Rng,
  uuid: string,
  hardware: { manufacturer: string; product: string },
): NodeInventory {
  const diskCount = 2 + rng.int(6);
  const nicCount = 2 + rng.int(3);
  const vendor = hardware.manufacturer;
  return {
    inventory: {
      hostname: `bmc-${uuid.slice(0, 8)}`,
      memory: { total: rng.pick([137438953472, 274877906944]), physical_mb: rng.pick([131072, 262144]) },
      cpu: {
        count: rng.pick([32, 48, 64]),
        model_name: rng.pick(CPU_MODELS),
        architecture: 'x86_64',
        frequency: rng.pick(['2000.000', '2400.000', '2850.000']),
        flags: ['fpu', 'vmx', 'avx', 'avx2', 'avx512f', 'aes', 'sha_ni'],
      },
      disks: Array.from({ length: diskCount }, (_, index) => ({
        name: `/dev/nvme${index}n1`,
        model: rng.pick(['SAMSUNG MZQL21T9', 'INTEL SSDPF2KX038', 'KIOXIA KCD6XLUL1T92']),
        size: rng.pick([1920383410176, 3840755982336]),
        serial: rng.hex(16).toUpperCase(),
        wwn: `eui.${rng.hex(16)}`,
        vendor,
        rotational: false,
        by_path: `/dev/disk/by-path/pci-0000:${rng.hex(2)}:00.0-nvme-1`,
      })),
      interfaces: Array.from({ length: nicCount }, (_, index) => ({
        name: `eno${index + 1}`,
        mac_address: Array.from({ length: 6 }, () => rng.hex(2)).join(':'),
        ipv4_address: index === 0 ? `10.${rng.int(200)}.${rng.int(255)}.${rng.int(255)}` : null,
        has_carrier: index < 2,
        speed_mbps: rng.pick([10000, 25000]),
        pxe_enabled: index === 0,
        vendor: '0x15b3',
        product: 'MT2892 Family [ConnectX-6 Dx]',
      })),
      system_vendor: {
        product_name: hardware.product,
        serial_number: rng.hex(7).toUpperCase(),
        manufacturer: vendor,
        firmware: { vendor, version: `2.${rng.int(15)}.${rng.int(9)}`, build_date: '2026-03-11' },
      },
      boot: { current_boot_mode: 'uefi', pxe_interface: 'eno1' },
    },
    plugin_data: {
      inspection_collectors: 'default,logs,pci-devices',
      inspection_finished_at: isoDaysAgo(rng, 90),
    },
  };
}

function buildBiosSettings(rng: Rng): BiosSetting[] {
  const definitions: Array<[string, string | number, string, boolean]> = [
    ['BootMode', 'Uefi', 'Enumeration', false],
    ['SecureBoot', rng.pick(['Enabled', 'Disabled']), 'Enumeration', false],
    ['SriovGlobalEnable', rng.pick(['Enabled', 'Disabled']), 'Enumeration', false],
    ['LogicalProc', rng.pick(['Enabled', 'Disabled']), 'Enumeration', false],
    ['SysProfile', rng.pick(['PerfOptimized', 'PerfPerWattOptimizedOs']), 'Enumeration', false],
    ['NumLock', 'On', 'Enumeration', false],
    ['ProcVirtualization', 'Enabled', 'Enumeration', false],
    ['MemTest', 'Disabled', 'Enumeration', false],
    ['SetBootOrderEn', 'NIC.PxeDevice.1-1,HardDisk.List.1-1', 'String', false],
    ['ProcCores', rng.pick([16, 24, 32]), 'Integer', false],
    ['SystemBiosVersion', `2.${rng.int(15)}.${rng.int(9)}`, 'String', true],
    ['SystemServiceTag', rng.hex(7).toUpperCase(), 'String', true],
    ['AcPwrRcvry', 'Last', 'Enumeration', false],
    ['EmbSata', 'AhciMode', 'Enumeration', false],
    ['PcieAspmL1', 'Enabled', 'Enumeration', false],
  ];
  return definitions.map(([name, value, attributeType, readOnly]) => ({
    name,
    value,
    attribute_type: attributeType,
    allowable_values:
      attributeType === 'Enumeration' ? ['Enabled', 'Disabled', 'Uefi', 'Bios', 'On', 'Off', 'Last'] : null,
    lower_bound: null,
    upper_bound: null,
    min_length: null,
    max_length: null,
    read_only: readOnly,
    reset_required: !readOnly,
    unique: false,
    created_at: isoDaysAgo(rng, 200),
    updated_at: isoDaysAgo(rng, 20),
  }));
}

function buildFirmware(rng: Rng, hardware: { manufacturer: string; product: string }): FirmwareComponent[] {
  const vendor = hardware.manufacturer;
  const components: Array<[string, string]> = [
    ['bios', `2.${rng.int(15)}.${rng.int(9)}`],
    ['bmc', `7.${rng.int(10)}.${rng.int(40)}`],
    ['nic', `22.${rng.int(36)}.1010`],
    ['raid', `52.${rng.int(26)}.0-4${rng.int(999)}`],
  ];
  return components.map(([component, version]) => ({
    component,
    initial_version: version,
    current_version: version,
    last_version_flashed: rng.bool(0.5) ? version : null,
    vendor,
    model: component === 'nic' ? 'ConnectX-6 Dx' : null,
    serial_number: component === 'bmc' ? rng.hex(12).toUpperCase() : null,
    created_at: isoDaysAgo(rng, 300),
    updated_at: isoDaysAgo(rng, 25),
  }));
}

/**
 * A plausible history for a node that has been through support cases before: a
 * finished bundle still inside its retention window, sometimes a failed attempt,
 * and sometimes one that has aged out of storage.
 */
function buildSupportAssistHistory(rng: Rng, node: IronicNode): SupportAssistCollection[] {
  const collections: SupportAssistCollection[] = [];

  const finishedAt = isoDaysAgo(rng, 9);
  const startedAt = new Date(new Date(finishedAt).getTime() - (26 + rng.int(9)) * 60_000).toISOString();
  collections.push({
    id: rng.uuid(),
    state: 'available',
    percent: 100,
    started_at: startedAt,
    finished_at: finishedAt,
    estimated_completion_at: finishedAt,
    requested_by: rng.pick(['example-user@example.com', 'dc-ops@example.com']),
    data_selectors: ['HWData', 'Debug'],
    filter_pii: true,
    filename: supportAssistFilename(node, startedAt),
    size_bytes: (28 + rng.int(140)) * 1024 * 1024,
    // Bundles can hold customer data, so storage expires them rather than keeping
    // them indefinitely.
    expires_at: new Date(new Date(finishedAt).getTime() + 14 * 86_400_000).toISOString(),
    error: null,
  });

  if (rng.bool(0.45)) {
    const failedStart = isoDaysAgo(rng, 40);
    collections.push({
      id: rng.uuid(),
      state: 'failed',
      percent: null,
      started_at: failedStart,
      finished_at: new Date(new Date(failedStart).getTime() + 31 * 60_000).toISOString(),
      estimated_completion_at: null,
      requested_by: 'dc-ops@example.com',
      data_selectors: ['HWData', 'Debug', 'OSAppData'],
      filter_pii: false,
      filename: null,
      size_bytes: null,
      expires_at: null,
      error:
        'iDRAC job JID_874219556301 failed: OS Collector could not reach the host agent (node was powered off).',
    });
  }

  if (rng.bool(0.35)) {
    const oldStart = isoDaysAgo(rng, 200);
    collections.push({
      id: rng.uuid(),
      state: 'expired',
      percent: 100,
      started_at: oldStart,
      finished_at: new Date(new Date(oldStart).getTime() + 29 * 60_000).toISOString(),
      estimated_completion_at: null,
      requested_by: 'dc-ops@example.com',
      data_selectors: ['HWData'],
      filter_pii: true,
      filename: supportAssistFilename(node, oldStart),
      size_bytes: (30 + rng.int(60)) * 1024 * 1024,
      expires_at: new Date(new Date(oldStart).getTime() + 14 * 86_400_000).toISOString(),
      error: null,
    });
  }

  return collections;
}
