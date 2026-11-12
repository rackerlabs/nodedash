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
  worstStatus,
  type IronicNode,
  type LogEntry,
  type LogService,
  type NodeHealth,
  type NodeHistoryEvent,
  type NodeLogArchive,
  type SensorReading,
} from '@nodedash/shared';
import type { Rng } from './rng.ts';

/**
 * Fixtures for the diagnostic surfaces: Ironic's node history, ramdisk log
 * archives, BMC health and the Redfish event logs. Kept out of fixtures.ts because
 * it is a lot of vendor-flavoured text and none of the rest of the fixture set
 * depends on it.
 */

export interface Diagnostics {
  history: NodeHistoryEvent[];
  logs: NodeLogArchive[];
  logContent: Map<string, string>;
  health: NodeHealth;
  logServices: LogService[];
  logEntries: Map<string, LogEntry[]>;
}

function isoMinutesAgo(anchor: number, minutes: number): string {
  return new Date(anchor - minutes * 60_000).toISOString();
}

const HISTORY_TEMPLATES: Array<{
  severity: string;
  event_type: string;
  event: (node: IronicNode) => string;
}> = [
  {
    severity: 'INFO',
    event_type: 'provisioning',
    event: () => 'Node deployment completed successfully',
  },
  {
    severity: 'INFO',
    event_type: 'cleaning',
    event: () => 'Automated cleaning completed, node returned to available',
  },
  {
    severity: 'INFO',
    event_type: 'introspection',
    event: () => 'Inspection completed, inventory stored',
  },
  {
    severity: 'WARNING',
    event_type: 'power',
    event: () => 'Power state mismatch detected: expected power on, BMC reported power off',
  },
  {
    severity: 'WARNING',
    event_type: 'monitoring',
    event: () => 'Node is not responding to IPMI, retrying with longer timeout',
  },
  {
    severity: 'ERROR',
    event_type: 'deploy',
    event: () => 'Deploy step write_image failed: agent reported checksum mismatch',
  },
  {
    severity: 'ERROR',
    event_type: 'cleaning',
    event: () => 'Clean step erase_devices timed out after 3600 seconds',
  },
  {
    severity: 'INFO',
    event_type: 'maintenance',
    event: () => 'Node placed in maintenance by an operator',
  },
];

function buildHistory(rng: Rng, node: IronicNode, anchor: number): NodeHistoryEvent[] {
  const events: NodeHistoryEvent[] = [];
  const count = 4 + rng.int(14);

  // Walk backwards in time by a random gap each step, so timestamps are strictly
  // decreasing. Ironic returns history newest-first and the UI relies on that.
  let minutesAgo = rng.int(30);

  for (let index = 0; index < count; index += 1) {
    const template = rng.pick(HISTORY_TEMPLATES);
    minutesAgo += 30 + rng.int(600);
    events.push({
      uuid: rng.uuid(),
      created_at: isoMinutesAgo(anchor, minutesAgo),
      severity: template.severity,
      event: template.event(node),
      event_type: template.event_type,
      conductor: `conductor-${node.conductor_group ?? 'default'}-${1 + rng.int(3)}`,
      user: rng.bool(0.3) ? 'example-user@example.com' : null,
    });
  }

  // A failed node should say why in its history, not just in last_error. This is
  // the most recent event, so it goes at the front.
  if (node.last_error) {
    events.unshift({
      uuid: rng.uuid(),
      created_at: isoMinutesAgo(anchor, rng.int(5)),
      severity: 'ERROR',
      event: node.last_error,
      event_type: 'provisioning',
      conductor: `conductor-${node.conductor_group ?? 'default'}-1`,
      user: null,
    });
  }

  return events;
}

