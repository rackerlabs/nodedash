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
 * Dell SupportAssist collection (what iDRAC used to call a Tech Support Report):
 * the BMC gathers hardware logs, configuration and optionally OS-side data into a
 * single archive that Dell support asks for on a hardware case.
 *
 * Ironic has no such endpoint today. This models the vendor passthru surface we
 * intend to add on the `idrac` hardware type, so the UI and the mock agree on a
 * contract before the Ironic side exists. Everything here is our design, not
 * upstream API: see docs/support-assist.md before wiring it to a real conductor.
 *
 * The collection is slow -- roughly half an hour on a busy BMC -- so it is modelled
 * as a job with its own lifecycle rather than a request/response call.
 */

/** Vendor passthru method names, as they will appear in `vendor_passthru/methods`. */
export const SUPPORT_ASSIST_METHODS = {
  /** POST, async: starts a collection. */
  collect: 'collect_support_assist',
  /** GET: lists collections known for the node. */
  list: 'support_assist_collections',
  /** GET: mints a short-lived download URL for one collection. */
  downloadUrl: 'support_assist_collection_url',
} as const;

/**
 * What the BMC can be asked to gather. Names match Dell's selectors so the
 * passthru can pass them through untranslated.
 *
 * `containsPii` is the one that matters operationally: OS and application data
 * pulls files off the running host, which on a tenant node means customer data.
 */
export const SUPPORT_ASSIST_SELECTORS = [
  {
    id: 'HWData',
    label: 'Hardware data',
    description: 'Inventory, sensor readings, POST results and the hardware event log.',
    containsPii: false,
    defaultOn: true,
  },
  {
    id: 'Debug',
    label: 'Debug logs',
    description: 'iDRAC debug logs and diagnostic dumps.',
    containsPii: false,
    defaultOn: true,
  },
  {
    id: 'TelemetryReports',
    label: 'Telemetry reports',
    description: 'Buffered telemetry streams: power, thermal and performance counters.',
    containsPii: false,
    defaultOn: false,
  },
  {
    id: 'TTYLogs',
    label: 'TTY logs',
    description: 'Serial console scrollback held by the BMC. May include console output from the host.',
    containsPii: false,
    defaultOn: false,
  },
  {
    id: 'OSAppData',
    label: 'OS and application data',
    description:
      'Pulls logs and configuration from the running operating system. On a tenant node this collects customer data.',
    containsPii: true,
    defaultOn: false,
  },
] as const;

export type SupportAssistSelectorId = (typeof SUPPORT_ASSIST_SELECTORS)[number]['id'];

export const SUPPORT_ASSIST_SELECTOR_IDS = SUPPORT_ASSIST_SELECTORS.map(
  (selector) => selector.id,
) as SupportAssistSelectorId[];

export function defaultSelectorIds(): SupportAssistSelectorId[] {
  return SUPPORT_ASSIST_SELECTORS.filter((selector) => selector.defaultOn).map((selector) => selector.id);
}

export function selectorById(id: string) {
  return SUPPORT_ASSIST_SELECTORS.find((selector) => selector.id === id);
}

/** True when this request would pull data that can contain customer information. */
export function requestTouchesPii(
  selectors: readonly string[],
  options: { filterPii: boolean },
): boolean {
  if (options.filterPii) return false;
  return selectors.some((id) => selectorById(id)?.containsPii === true);
}

export const SUPPORT_ASSIST_STATES = [
  'queued',
  'collecting',
  'uploading',
  'available',
  'failed',
  'expired',
] as const;
export type SupportAssistState = (typeof SUPPORT_ASSIST_STATES)[number];

/** States in which the job is still going and the UI should keep polling. */
export const SUPPORT_ASSIST_ACTIVE_STATES = ['queued', 'collecting', 'uploading'] as const;

export function isSupportAssistActive(state: string | null | undefined): boolean {
  return (SUPPORT_ASSIST_ACTIVE_STATES as readonly string[]).includes(state ?? '');
}

export function isSupportAssistDownloadable(
  collection: Pick<SupportAssistCollection, 'state'>,
): boolean {
  return collection.state === 'available';
}

export const supportAssistTone = toneLookup<SupportAssistState>({
  queued: 'transient',
  collecting: 'transient',
  uploading: 'transient',
  available: 'active',
  failed: 'error',
  expired: 'neutral',
});

export const SupportAssistCollectionSchema = z.looseObject({
  id: z.string(),
  state: z.string(),
  /** 0-100 where the BMC reports it; null when it only reports start and finish. */
  percent: z.number().nullish(),
  started_at: z.string(),
  finished_at: z.string().nullish(),
  /** Server-side estimate, so the UI does not have to hardcode "about 30 minutes". */
  estimated_completion_at: z.string().nullish(),
  /** Who asked for it. Bundles can contain customer data, so this is not optional in practice. */
  requested_by: z.string().nullish(),
  data_selectors: z.array(z.string()).default([]),
  filter_pii: z.boolean().default(true),
  filename: z.string().nullish(),
  size_bytes: z.number().nullish(),
  /** When the stored bundle is deleted from object storage. */
  expires_at: z.string().nullish(),
  error: z.string().nullish(),
});
export type SupportAssistCollection = z.infer<typeof SupportAssistCollectionSchema>;

export const SupportAssistCollectionListSchema = z.looseObject({
  collections: z.array(SupportAssistCollectionSchema),
  /** False when the node's driver does not offer the passthru at all. */
  supported: z.boolean().default(true),
});
export type SupportAssistCollectionList = z.infer<typeof SupportAssistCollectionListSchema>;

export const SupportAssistStartRequestSchema = z.object({
  data_selectors: z.array(z.enum(SUPPORT_ASSIST_SELECTOR_IDS)).min(1),
  filter_pii: z.boolean(),
});
export type SupportAssistStartRequest = z.infer<typeof SupportAssistStartRequestSchema>;

/**
 * Shape of one entry in Ironic's `vendor_passthru/methods` response. Ironic keys
 * the object by method name.
 */
export const VendorPassthruMethodSchema = z.looseObject({
  http_methods: z.array(z.string()).default([]),
  async: z.boolean().nullish(),
  description: z.string().nullish(),
  require_exclusive_lock: z.boolean().nullish(),
});

export const VendorPassthruMethodsSchema = z.record(z.string(), VendorPassthruMethodSchema);
export type VendorPassthruMethods = z.infer<typeof VendorPassthruMethodsSchema>;

/** Whether a node's driver offers everything SupportAssist needs. */
export function supportsSupportAssist(methods: VendorPassthruMethods | null | undefined): boolean {
  if (!methods) return false;
  return SUPPORT_ASSIST_METHODS.collect in methods && SUPPORT_ASSIST_METHODS.list in methods;
}
