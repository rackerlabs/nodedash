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
  SupportAssistTaskSchema,
  supportsSupportAssist,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import { badRequest, unsupported } from '../errors.ts';
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
