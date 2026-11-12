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

import type { FastifyRequest } from 'fastify';

/**
 * Every state-changing action is logged with who did it, where, and what happened.
 * These are hardware operations on machines that may be running customer
 * workloads, so an audit trail is not optional.
 */
export function audit(
  request: FastifyRequest,
  entry: {
    action: string;
    nodeUuid?: string;
    outcome: 'requested' | 'succeeded' | 'failed';
    detail?: Record<string, unknown>;
  },
): void {
  request.log.info(
    {
      audit: true,
      action: entry.action,
      outcome: entry.outcome,
      actorId: request.session.identity?.userId ?? null,
      actorName: request.session.identity?.userName ?? null,
      idp: request.session.identity?.idp ?? null,
      projectId: request.session.scope?.projectId ?? null,
      projectName: request.session.scope?.projectName ?? null,
      nodeUuid: entry.nodeUuid ?? null,
      ...entry.detail,
    },
    `audit ${entry.action} ${entry.outcome}`,
  );
}