/** Plausible ironic-python-agent output, enough to be worth searching through. */
function buildLogContent(rng: Rng, node: IronicNode, kind: string, failed: boolean): string {
  const lines: string[] = [];
  const stamp = (offset: number) =>
    new Date(Date.UTC(2026, 7, 19, 11, 0, 0) + offset * 1000).toISOString().replace('T', ' ').slice(0, 19);

  let tick = 0;
  const push = (level: string, module: string, message: string) => {
    tick += 1 + rng.int(4);
    lines.push(`${stamp(tick)} ${level} ${module} [-] ${message}`);
  };

  push('INFO', 'ironic_python_agent.agent', `Starting ironic-python-agent version 9.13.0`);
  push('INFO', 'ironic_python_agent.agent', `Inspecting hardware for node ${node.uuid}`);
  push('INFO', 'ironic_python_agent.hardware', `Found 2 CPUs, ${node.properties?.memory_mb ?? 0} MiB RAM`);
  push('INFO', 'ironic_python_agent.hardware', 'Enumerating block devices via lsblk');
  for (const device of ['nvme0n1', 'nvme1n1', 'sda']) {
    push('DEBUG', 'ironic_python_agent.hardware', `Discovered block device ${device}`);
  }
  push('INFO', 'ironic_python_agent.agent', `Lookup succeeded, node ${node.uuid} confirmed`);

  if (kind === 'deploy') {
    push('INFO', 'ironic_python_agent.extensions.standby', 'Beginning image download');
    push('INFO', 'ironic_python_agent.extensions.standby', 'Downloaded 4096 MiB in 38s (107 MiB/s)');
    if (failed) {
      push('ERROR', 'ironic_python_agent.extensions.standby', 'Image checksum mismatch');
      push(
        'ERROR',
        'ironic_python_agent.extensions.standby',
        'expected md5 9f2c1d8e4b7a4c6f8d1e2a3b4c5d6e7f, got 4b7a4c6f8d1e2a3b4c5d6e7f9f2c1d8e',
      );
      push('ERROR', 'ironic_python_agent.agent', 'Command write_image failed, aborting deploy');
    } else {
      push('INFO', 'ironic_python_agent.extensions.standby', 'Image written to /dev/nvme0n1');
      push('INFO', 'ironic_python_agent.extensions.standby', 'Installing bootloader in UEFI mode');
      push('INFO', 'ironic_python_agent.agent', 'Deploy complete, requesting power off');
    }
  } else if (kind === 'clean') {
    push('INFO', 'ironic_python_agent.extensions.clean', 'Running clean step erase_devices_metadata');
    push('INFO', 'ironic_python_agent.hardware', 'Issuing ATA secure erase on /dev/nvme0n1');
    if (failed) {
      push('ERROR', 'ironic_python_agent.hardware', 'Secure erase failed: device reported frozen state');
    } else {
      push('INFO', 'ironic_python_agent.extensions.clean', 'Clean step completed in 214s');
    }
  } else {
    push('INFO', 'ironic_python_agent.inspector', 'Collecting inventory for inspection');
    push('INFO', 'ironic_python_agent.inspector', 'Posting inventory to ironic-inspector');
  }

  return lines.join('\n');
}

function buildLogs(
  rng: Rng,
  node: IronicNode,
  anchor: number,
): { logs: NodeLogArchive[]; content: Map<string, string> } {
  const logs: NodeLogArchive[] = [];
  const content = new Map<string, string>();
  const failed = Boolean(node.last_error);

  const kinds: string[] = ['deploy'];
  if (rng.bool(0.6)) kinds.push('clean');
  if (rng.bool(0.4)) kinds.push('inspect');

  for (const [index, kind] of kinds.entries()) {
    const id = `${kind}-${rng.hex(8)}`;
    const collectedAt = isoMinutesAgo(anchor, 60 + index * (120 + rng.int(2000)));
    // The most recent archive is the one that failed, if anything did.
    const text = buildLogContent(rng, node, kind, failed && index === 0);
    logs.push({
      id,
      kind,
      collected_at: collectedAt,
      filename: `${node.uuid}_${kind}_${collectedAt.slice(0, 10)}.tar.gz`,
      size_bytes: text.length * (12 + rng.int(40)),
      source: rng.bool(0.7) ? 'swift' : 'local',
    });
    content.set(id, text);
  }

  return { logs, content };
}

interface SensorSpec {
  name: string;
  type: string;
  units: string;
  nominal: number;
  spread: number;
  warning: number;
  critical: number;
  physical_context: string;
}

