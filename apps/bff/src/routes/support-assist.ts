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
  SUPPORT_ASSIST_ARCHIVE_NAME,
  SupportAssistTaskSchema,
  supportsSupportAssist,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { archiveResponse, listArchives } from '../support-assist-archives.ts';
import { badRequest, unsupported, HttpError } from '../errors.ts';
import type { IronicClient, IronicTarget } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { ironicTarget, nodePath } from '../node-request.ts';

interface NodeParams {
  region: string;
  uuid: string;
}

export function registerSupportAssistRoutes(
  app: FastifyInstance,
  keystone: KeystoneClient,
  ironic: IronicClient,
  config: Config,
): void {
  async function methodsFor(target: IronicTarget, uuid: string): Promise<VendorPassthruMethods> {
    return ironic.json<VendorPassthruMethods>(target, nodePath(uuid, '/vendor_passthru/methods'));
  }
  function methodPath(uuid: string, method: string) {
    return nodePath(uuid, `/vendor_passthru/${method}`);
  }

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/vendor-passthru/methods', async (request) => {
    const target = await ironicTarget(keystone, request);
    return methodsFor(target, request.params.uuid);
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/support-assist/eula', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, methodPath(request.params.uuid, SUPPORT_ASSIST_METHODS.eula));
  });

  app.post<{ Params: NodeParams }>('/api/nodes/:region/:uuid/support-assist', async (request) => {
    const target = await ironicTarget(keystone, request);
    if (!supportsSupportAssist(await methodsFor(target, request.params.uuid))) {
      throw unsupported('This node’s driver does not offer the required SupportAssist methods.');
    }
    audit(request, {
      action: 'node.supportAssist.start',
      nodeUuid: request.params.uuid,
      outcome: 'requested',
    });
    // Ironic owns the collection defaults and the configured upload destination.
    const task = await ironic.json(target, methodPath(request.params.uuid, SUPPORT_ASSIST_METHODS.collect), {
      method: 'POST',
      body: {},
    });
    audit(request, {
      action: 'node.supportAssist.start',
      nodeUuid: request.params.uuid,
      outcome: 'succeeded',
    });
    return task;
  });

  async function archiveAccess(request: FastifyRequest<{ Params: NodeParams }>) {
    const { uuid } = request.params;
    if (!z.uuid().safeParse(uuid).success) throw badRequest('A node UUID is required for archive access.');
    const target = await ironicTarget(keystone, request);
    // Ironic checks baremetal:node:vendor_passthru here, on every request.
    if (!supportsSupportAssist(await methodsFor(target, request.params.uuid))) {
      throw unsupported('This node’s driver does not offer the required SupportAssist methods.');
    }
    const store = Object.hasOwn(config.supportAssistArchives, request.params.region)
      ? config.supportAssistArchives[request.params.region]
      : undefined;
    if (!store) throw unsupported('Archive downloads are not configured for this region.');
    return { store, uuid };
  }

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/support-assist/archives', async (request) => {
    const { store, uuid } = await archiveAccess(request);
    return listArchives(store, uuid);
  });

  app.get<{ Params: NodeParams & { name: string } }>(
    '/api/nodes/:region/:uuid/support-assist/archives/:name',
    async (request, reply) => {
      const { store, uuid } = await archiveAccess(request);
      const { name } = request.params;
      if (!SUPPORT_ASSIST_ARCHIVE_NAME.test(name)) {
        throw new HttpError(404, 'not_found', 'Archive not found for this node.');
      }
      const record = (outcome: 'requested' | 'succeeded' | 'failed') =>
        audit(request, {
          action: 'node.supportAssist.download',
          nodeUuid: request.params.uuid,
          outcome,
          detail: { filename: name },
        });
      record('requested');
      let recorded = false;
      const finish = (outcome: 'succeeded' | 'failed') => {
        if (recorded) return;
        recorded = true;
        record(outcome);
      };
      let response;
      try {
        response = await archiveResponse(store, uuid, name);
      } catch (error) {
        finish('failed');
        throw error;
      }
      if (reply.raw.destroyed) {
        response.destroy();
        finish('failed');
        return reply;
      }
      // Completion means sent by this server, not saved or verified by the browser.
      reply.raw.once('finish', () => finish('succeeded'));
      // Keep cancellation active until the browser response closes.
      reply.raw.once('close', () => {
        response.destroy();
        finish(reply.raw.writableFinished ? 'succeeded' : 'failed');
      });
      response.once('error', () => finish('failed'));
      response.once('close', () => {
        if (!response.complete) finish('failed');
      });
      reply.type('application/zip').header('Content-Disposition', `attachment; filename="${name}"`);
      reply.header('X-Content-Type-Options', 'nosniff');
      if (response.headers['content-length'])
        reply.header('Content-Length', response.headers['content-length']);
      return reply.send(response);
    },
  );

  // Browser fetch cannot send a GET body. Only this BFF-to-Ironic call uses one.
  app.post<{ Params: NodeParams }>('/api/nodes/:region/:uuid/support-assist/job', async (request) => {
    const parsed = SupportAssistTaskSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Enter a Redfish task monitor or Dell job path.');
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, methodPath(request.params.uuid, SUPPORT_ASSIST_METHODS.job), {
      method: 'GET',
      body: parsed.data,
    });
  });
}
