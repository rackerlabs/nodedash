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

import type { FastifyInstance } from 'fastify';
import { unsupported } from '../errors.ts';
import type { IronicClient } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { ironicTarget, nodePath } from '../node-request.ts';

interface NodeParams {
  uuid: string;
}

/**
 * Diagnostic surfaces: what Ironic did to the node, what the ramdisk said, and what
 * the BMC thinks of its own hardware.
 *
 * Only node history is real API (microversion 1.78). Node logs, health and the
 * Redfish LogService passthrough are all endpoints we still have to build on the
 * Ironic side — see docs/ironic-api-gaps.md items 4 to 8. They are proxied here so
 * the UI is finished ahead of them; against a real deployment they will 404 until
 * that work lands, which the UI presents as "not available on this deployment"
 * rather than as a failure.
 */
export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  keystone: KeystoneClient,
  ironic: IronicClient,
): void {
  app.get<{ Params: NodeParams; Querystring: { limit?: string } }>(
    '/api/nodes/:uuid/history',
    async (request) => {
      const target = await ironicTarget(keystone, request);
      const { capabilities } = await ironic.capabilities(target.endpoint);
      if (!capabilities.nodeHistory) {
        throw unsupported('This Ironic API is too old to expose node history.');
      }
      return ironic.json(target, nodePath(request.params.uuid, '/history'), {
        query: { detail: 'true', limit: request.query.limit },
      });
    },
  );

  app.get<{ Params: NodeParams }>('/api/nodes/:uuid/logs', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, nodePath(request.params.uuid, '/logs'));
  });

  app.get<{ Params: NodeParams & { id: string } }>(
    '/api/nodes/:uuid/logs/:id',
    async (request) => {
      const target = await ironicTarget(keystone, request);
      return ironic.json(
        target,
        nodePath(request.params.uuid, `/logs/${encodeURIComponent(request.params.id)}`),
      );
    },
  );

  app.get<{ Params: NodeParams }>('/api/nodes/:uuid/health', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, nodePath(request.params.uuid, '/health'));
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:uuid/log-services', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, nodePath(request.params.uuid, '/log_services'));
  });

  app.get<{
    Params: NodeParams & { serviceId: string };
    Querystring: { limit?: string; marker?: string; severity?: string };
  }>('/api/nodes/:uuid/log-services/:serviceId/entries', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(
      target,
      nodePath(
        request.params.uuid,
        `/log_services/${encodeURIComponent(request.params.serviceId)}/entries`,
      ),
      {
        query: {
          limit: request.query.limit,
          marker: request.query.marker,
          severity: request.query.severity,
        },
      },
    );
  });
}
