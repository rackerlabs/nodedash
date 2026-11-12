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
import { toneLookup } from './tone.ts';

/**
 * Node health: the BMC's own view of whether the machine is well, plus its event
 * logs. None of this exists in upstream Ironic yet — Ironic reads sensor data but
 * only emits it to the message bus, and the Redfish LogService resources are not
 * exposed at all. See docs/ironic-api-gaps.md items 6 to 8.
 *
 * The overall status is computed by the conductor, not here: two clients deriving
 * "healthy" from raw sensor readings would disagree with each other.
 */

export const HEALTH_STATUSES = ['ok', 'warning', 'critical', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const healthTone = toneLookup<HealthStatus>({
  ok: 'active',
  warning: 'transient',
  critical: 'error',
  unknown: 'neutral',
});

const STATUS_RANK: Record<string, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

/** Worst status wins, so a single critical sensor is never averaged away. */
export function worstStatus(statuses: Iterable<string | null | undefined>): HealthStatus {
  let worst: HealthStatus = 'ok';
  for (const status of statuses) {
    const candidate = (status ?? 'unknown') as HealthStatus;
    if ((STATUS_RANK[candidate] ?? 1) > (STATUS_RANK[worst] ?? 0)) worst = candidate;
  }
  return worst;
}

/** Redfish sensor categories, in the order the health page groups them. */
export const SENSOR_TYPES = ['Temperature', 'Fan', 'Voltage', 'Current', 'Power'] as const;

export const SENSOR_STATES = ['ok', 'warning', 'critical', 'absent', 'unknown'] as const;

/**
 * `absent` is not a fault: an empty PSU bay or unpopulated fan slot reports it, and
 * showing that as a problem trains operators to ignore the health page.
 */
export function isSensorFault(state: string | null | undefined): boolean {
  return state === 'warning' || state === 'critical';
}

export const SensorReadingSchema = z.looseObject({
  name: z.string(),
  type: z.string(),
  reading: z.number().nullish(),
  units: z.string().nullish(),
  state: z.string().nullish(),
  threshold_warning: z.number().nullish(),
  threshold_critical: z.number().nullish(),
  /** Redfish PhysicalContext, e.g. "CPU", "Intake", "PowerSupply". */
  physical_context: z.string().nullish(),
});
export type SensorReading = z.infer<typeof SensorReadingSchema>;

export const HealthCheckSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  status: z.string(),
  detail: z.string().nullish(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const NodeHealthSchema = z.looseObject({
  status: z.string(),
  /**
   * When the conductor last read this from the BMC. Sensor data is cached, and a
   * stale reading presented as live is worse than one labelled stale.
   */
  collected_at: z.string().nullish(),
  source: z.string().nullish(),
  checks: z.array(HealthCheckSchema).default([]),
  sensors: z.array(SensorReadingSchema).default([]),
  /** False when the node's driver cannot report health. */
  supported: z.boolean().default(true),
});
export type NodeHealth = z.infer<typeof NodeHealthSchema>;

/** How stale a reading can be before the UI calls it out. */
export const HEALTH_STALE_AFTER_MS = 10 * 60_000;

export function isHealthStale(
  collectedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!collectedAt) return true;
  const timestamp = new Date(collectedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp > HEALTH_STALE_AFTER_MS;
}

export const LOG_ENTRY_SEVERITIES = ['OK', 'Warning', 'Critical'] as const;

export const logSeverityTone = toneLookup({
  OK: 'active',
  Warning: 'transient',
  Critical: 'error',
});

export const LogServiceSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  entry_count: z.number().nullish(),
  oldest_entry: z.string().nullish(),
  newest_entry: z.string().nullish(),
  overwrite_policy: z.string().nullish(),
  service_enabled: z.boolean().nullish(),
});
export type LogService = z.infer<typeof LogServiceSchema>;

export const LogServiceListSchema = z.looseObject({
  log_services: z.array(LogServiceSchema),
  supported: z.boolean().default(true),
});

export const LogEntrySchema = z.looseObject({
  id: z.string(),
  created: z.string(),
  severity: z.string().nullish(),
  message: z.string(),
  message_id: z.string().nullish(),
  entry_type: z.string().nullish(),
  sensor_type: z.string().nullish(),
  /** Dell OEM. Absent means unknown, which is not the same as unresolved. */
  resolved: z.boolean().nullish(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const LogEntryListSchema = z.looseObject({
  entries: z.array(LogEntrySchema),
  next: z.string().nullish(),
});
