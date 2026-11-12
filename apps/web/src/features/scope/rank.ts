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

export interface RankedProject {
  project: Project;
  score: number;
}

/**
 * Ranks projects for the picker. Exact and prefix matches on the name come first
 * because operators usually know roughly what the project is called; id matches
 * are kept so a project id pasted from a ticket resolves.
 */
export function rankProjects(projects: readonly Project[], query: string, limit: number): RankedProject[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return projects
      .slice(0, limit)
      .map((project) => ({ project, score: 0 }))
      .sort((a, b) => a.project.name.localeCompare(b.project.name));
  }

  const ranked: RankedProject[] = [];
  for (const project of projects) {
    const name = project.name.toLowerCase();
    let score = -1;
    if (name === needle) score = 100;
    else if (name.startsWith(needle)) score = 80 - Math.min(20, name.length - needle.length);
    else if (name.includes(needle)) score = 55;
    else if (project.id.toLowerCase().includes(needle)) score = 40;
    else if ((project.description ?? '').toLowerCase().includes(needle)) score = 20;
    if (score >= 0) ranked.push({ project, score });
  }

  ranked.sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  return ranked.slice(0, limit);
}
