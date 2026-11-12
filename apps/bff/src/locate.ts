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

import type { Project, Scope } from '@nodedash/shared';
import type { Config } from './config.ts';
import type { IronicClient } from './ironic.ts';
import type { KeystoneClient, ScopedToken } from './keystone.ts';

export interface LocateOutcome {
  scope: Scope | null;
  /** The token that found the node, so the caller can adopt it as the current one. */
  scoped: ScopedToken | null;
  projectsSearched: number;
}

/**
 * Finds which of the user's projects owns a node in a region.
 *
 * There is no cross-project node lookup in Ironic — a project-scoped token only
 * sees its own nodes — so this scopes a token per project and asks for the node by
 * uuid, with bounded concurrency and an early exit on the first hit. The caller's
 * preferred projects (current, then last used) are tried first.
 *
 * Nothing is remembered between lookups: the BFF keeps no per-user state.
 */
export async function locateNode(
  uuid: string,
  options: {
    config: Config;
    keystone: KeystoneClient;
    ironic: IronicClient;
    unscopedToken: string;
    region: string;
    projects: Project[];
    preferProjectIds?: Array<string | undefined>;
  },
): Promise<LocateOutcome> {
  const { config, keystone, ironic, unscopedToken, region, projects } = options;

  const ordered = orderCandidates(projects, options.preferProjectIds ?? []);
  let searched = 0;
  let found: { scope: Scope; scoped: ScopedToken } | null = null;

  const queue = [...ordered];
  const workerCount = Math.min(config.locateConcurrency, queue.length);

  async function worker(): Promise<void> {
    while (!found) {
      const project = queue.shift();
      if (!project) return;
      searched += 1;
      const hit = await checkProject(project);
      if (hit) found = hit;
    }
  }

  async function checkProject(project: Project): Promise<{ scope: Scope; scoped: ScopedToken } | null> {
    try {
      const scoped = await keystone.scopedToken(unscopedToken, project.id);
      const endpoint = scoped.ironicEndpoints[region];
      if (!endpoint) return null;
      const result = await ironic.request({ token: scoped.token, endpoint }, `/v1/nodes/${encodeURIComponent(uuid)}`, {
        query: { fields: 'uuid' },
      });
      if (result.status !== 200) return null;
      return {
        scoped,
        scope: {
          domainId: scoped.domainId,
          domainName: scoped.domainName,
          projectId: scoped.projectId,
          projectName: scoped.projectName,
        },
      };
    } catch {
      // A project we cannot scope to or that rejects the read simply is not the one.
      return null;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const hit = found as { scope: Scope; scoped: ScopedToken } | null;
  return { scope: hit?.scope ?? null, scoped: hit?.scoped ?? null, projectsSearched: searched };
}

function orderCandidates(projects: Project[], preferred: Array<string | undefined>): Project[] {
  const priority = new Map<string, number>();
  preferred.forEach((id, index) => {
    if (id && !priority.has(id)) priority.set(id, index - preferred.length);
  });

  return [...projects].sort((a, b) => (priority.get(a.id) ?? 0) - (priority.get(b.id) ?? 0));
}
