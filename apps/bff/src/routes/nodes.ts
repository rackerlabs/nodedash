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
  buildExtraPatch,
  POWER_TARGETS,
  type IronicNode,
  type LocateResult,
  type PowerTarget,
} from '@nodedash/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { badRequest, unsupported } from '../errors.ts';
import type { IronicClient } from '../ironic.ts';
import type { KeystoneClient } from '../keystone.ts';
import { locateNode } from '../locate.ts';
import { ironicTarget, nodePath, rememberScopedToken } from '../node-request.ts';
import { requireRegion } from '../session.ts';

interface NodeParams {
  region: string;
  uuid: string;
}

export function registerNodeRoutes(
  app: FastifyInstance,
  config: Config,
  keystone: KeystoneClient,
  ironic: IronicClient,
): void {
  /** What the selected region's Ironic supports; regions can run different releases. */
  app.get('/api/capabilities/:region', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.capabilities(target.endpoint);
  });

  app.get<{ Querystring: { limit?: string; marker?: string } }>('/api/nodes/:region', async (request) => {
    const target = await ironicTarget(keystone, request);
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    return ironic.allNodes(target, {
      pageSize: Number.isFinite(limit) ? limit : undefined,
      marker: request.query.marker,
    });
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json<IronicNode>(target, nodePath(request.params.uuid));
  });

  /**
   * Resolves a bare node uuid to the project that owns it, for shared links that
   * arrive with no project selected.
   */
  app.post<{ Params: NodeParams }>('/api/nodes/:region/:uuid/locate', async (request): Promise<LocateResult> => {
    const auth = requireRegion(request);
    const projects = await keystone.listProjects(auth.unscopedToken);

    const outcome = await locateNode(request.params.uuid, {
      config,
      keystone,
      ironic,
      unscopedToken: auth.unscopedToken,
      region: auth.region,
      projects,
      preferProjectIds: [request.session.scope?.projectId, request.session.lastScope?.projectId],
    });

    if (outcome.scope && outcome.scoped) {
      request.session.scope = outcome.scope;
      request.session.lastScope = outcome.scope;
      rememberScopedToken(request, outcome.scoped, auth.region);
    }

    audit(request, {
      action: 'node.locate',
      nodeUuid: request.params.uuid,
      outcome: outcome.scope ? 'succeeded' : 'failed',
      detail: { projectsSearched: outcome.projectsSearched },
    });

    return {
      found: outcome.scope !== null,
      scope: outcome.scope,
      projectsSearched: outcome.projectsSearched,
    };
  });

  /**
   * `openstack baremetal node set --extra key=value`, limited to the keys in
   * EDITABLE_EXTRA_FIELDS. The check is here and not only in the form, because the
   * form is not a boundary.
   */
  app.patch<{ Params: NodeParams; Body: { values?: unknown } }>(
    '/api/nodes/:region/:uuid/extra',
    async (request) => {
      const built = buildExtraPatch(config.editableExtraFields, request.body?.values);
      if ('error' in built) throw badRequest(built.error);

      const target = await ironicTarget(keystone, request);
      const detail = { fields: built.patch.map((op) => ({ field: op.path.slice('/extra/'.length), value: op.value })) };
      audit(request, { action: 'node.extra.set', nodeUuid: request.params.uuid, outcome: 'requested', detail });
      const node = await ironic.json<IronicNode>(target, nodePath(request.params.uuid), {
        method: 'PATCH',
        body: built.patch,
      });
      audit(request, { action: 'node.extra.set', nodeUuid: request.params.uuid, outcome: 'succeeded', detail });
      return node;
    },
  );

  app.put<{ Params: NodeParams; Body: { reason?: string } }>(
    '/api/nodes/:region/:uuid/maintenance',
    async (request) => {
      const reason = request.body?.reason?.trim();
      if (!reason) throw badRequest('A maintenance reason is required.');

      const target = await ironicTarget(keystone, request);
      audit(request, {
        action: 'node.maintenance.set',
        nodeUuid: request.params.uuid,
        outcome: 'requested',
        detail: { reason },
      });
      await ironic.json(target, nodePath(request.params.uuid, '/maintenance'), {
        method: 'PUT',
        body: { reason },
      });
      audit(request, {
        action: 'node.maintenance.set',
        nodeUuid: request.params.uuid,
        outcome: 'succeeded',
      });
      return ironic.json<IronicNode>(target, nodePath(request.params.uuid));
    },
  );

  app.delete<{ Params: NodeParams }>('/api/nodes/:region/:uuid/maintenance', async (request) => {
    const target = await ironicTarget(keystone, request);
    audit(request, {
      action: 'node.maintenance.clear',
      nodeUuid: request.params.uuid,
      outcome: 'requested',
    });
    await ironic.json(target, nodePath(request.params.uuid, '/maintenance'), { method: 'DELETE' });
    audit(request, {
      action: 'node.maintenance.clear',
      nodeUuid: request.params.uuid,
      outcome: 'succeeded',
    });
    return ironic.json<IronicNode>(target, nodePath(request.params.uuid));
  });

  app.put<{ Params: NodeParams; Body: { target?: string } }>(
    '/api/nodes/:region/:uuid/power',
    async (request, reply) => {
      const powerTarget = request.body?.target;
      if (!powerTarget || !(POWER_TARGETS as readonly string[]).includes(powerTarget)) {
        throw badRequest(`target must be one of: ${POWER_TARGETS.join(', ')}.`);
      }

      const target = await ironicTarget(keystone, request);
      audit(request, {
        action: 'node.power',
        nodeUuid: request.params.uuid,
        outcome: 'requested',
        detail: { target: powerTarget },
      });
      await ironic.json(target, nodePath(request.params.uuid, '/states/power'), {
        method: 'PUT',
        body: { target: powerTarget as PowerTarget },
      });
      audit(request, {
        action: 'node.power',
        nodeUuid: request.params.uuid,
        outcome: 'succeeded',
        detail: { target: powerTarget },
      });
      return reply.code(204).send();
    },
  );

  /**
   * The node's ports with every column Ironic has (`detail`), which is what carries
   * the switch cabling and VIF bookkeeping. Ironic refuses `detail` together with
   * `fields`, so the whole port is fetched; a node has a handful of them.
   */
  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/ports', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, '/v1/ports', {
      query: { node_uuid: request.params.uuid, detail: 'true' },
    });
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/inventory', async (request) => {
    const target = await ironicTarget(keystone, request);
    const { capabilities } = await ironic.capabilities(target.endpoint);
    if (!capabilities.inventory) {
      throw unsupported('This Ironic API is too old to expose node inventory.');
    }
    return ironic.json(target, nodePath(request.params.uuid, '/inventory'));
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/bios', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, nodePath(request.params.uuid, '/bios'));
  });

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/firmware', async (request) => {
    const target = await ironicTarget(keystone, request);
    const { capabilities } = await ironic.capabilities(target.endpoint);
    if (!capabilities.firmware) {
      throw unsupported('This Ironic API is too old to report firmware components.');
    }
    return ironic.json(target, nodePath(request.params.uuid, '/firmware'));
  });

  app.get('/api/runbooks/:region', async (request) => {
    const target = await ironicTarget(keystone, request);
    const { capabilities } = await ironic.capabilities(target.endpoint);
    if (!capabilities.runbooks) {
      throw unsupported('This Ironic API is too old to support runbooks.');
    }
    return ironic.json(target, '/v1/runbooks', { query: { detail: 'true' } });
  });

  app.put<{ Params: NodeParams; Body: { runbook?: string } }>(
    '/api/nodes/:region/:uuid/service',
    async (request, reply) => {
      const runbook = request.body?.runbook?.trim();
      if (!runbook) throw badRequest('A runbook name or uuid is required.');

      const target = await ironicTarget(keystone, request);
      const { capabilities } = await ironic.capabilities(target.endpoint);
      if (!capabilities.runbooks || !capabilities.serviceSteps) {
        throw unsupported('This Ironic API is too old to run runbooks through service steps.');
      }

      audit(request, {
        action: 'node.service.runbook',
        nodeUuid: request.params.uuid,
        outcome: 'requested',
        detail: { runbook },
      });
      await ironic.json(target, nodePath(request.params.uuid, '/states/provision'), {
        method: 'PUT',
        body: { target: 'service', runbook },
      });
      audit(request, {
        action: 'node.service.runbook',
        nodeUuid: request.params.uuid,
        outcome: 'succeeded',
        detail: { runbook },
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: NodeParams }>('/api/nodes/:region/:uuid/console', async (request) => {
    const target = await ironicTarget(keystone, request);
    return ironic.json(target, nodePath(request.params.uuid, '/states/console'));
  });

  app.put<{ Params: NodeParams; Body: { enabled?: boolean } }>(
    '/api/nodes/:region/:uuid/console',
    async (request, reply) => {
      const enabled = request.body?.enabled;
      if (typeof enabled !== 'boolean') throw badRequest('enabled must be true or false.');

      const target = await ironicTarget(keystone, request);
      // console_type is only needed where a node exposes more than one console
      // flavour; see GRAPHICAL_CONSOLE_TYPE in config.
      const body: Record<string, unknown> = { enabled };
      if (enabled && config.graphicalConsoleType) body.console_type = config.graphicalConsoleType;

      audit(request, {
        action: enabled ? 'node.console.enable' : 'node.console.disable',
        nodeUuid: request.params.uuid,
        outcome: 'requested',
      });
      await ironic.json(target, nodePath(request.params.uuid, '/states/console'), { method: 'PUT', body });
      return reply.code(204).send();
    },
  );
}
