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
 * Two different things an operator means by "the node's logs":
 *
 *  - Ironic's own record of what it did to the node (`/v1/nodes/{node}/history`,
 *    microversion 1.78). This is real API.
 *  - The ramdisk/agent logs the conductor collected during a deploy, clean or
 *    inspect. Ironic collects these to disk or object storage today but does not
 *    serve them, so operators end up on the conductor host. The endpoints below
 *    are ours to build — see docs/ironic-api-gaps.md items 4 and 5.
 */

/** Severity vocabulary Ironic uses for history events. */
export const HISTORY_SEVERITIES = ['DEBUG', 'INFO', 'WARNING', 'ERROR'] as const;

export const historySeverityTone = toneLookup({
  ERROR: 'error',
  WARNING: 'transient',
  INFO: 'available',
  DEBUG: 'neutral',
});

export const NodeHistoryEventSchema = z.looseObject({
  uuid: z.string(),
  created_at: z.string(),
  severity: z.string().nullish(),
  event: z.string(),
  event_type: z.string().nullish(),
  conductor: z.string().nullish(),
  user: z.string().nullish(),
});
export type NodeHistoryEvent = z.infer<typeof NodeHistoryEventSchema>;

export const NodeHistoryListSchema = z.looseObject({
  history: z.array(NodeHistoryEventSchema),
  next: z.string().nullish(),
});

/** The operation a ramdisk log archive came from. */
export const LOG_KINDS = ['deploy', 'clean', 'inspect', 'service', 'rescue'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const NodeLogArchiveSchema = z.looseObject({
  id: z.string(),
  kind: z.string(),
  collected_at: z.string(),
  filename: z.string(),
  size_bytes: z.number().nullish(),
  /** `local` means the conductor filesystem; otherwise object storage. */
  source: z.string().nullish(),
});
export type NodeLogArchive = z.infer<typeof NodeLogArchiveSchema>;

export const NodeLogArchiveListSchema = z.looseObject({
  logs: z.array(NodeLogArchiveSchema),
  /** False when this deployment has no log-serving endpoint yet. */
  supported: z.boolean().default(true),
});
export type NodeLogArchiveList = z.infer<typeof NodeLogArchiveListSchema>;

export const NodeLogContentSchema = z.looseObject({
  id: z.string(),
  content: z.string(),
  /** Set when the server capped the response; the UI says so rather than implying completeness. */
  truncated: z.boolean().default(false),
  line_count: z.number().nullish(),
});
export type NodeLogContent = z.infer<typeof NodeLogContentSchema>;
