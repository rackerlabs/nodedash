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

import type { NodeRow } from '@nodedash/shared';

export type MaintenanceFilter = 'all' | 'only' | 'exclude';

export interface NodeFilters {
  search: string;
  provisionStates: string[];
  maintenance: MaintenanceFilter;
}

export const EMPTY_FILTERS: NodeFilters = {
  search: '',
  provisionStates: [],
  maintenance: 'all',
};

/**
 * Free-text search spans every column an operator is likely to paste in: node
 * name, node uuid, instance uuid, instance name and the maintenance reason.
 */
function matchesSearch(row: NodeRow, needle: string): boolean {
  if (!needle) return true;
  const haystacks = [
    row.name,
    row.uuid,
    row.instanceUuid,
    row.instanceName,
    row.provisionState,
    row.maintenanceReason,
  ];
  return haystacks.some((value) => value?.toLowerCase().includes(needle));
}

export function applyNodeFilters(rows: readonly NodeRow[], filters: NodeFilters): NodeRow[] {
  const needle = filters.search.trim().toLowerCase();
  const states = new Set(filters.provisionStates);
  return rows.filter((row) => {
    if (!matchesSearch(row, needle)) return false;
    if (states.size > 0 && !states.has(row.provisionState ?? '')) return false;
    if (filters.maintenance === 'only' && !row.maintenance) return false;
    if (filters.maintenance === 'exclude' && row.maintenance) return false;
    return true;
  });
}

export function countActiveFilters(filters: NodeFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.provisionStates.length > 0) count += 1;
  if (filters.maintenance !== 'all') count += 1;
  return count;
}

/** Provision states actually present in the fleet, with counts, for the filter menu. */
export function provisionStateCounts(rows: readonly NodeRow[]): Array<{ state: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const state = row.provisionState ?? 'unknown';
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
}