const SENSOR_SPECS: SensorSpec[] = [
  { name: 'Inlet Temp', type: 'Temperature', units: 'Cel', nominal: 22, spread: 6, warning: 38, critical: 43, physical_context: 'Intake' },
  { name: 'Exhaust Temp', type: 'Temperature', units: 'Cel', nominal: 38, spread: 8, warning: 70, critical: 75, physical_context: 'Exhaust' },
  { name: 'CPU1 Temp', type: 'Temperature', units: 'Cel', nominal: 52, spread: 14, warning: 88, critical: 95, physical_context: 'CPU' },
  { name: 'CPU2 Temp', type: 'Temperature', units: 'Cel', nominal: 51, spread: 14, warning: 88, critical: 95, physical_context: 'CPU' },
  { name: 'Fan1A', type: 'Fan', units: 'RPM', nominal: 8400, spread: 1800, warning: 2000, critical: 1000, physical_context: 'Chassis' },
  { name: 'Fan2A', type: 'Fan', units: 'RPM', nominal: 8500, spread: 1800, warning: 2000, critical: 1000, physical_context: 'Chassis' },
  { name: 'Fan3A', type: 'Fan', units: 'RPM', nominal: 8300, spread: 1800, warning: 2000, critical: 1000, physical_context: 'Chassis' },
  { name: 'System Board 3.3V', type: 'Voltage', units: 'V', nominal: 3.3, spread: 0.1, warning: 3.6, critical: 3.8, physical_context: 'SystemBoard' },
  { name: 'System Board 12V', type: 'Voltage', units: 'V', nominal: 12, spread: 0.3, warning: 13, critical: 13.5, physical_context: 'SystemBoard' },
  { name: 'PSU1 Current', type: 'Current', units: 'A', nominal: 3.4, spread: 1.2, warning: 12, critical: 14, physical_context: 'PowerSupply' },
  { name: 'System Power', type: 'Power', units: 'W', nominal: 410, spread: 160, warning: 1100, critical: 1300, physical_context: 'Chassis' },
];

function buildHealth(rng: Rng, node: IronicNode, anchor: number): NodeHealth {
  const poweredOff = node.power_state !== 'power on';
  const sensors: SensorReading[] = [];

  for (const spec of SENSOR_SPECS) {
    // A powered-off machine reports thermals and load near idle, and its fans stop.
    if (poweredOff && (spec.type === 'Fan' || spec.type === 'Power' || spec.type === 'Current')) {
      sensors.push({
        name: spec.name,
        type: spec.type,
        reading: 0,
        units: spec.units,
        state: 'absent',
        threshold_warning: spec.warning,
        threshold_critical: spec.critical,
        physical_context: spec.physical_context,
      });
      continue;
    }

    const jitter = (rng.int(2001) / 1000 - 1) * spec.spread;
    const reading = Math.round((spec.nominal + jitter) * 100) / 100;
    sensors.push({
      name: spec.name,
      type: spec.type,
      reading,
      units: spec.units,
      state: 'ok',
      threshold_warning: spec.warning,
      threshold_critical: spec.critical,
      physical_context: spec.physical_context,
    });
  }

  // Some machines are genuinely unwell, and the page has to show that convincingly.
  const fault = node.maintenance ? rng.bool(0.7) : rng.bool(0.12);
  if (fault) {
    const failing = sensors.find((sensor) => sensor.state === 'ok' && sensor.type === 'Fan');
    if (failing) {
      failing.reading = rng.bool(0.5) ? 0 : 900;
      failing.state = failing.reading === 0 ? 'critical' : 'warning';
    }
  }

  /** Worst state among sensors of one type, ignoring absent ones. */
  function statusForType(type: string): string {
    const states = sensors.filter((sensor) => sensor.type === type).map((sensor) => sensor.state);
    if (states.includes('critical')) return 'critical';
    if (states.includes('warning')) return 'warning';
    // Everything absent means there is nothing to judge, not that all is well.
    if (states.every((state) => state === 'absent')) return 'unknown';
    return 'ok';
  }

  const checks = [
    {
      id: 'power',
      label: 'Power',
      status: poweredOff ? 'unknown' : 'ok',
      detail: poweredOff ? 'Node is powered off; live readings are unavailable.' : 'Reported by the BMC.',
    },
    { id: 'thermal', label: 'Thermal', status: statusForType('Temperature'), detail: null },
    { id: 'cooling', label: 'Cooling', status: statusForType('Fan'), detail: null },
    { id: 'storage', label: 'Storage', status: 'ok', detail: null },
    {
      id: 'event-log',
      label: 'Event log',
      status: fault ? 'warning' : 'ok',
      detail: fault ? 'Unresolved critical entries in the lifecycle log.' : 'No unresolved entries.',
    },
  ];

  // The rollup belongs to the conductor, not the UI, so the mock computes it here.
  // `absent` is normalised to `ok` first: an unpopulated fan bay is not a fault.
  const status = worstStatus([
    ...checks.map((check) => check.status),
    ...sensors.map((sensor) => (sensor.state === 'absent' ? 'ok' : sensor.state)),
  ]);

  return {
    status,
    // Deliberately a few minutes old: this is cached from the BMC, not live.
    collected_at: isoMinutesAgo(anchor, 1 + rng.int(6)),
    source: node.driver === 'ipmi' ? 'ipmi' : 'redfish',
    checks,
    sensors,
    supported: true,
  };
}

