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
import { cacheScopedToken } from '../node-request.ts';
import { requireAuth } from '../session.ts';
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
    const auth = requireAuth(request);
    const projectId = request.body?.projectId;
    if (!projectId) throw badRequest('A projectId is required.');

    // Keystone refuses a project the user has no role on. Whether the project has
    // an Ironic in the region being viewed is only known per request, so that is
    // checked when a node call looks up the endpoint.
    const scoped = await keystone.scopedToken(auth.unscopedToken, projectId);
    cacheScopedToken(request, scoped);
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
