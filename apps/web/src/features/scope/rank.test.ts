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
import { describe, expect, it } from 'vitest';
import { rankProjects } from './rank.ts';

function project(name: string, id = name.padEnd(32, '0'), description = ''): Project {
  return { id, name, domain_id: 'default', description } as Project;
}

const projects = [
  project('platform-prod'),
  project('platform-prod-canary'),
  project('gpu-pool-prod'),
  project('ceph-north1', 'ffff1111ffff1111ffff1111ffff1111'),
  project('storage-hci', 'aaaa2222aaaa2222aaaa2222aaaa2222', 'platform spare capacity'),
];

describe('rankProjects', () => {
  it('sorts alphabetically when there is no query', () => {
    const names = rankProjects(projects, '', 10).map((entry) => entry.project.name);
    expect(names[0]).toBe('ceph-north1');
  });

  it('puts an exact name match first, then prefixes, then description matches', () => {
    const names = rankProjects(projects, 'platform', 10).map((entry) => entry.project.name);
    expect(names[0]).toBe('platform-prod');
    expect(names[1]).toBe('platform-prod-canary');
    // Matched only through its description, so it ranks last.
    expect(names.at(-1)).toBe('storage-hci');
  });

  it('does not match a project whose description mentions only part of the query', () => {
    const names = rankProjects(projects, 'platform-prod', 10).map((entry) => entry.project.name);
    expect(names).not.toContain('storage-hci');
  });

  it('prefers the shorter prefix match when neither is exact', () => {
    const names = rankProjects(projects, 'platform-', 10).map((entry) => entry.project.name);
    expect(names[0]).toBe('platform-prod');
  });

  it('finds a project by an id pasted from a ticket', () => {
    const result = rankProjects(projects, 'ffff1111ffff1111ffff1111ffff1111', 10);
    expect(result.map((entry) => entry.project.name)).toEqual(['ceph-north1']);
  });

  it('is case insensitive and trims the query', () => {
    for (const query of ['GPU-POOL', '  gpu-pool  ', 'Gpu-Pool']) {
      expect(rankProjects(projects, query, 10).map((entry) => entry.project.name)).toEqual([
        'gpu-pool-prod',
      ]);
    }
  });

  it('caps the result count so the list stays renderable', () => {
    const many = Array.from({ length: 500 }, (_, index) => project(`proj-${index}`));
    expect(rankProjects(many, 'proj', 200)).toHaveLength(200);
    expect(rankProjects(many, '', 200)).toHaveLength(200);
  });

  it('returns nothing when nothing matches', () => {
    expect(rankProjects(projects, 'nonexistent', 10)).toEqual([]);
  });
});
