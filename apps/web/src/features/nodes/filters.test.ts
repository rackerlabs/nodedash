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
import { describe, expect, it } from 'vitest';
import {
  applyNodeFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  provisionStateCounts,
} from './filters.ts';

function row(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    uuid: 'aaaaaaaa-0000-4000-a000-000000000001',
    name: 'r01u01-north1',
    provisionState: 'active',
    targetProvisionState: null,
    powerState: 'power on',
    targetPowerState: null,
    instanceUuid: null,
    instanceName: null,
    maintenance: false,
    maintenanceReason: null,
    lastError: null,
    updatedAt: null,
    ...overrides,
  };
}

const fleet: NodeRow[] = [
  row({ name: 'r01u01-north1', uuid: 'aaaa1111-0000-4000-a000-000000000001' }),
  row({
    name: 'r02u09-east2',
    uuid: 'bbbb2222-0000-4000-a000-000000000002',
    provisionState: 'deploy failed',
    maintenance: true,
    maintenanceReason: 'Failed disk in slot 3',
  }),
  row({
    name: 'r03u14-west3',
    uuid: 'cccc3333-0000-4000-a000-000000000003',
    provisionState: 'available',
    instanceUuid: 'dddd4444-0000-4000-a000-000000000004',
    instanceName: 'web-west3-0001',
  }),
];

describe('applyNodeFilters', () => {
  it('returns everything with no filters applied', () => {
    expect(applyNodeFilters(fleet, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('searches across node name, uuid, instance and maintenance reason', () => {
    const cases: Array<[string, string]> = [
      ['east2', 'r02u09-east2'],
      ['cccc3333', 'r03u14-west3'],
      ['web-west3', 'r03u14-west3'],
      ['dddd4444', 'r03u14-west3'],
      ['slot 3', 'r02u09-east2'],
    ];
    for (const [needle, expected] of cases) {
      const result = applyNodeFilters(fleet, { ...EMPTY_FILTERS, search: needle });
      expect(result.map((entry) => entry.name)).toEqual([expected]);
    }
  });

  it('ignores case and surrounding whitespace in the search box', () => {
    expect(applyNodeFilters(fleet, { ...EMPTY_FILTERS, search: '  EAST2 ' })).toHaveLength(1);
  });

  it('filters by provision state, including states containing spaces', () => {
    const result = applyNodeFilters(fleet, { ...EMPTY_FILTERS, provisionStates: ['deploy failed'] });
    expect(result.map((entry) => entry.name)).toEqual(['r02u09-east2']);
  });

  it('treats multiple selected states as a union', () => {
    const result = applyNodeFilters(fleet, {
      ...EMPTY_FILTERS,
      provisionStates: ['active', 'available'],
    });
    expect(result).toHaveLength(2);
  });

  it('narrows to, and excludes, nodes in maintenance', () => {
    expect(applyNodeFilters(fleet, { ...EMPTY_FILTERS, maintenance: 'only' })).toHaveLength(1);
    expect(applyNodeFilters(fleet, { ...EMPTY_FILTERS, maintenance: 'exclude' })).toHaveLength(2);
  });

  it('combines filters conjunctively', () => {
    const result = applyNodeFilters(fleet, {
      search: 'r0',
      provisionStates: ['deploy failed'],
      maintenance: 'exclude',
    });
    expect(result).toHaveLength(0);
  });
});

describe('countActiveFilters', () => {
  it('ignores a search box holding only whitespace', () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, search: '   ' })).toBe(0);
    expect(countActiveFilters({ search: 'x', provisionStates: ['active'], maintenance: 'only' })).toBe(3);
  });
});

describe('provisionStateCounts', () => {
  it('orders by frequency and labels missing states', () => {
    const counts = provisionStateCounts([
      ...fleet,
      row({ provisionState: 'active' }),
      row({ provisionState: null }),
    ]);
    expect(counts[0]).toEqual({ state: 'active', count: 2 });
    expect(counts).toContainEqual({ state: 'unknown', count: 1 });
    expect(counts).toContainEqual({ state: 'deploy failed', count: 1 });
  });
});
