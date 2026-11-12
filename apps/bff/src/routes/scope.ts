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

import type { RegionList, ScopeOptions } from '@nodedash/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { badRequest } from '../errors.ts';
import type { KeystoneClient } from '../keystone.ts';
import { rememberScopedToken } from '../node-request.ts';
import { requireAuth, requireRegion } from '../session.ts';
import { sessionView } from '../session-view.ts';

export function registerScopeRoutes(
  app: FastifyInstance,
  config: Config,
  keystone: KeystoneClient,
): void {
  app.get('/api/regions', async (request): Promise<RegionList> => {
    const auth = requireAuth(request);
    const regions = await keystone.listRegions(auth.unscopedToken);
    return { regions: regions.sort((a, b) => a.id.localeCompare(b.id)) };
  });

  /**
   * Picks the region whose Ironic every node request goes to. The selected
   * project is dropped because it may have no Ironic in the new region; the last
   * project is kept so the UI can offer it again.
   */
  app.put<{ Body: { region?: string } }>('/api/region', async (request) => {
    const auth = requireAuth(request);
    const region = request.body?.region;
    if (!region) throw badRequest('A region is required.');

    const regions = await keystone.listRegions(auth.unscopedToken);
    if (!regions.some((candidate) => candidate.id === region)) {
      throw badRequest(`Keystone has no region named ${region}.`);
    }

    request.session.region = region;
    request.session.scope = undefined;
    request.session.scoped = undefined;

    audit(request, { action: 'region.select', outcome: 'succeeded', detail: { region } });
    return sessionView(request, config);
  });

  app.get<{ Querystring: { search?: string; domainId?: string } }>(
    '/api/scope/options',
    async (request): Promise<ScopeOptions> => {
      const auth = requireAuth(request);

      // Fetched on every call: the BFF keeps no per-user cache. The picker only
      // asks again when the search changes, and debounces that.
      const projects = await keystone.listProjects(auth.unscopedToken);
      const domains = await keystone.nameDomains(auth.unscopedToken, projects);
      domains.sort((a, b) => a.name.localeCompare(b.name));

      const needle = request.query.search?.trim().toLowerCase();
      const domainId = request.query.domainId;
      let filtered = projects;
      if (domainId) filtered = filtered.filter((project) => project.domain_id === domainId);
      if (needle) {
        filtered = filtered.filter(
          (project) =>
            project.name.toLowerCase().includes(needle) ||
            project.id.toLowerCase().includes(needle) ||
            (project.description ?? '').toLowerCase().includes(needle),
        );
      }

      const truncated = filtered.length > config.projectListLimit;
      return {
        domains,
        projects: truncated ? filtered.slice(0, config.projectListLimit) : filtered,
        truncated,
      };
    },
  );

  app.put<{ Body: { projectId?: string } }>('/api/scope', async (request) => {
    const auth = requireRegion(request);
    const projectId = request.body?.projectId;
    if (!projectId) throw badRequest('A projectId is required.');

    const scoped = await keystone.scopedToken(auth.unscopedToken, projectId);
    // Refuses a project with no Ironic in this region before it becomes the scope.
    rememberScopedToken(request, scoped, auth.region);
    const scope = {
      domainId: scoped.domainId,
      domainName: scoped.domainName,
      projectId: scoped.projectId,
      projectName: scoped.projectName,
    };
    request.session.scope = scope;
    request.session.lastScope = scope;

    audit(request, { action: 'scope.select', outcome: 'succeeded' });
    return sessionView(request, config);
  });

  app.delete('/api/scope', async (request) => {
    requireAuth(request);
    request.session.scope = undefined;
    request.session.scoped = undefined;
    return sessionView(request, config);
  });
}
