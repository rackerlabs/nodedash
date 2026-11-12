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
  SupportAssistStartRequestSchema,
  supportsSupportAssist,
  type SupportAssistCollectionList,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { badRequest, fromUpstream, unsupported } from '../errors.ts';
import type { IronicClient, IronicTarget } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { ironicTarget, nodePath } from '../node-request.ts';

interface NodeParams {
  uuid: string;
}

interface CollectionParams extends NodeParams {
  id: string;
}

/**
 * Dell SupportAssist collection, exposed through Ironic vendor passthru.
 *
 * Nothing here exists in upstream Ironic yet: these calls target the passthru
 * methods we intend to add to the `idrac` hardware type, described in
 * packages/shared/src/support-assist.ts. Until that lands, only the mock backend
 * answers them.
 *
 * A collection takes around half an hour and produces an archive that can contain
 * customer data, which drives two things here: starting one and downloading one
 * are both audited, and the download is a redirect to short-lived storage rather
 * than something this service caches.
 */
export function registerSupportAssistRoutes(
  app: FastifyInstance,
  config: Config,
  keystone: KeystoneClient,
  ironic: IronicClient,
): void {
  async function methodsFor(target: IronicTarget, uuid: string): Promise<VendorPassthruMethods> {
    return ironic.json<VendorPassthruMethods>(target, nodePath(uuid, '/vendor_passthru/methods'));
  }

  /**
   * Vendor passthru is driver-specific, so whether a node can do this at all is a
   * property of the node, not of the API version. The UI gates the tab on this.
   */
  app.get<{ Params: NodeParams }>('/api/nodes/:uuid/vendor-passthru/methods', async (request) => {
    const target = await ironicTarget(keystone, request);
    return methodsFor(target, request.params.uuid);
  });

  app.get<{ Params: NodeParams }>(
    '/api/nodes/:uuid/support-assist',
    async (request): Promise<SupportAssistCollectionList> => {
      const target = await ironicTarget(keystone, request);
      const methods = await methodsFor(target, request.params.uuid);
      if (!supportsSupportAssist(methods)) return { collections: [], supported: false };

      const result = await ironic.json<{ collections?: SupportAssistCollectionList['collections'] }>(
        target,
        nodePath(request.params.uuid, '/vendor_passthru'),
        { query: { method: SUPPORT_ASSIST_METHODS.list } },
      );
      return { collections: result.collections ?? [], supported: true };
    },
  );

  app.post<{ Params: NodeParams }>('/api/nodes/:uuid/support-assist', async (request, reply) => {
    const parsed = SupportAssistStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest('Choose at least one category of data to collect.');
    }

    const target = await ironicTarget(keystone, request);
    const methods = await methodsFor(target, request.params.uuid);
    if (!supportsSupportAssist(methods)) {
      throw unsupported(
        'This node’s driver does not offer SupportAssist. Only Dell nodes on the idrac hardware type can collect one.',
      );
    }

    // Recorded before the call as well as after, so an attempt that never comes
    // back is still attributable — this can pull customer data off a host.
    const detail = {
      dataSelectors: parsed.data.data_selectors,
      filterPii: parsed.data.filter_pii,
    };
    audit(request, {
      action: 'node.supportAssist.start',
      nodeUuid: request.params.uuid,
      outcome: 'requested',
      detail,
    });

    const collection = await ironic.json(target, nodePath(request.params.uuid, '/vendor_passthru'), {
      method: 'POST',
      query: { method: SUPPORT_ASSIST_METHODS.collect },
      body: parsed.data,
    });

    audit(request, {
      action: 'node.supportAssist.start',
      nodeUuid: request.params.uuid,
      outcome: 'succeeded',
      detail,
    });
    return reply.code(202).send(collection);
  });

  /**
   * Redirects to a short-lived storage URL minted by the conductor. The bundle is
   * hundreds of megabytes and can contain customer data, so it is neither proxied
   * through this service nor cached here; the operator's browser fetches it once,
   * and the download is audited.
   */
  app.get<{ Params: CollectionParams }>(
    '/api/nodes/:uuid/support-assist/:id/download',
    async (request, reply) => {
      const target = await ironicTarget(keystone, request);
      const minted = await ironic.json<{ url?: string }>(
        target,
        nodePath(request.params.uuid, '/vendor_passthru'),
        {
          query: {
            method: SUPPORT_ASSIST_METHODS.downloadUrl,
            collection_id: request.params.id,
          },
        },
      );

      const storageUrl = safeStorageUrl(minted.url, config);
      audit(request, {
        action: 'node.supportAssist.download',
        nodeUuid: request.params.uuid,
        outcome: 'succeeded',
        detail: { collectionId: request.params.id, storageHost: new URL(storageUrl).host },
      });
      return reply.redirect(storageUrl, 302);
    },
  );
}

/**
 * The redirect target comes from upstream, so it is validated rather than trusted:
 * an unexpected value here would turn this endpoint into an open redirect. Hosts
 * can additionally be pinned with SUPPORT_ASSIST_STORAGE_HOSTS.
 */
export function safeStorageUrl(value: string | undefined | null, config: Config): string {
  if (!value) {
    throw fromUpstream(502, 'The conductor did not return a download URL for this collection.', null);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fromUpstream(502, 'The conductor returned a download URL that could not be parsed.', null);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw fromUpstream(502, `Refusing to redirect to a ${url.protocol} URL.`, null);
  }
  if (config.supportAssistStorageHosts.length > 0 && !config.supportAssistStorageHosts.includes(url.host)) {
    throw fromUpstream(
      502,
      `Refusing to redirect to ${url.host}: it is not in SUPPORT_ASSIST_STORAGE_HOSTS.`,
      null,
    );
  }
  return url.toString();
}
