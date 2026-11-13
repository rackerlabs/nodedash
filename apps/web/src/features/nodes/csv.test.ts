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
import { csvFilename, nodesToCsv } from './csv.ts';

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

const columns = { name: 'Name', maintenance: 'Maintenance', maintenanceReason: 'Maintenance reason' };

describe('nodesToCsv', () => {
  it('writes a header row then one line per node, with empty cells for nulls', () => {
    expect(nodesToCsv([row()], columns)).toBe(
      'Name,Maintenance,Maintenance reason\r\nr01u01-north1,false,\r\n',
    );
  });

  it('quotes commas, quotes and newlines', () => {
    const csv = nodesToCsv([row({ maintenance: true, maintenanceReason: 'swap "PSU", then\nretest' })], columns);
    expect(csv).toContain('true,"swap ""PSU"", then\nretest"');
  });

  it('neutralises spreadsheet formulas', () => {
    const csv = nodesToCsv([row({ name: '=HYPERLINK("https://example.invalid")' })], columns);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(nodesToCsv([row({ name: '@cmd' })], columns)).toContain("'@cmd");
  });

  it('writes only the header for no rows', () => {
    expect(nodesToCsv([], columns)).toBe('Name,Maintenance,Maintenance reason\r\n');
  });
});

describe('csvFilename', () => {
  const now = new Date('2026-11-13T12:00:00Z');

  it('includes the region and the date', () => {
    expect(csvFilename('north1', now)).toBe('nodes-north1-2026-11-13.csv');
  });

  it('replaces characters that are unsafe in a filename', () => {
    expect(csvFilename('../East 2/x', now)).toBe('nodes-East_2_x-2026-11-13.csv');
  });

  it('omits the region when there is none', () => {
    expect(csvFilename(null, now)).toBe('nodes-2026-11-13.csv');
  });
});