const SEL_MESSAGES: Array<{ severity: string; message: string; sensor: string; id: string }> = [
  { severity: 'OK', message: 'Power supply redundancy is restored.', sensor: 'PowerSupply', id: 'PSU0002' },
  { severity: 'OK', message: 'The chassis is closed while the power is on.', sensor: 'Intrusion', id: 'CPU0001' },
  { severity: 'Warning', message: 'The system inlet temperature is above the upper warning threshold.', sensor: 'Temperature', id: 'TMP0118' },
  { severity: 'Warning', message: 'Fan 3A RPM is below the lower warning threshold.', sensor: 'Fan', id: 'FAN0001' },
  { severity: 'Warning', message: 'Correctable memory error rate exceeded for DIMM A4.', sensor: 'Memory', id: 'MEM0701' },
  { severity: 'Critical', message: 'Fan 3A RPM is below the lower critical threshold.', sensor: 'Fan', id: 'FAN0002' },
  { severity: 'Critical', message: 'The power supply in slot 2 has failed.', sensor: 'PowerSupply', id: 'PSU0001' },
  { severity: 'Critical', message: 'Multi-bit memory error detected on DIMM B2.', sensor: 'Memory', id: 'MEM0702' },
];

const LC_MESSAGES: Array<{ severity: string; message: string; id: string }> = [
  { severity: 'OK', message: 'Successfully logged in using root, from 192.0.2.11 and REDFISH.', id: 'USR0030' },
  { severity: 'OK', message: 'The iDRAC firmware version was updated to 7.10.30.00.', id: 'RED001' },
  { severity: 'OK', message: 'Job JID_874219556301 completed successfully.', id: 'JCP037' },
  { severity: 'OK', message: 'The BIOS configuration job was created.', id: 'SYS057' },
  { severity: 'Warning', message: 'The SupportAssist collection was cancelled by the user.', id: 'SRV088' },
  { severity: 'Warning', message: 'Unable to reach the NTP server 192.0.2.1.', id: 'NIC0700' },
  { severity: 'Critical', message: 'Job JID_874219556301 failed: OS Collector could not reach the host agent.', id: 'JCP027' },
];

function buildLogServices(
  rng: Rng,
  node: IronicNode,
  anchor: number,
): { services: LogService[]; entries: Map<string, LogEntry[]> } {
  const entries = new Map<string, LogEntry[]>();

  function fill(id: string, count: number, pool: Array<{ severity: string; message: string; id: string; sensor?: string }>) {
    const list: LogEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      const template = rng.pick(pool);
      list.push({
        id: `${id}-${count - index}`,
        created: isoMinutesAgo(anchor, index * (20 + rng.int(900)) + rng.int(20)),
        severity: template.severity,
        message: template.message,
        message_id: template.id,
        entry_type: id === 'Sel' ? 'SEL' : 'Oem',
        sensor_type: template.sensor ?? null,
        // Dell only reports this for some entries; absent means unknown.
        resolved: template.severity === 'Critical' ? rng.bool(0.5) : undefined,
      });
    }
    entries.set(id, list);
    return list;
  }

  const sel = fill('Sel', 12 + rng.int(40), SEL_MESSAGES);
  const services: LogService[] = [
    {
      id: 'Sel',
      name: 'System Event Log',
      description: 'Hardware events recorded by the BMC.',
      entry_count: sel.length,
      oldest_entry: sel[sel.length - 1]?.created ?? null,
      newest_entry: sel[0]?.created ?? null,
      overwrite_policy: 'WrapsWhenFull',
      service_enabled: true,
    },
  ];

  // The Lifecycle Controller log is Dell-specific.
  if (node.driver === 'idrac') {
    const lc = fill('Lclog', 40 + rng.int(160), LC_MESSAGES);
    services.push({
      id: 'Lclog',
      name: 'Lifecycle Controller Log',
      description: 'Configuration, firmware and job history recorded by the iDRAC.',
      entry_count: lc.length,
      oldest_entry: lc[lc.length - 1]?.created ?? null,
      newest_entry: lc[0]?.created ?? null,
      overwrite_policy: 'WrapsWhenFull',
      service_enabled: true,
    });
  }

  return { services, entries };
}

export function buildDiagnostics(rng: Rng, node: IronicNode, anchor: number): Diagnostics {
  const { logs, content } = buildLogs(rng, node, anchor);
  const { services, entries } = buildLogServices(rng, node, anchor);
  return {
    history: buildHistory(rng, node, anchor),
    logs,
    logContent: content,
    health: buildHealth(rng, node, anchor),
    logServices: services,
    logEntries: entries,
  };
}
