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

import type { Project } from '@nodedash/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from './config.ts';
import type { IronicClient } from './ironic.ts';
import type { KeystoneClient } from './keystone.ts';
import { locateNode } from './locate.ts';

const NODE_UUID = 'aaaaaaaa-0000-4000-a000-00000000000a';
const OWNING_PROJECT = 'project-07';
const REGION = 'region-a';
/** A project whose catalog has Ironic only in another region. */
const ELSEWHERE_PROJECT = 'project-03';

const projects: Project[] = Array.from({ length: 12 }, (_, index) => ({
  id: `project-${String(index).padStart(2, '0')}`,
  name: `project-${index}`,
  domain_id: 'default',
})) as Project[];

/** Records the order projects were probed in, so ordering can be asserted. */
let probed: string[] = [];

const keystone = {
  scopedToken: async (_unscoped: string, projectId: string) => ({
    token: `token-for-${projectId}`,
    expiresAtMs: Date.now() + 3600_000,
    projectId,
    projectName: projectId,
    domainId: 'default',
    domainName: 'Default',
    ironicEndpoints:
      projectId === ELSEWHERE_PROJECT
        ? { 'region-b': 'https://ironic-b.example.invalid' }
        : { [REGION]: 'https://ironic-a.example.invalid' },
  }),
} as unknown as KeystoneClient;

const ironic = {
  request: async (target: { token: string; endpoint: string }, path: string) => {
    const projectId = target.token.replace('token-for-', '');
    probed.push(projectId);
    // Only the owning project can see the one node that exists.
    const visible = projectId === OWNING_PROJECT && path.includes(NODE_UUID);
    return { status: visible ? 200 : 404, body: null, text: '' };
  },
} as unknown as IronicClient;

// Sequential probing, so the order the candidates were tried in is observable.
const config = { locateConcurrency: 1 } as Config;

function locate(preferProjectIds: Array<string | undefined> = [], uuid = NODE_UUID) {
  return locateNode(uuid, {
    config,
    keystone,
    ironic,
    unscopedToken: 'unscoped',
    region: REGION,
    projects,
    preferProjectIds,
  });
}

beforeEach(() => {
  probed = [];
});

describe('locateNode', () => {
  it('finds the project that owns the node and reports how far it looked', async () => {
    const result = await locate();
    expect(result.scope?.projectId).toBe(OWNING_PROJECT);
    expect(result.scoped?.token).toBe(`token-for-${OWNING_PROJECT}`);
    expect(result.projectsSearched).toBeGreaterThan(1);
  });

  it('reports nothing found when no project owns the node', async () => {
    const result = await locate([], 'ffffffff-0000-4000-a000-00000000000f');
    expect(result.scope).toBeNull();
    expect(result.scoped).toBeNull();
    expect(result.projectsSearched).toBe(projects.length);
  });

  it('tries the caller preferred projects first, in the order given', async () => {
    await locate(['project-02', OWNING_PROJECT]);
    expect(probed.slice(0, 2)).toEqual(['project-02', OWNING_PROJECT]);
    expect(probed).toHaveLength(2);
  });

  it('skips a project with no Ironic in the region instead of asking another region', async () => {
    await locate([ELSEWHERE_PROJECT]);
    expect(probed).not.toContain(ELSEWHERE_PROJECT);
  });

  it('remembers nothing between lookups', async () => {
    await locate();
    const first = [...probed];

    probed = [];
    await locate();
    expect(probed).toEqual(first);
  });
});
