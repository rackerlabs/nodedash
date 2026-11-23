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

/** Methods provided by the downstream Ironic idrac vendor interface. */
export const SUPPORT_ASSIST_METHODS = {
  eula: 'support_assist_get_eula_status',
  collect: 'support_assist_collect',
  job: 'get_job_status',
} as const;

// Require the whole filename, including rejection of a trailing newline.
export const SUPPORT_ASSIST_ARCHIVE_NAME = /^TSR[0-9]{14}_[A-Za-z0-9]+\.zip(?![\s\S])/;

export const SupportAssistArchivesSchema = z.array(
  z.object({
    name: z.string().regex(SUPPORT_ASSIST_ARCHIVE_NAME),
    modified: z.iso.datetime(),
    size: z.number().int().nonnegative(),
  }),
);
export type SupportAssistArchive = z.infer<typeof SupportAssistArchivesSchema>[number];

export const SupportAssistEulaSchema = z.object({ accepted: z.boolean() });
export const SupportAssistTaskSchema = z.object({
  task_monitor: z
    .string()
    .regex(
      /^\/redfish\/v1\/(?:TaskService\/(?:TaskMonitors|Tasks)|Managers\/iDRAC\.Embedded\.1\/Oem\/Dell\/Jobs)\/[A-Za-z0-9_-]+$/,
      'Enter a Redfish task monitor or Dell job path.',
    ),
});
export const SupportAssistJobSchema = SupportAssistTaskSchema.extend({
  is_processing: z.boolean(),
  task_state: z.string().nullable(),
  task_status: z.string().nullable(),
  percent_complete: z.number().nullable(),
  job_state: z.string().nullable(),
  messages: z.array(
    z.looseObject({
      Message: z.string().optional(),
      MessageId: z.string().optional(),
      MessageArgs: z.array(z.unknown()).optional(),
    }),
  ),
});
export type SupportAssistJob = z.infer<typeof SupportAssistJobSchema>;

export const supportAssistTone = toneLookup({
  Running: 'transient',
  Completed: 'active',
  Exception: 'error',
  Killed: 'error',
  Cancelled: 'error',
  Interrupted: 'error',
  Failed: 'error',
  CompletedWithErrors: 'error',
});

export const VendorPassthruMethodSchema = z.looseObject({
  http_methods: z.array(z.string()).default([]),
  async: z.boolean().nullish(),
  description: z.string().nullish(),
  require_exclusive_lock: z.boolean().nullish(),
});
export const VendorPassthruMethodsSchema = z.record(z.string(), VendorPassthruMethodSchema);
export type VendorPassthruMethods = z.infer<typeof VendorPassthruMethodsSchema>;

export function supportsSupportAssist(methods: VendorPassthruMethods | null | undefined): boolean {
  return (
    !!methods &&
    methods[SUPPORT_ASSIST_METHODS.eula]?.http_methods.includes('GET') === true &&
    methods[SUPPORT_ASSIST_METHODS.collect]?.http_methods.includes('POST') === true &&
    methods[SUPPORT_ASSIST_METHODS.job]?.http_methods.includes('GET') === true
  );
}
