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

import { createColumnHelper } from '@tanstack/react-table';
import type { NodeRow } from '@nodedash/shared';
import { Link } from 'react-router';
import { CopyValue } from '@/components/copy-value';
import { MaintenanceBadge, PowerStateBadge, ProvisionStateBadge } from '@/components/node-badges';

const helper = createColumnHelper<NodeRow>();

/** Grid width for each column, in the order the columns are declared. */
export interface ColumnMeta {
  width: string;
  align?: 'left' | 'right';
}

function dash(value: string | null) {
  return value ? null : <span className="text-muted-foreground">—</span>;
}

export const nodeColumns = [
  helper.accessor('name', {
    header: 'Name',
    meta: { width: 'minmax(9.5rem, 1fr)' } satisfies ColumnMeta,
    // A real link, so a node can be middle-clicked or opened in a new tab.
    cell: (context) => (
      <Link
        to={`/nodes/${context.row.original.uuid}`}
        onClick={(event) => event.stopPropagation()}
        className="truncate font-medium hover:underline"
      >
        {context.getValue() ?? <span className="text-muted-foreground italic">unnamed</span>}
      </Link>
    ),
  }),
  helper.accessor('uuid', {
    header: 'UUID',
    meta: { width: 'minmax(14.5rem, 1fr)' } satisfies ColumnMeta,
    cell: (context) => <CopyValue value={context.getValue()} label="Copy node UUID" />,
  }),
  helper.accessor('provisionState', {
    header: 'Provision state',
    meta: { width: 'minmax(10.5rem, 0.8fr)' } satisfies ColumnMeta,
    cell: (context) => (
      <ProvisionStateBadge state={context.getValue()} target={context.row.original.targetProvisionState} />
    ),
  }),
  helper.accessor('powerState', {
    header: 'Power',
    meta: { width: '6rem' } satisfies ColumnMeta,
    cell: (context) => (
      <PowerStateBadge state={context.getValue()} target={context.row.original.targetPowerState} />
    ),
  }),
  helper.accessor('instanceUuid', {
    header: 'Instance UUID',
    meta: { width: 'minmax(14.5rem, 1fr)' } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <CopyValue value={value} label="Copy instance UUID" /> : dash(value);
    },
  }),
  helper.accessor('instanceName', {
    header: 'Instance name',
    meta: { width: 'minmax(9rem, 0.9fr)' } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <span className="truncate">{value}</span> : dash(value);
    },
  }),
  helper.accessor('maintenance', {
    header: 'Maintenance',
    meta: { width: '8rem' } satisfies ColumnMeta,
    // Sort so nodes needing attention come first on the initial click.
    sortingFn: (a, b) => Number(b.original.maintenance) - Number(a.original.maintenance),
    cell: (context) => (
      <MaintenanceBadge maintenance={context.getValue()} reason={context.row.original.maintenanceReason} />
    ),
  }),
  helper.accessor('maintenanceReason', {
    header: 'Maintenance reason',
    meta: { width: 'minmax(12rem, 1.4fr)' } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? (
        <span className="truncate text-muted-foreground" title={value}>
          {value}
        </span>
      ) : (
        dash(value)
      );
    },
  }),
];

export const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  uuid: 'UUID',
  provisionState: 'Provision state',
  powerState: 'Power',
  instanceUuid: 'Instance UUID',
  instanceName: 'Instance name',
  maintenance: 'Maintenance',
  maintenanceReason: 'Maintenance reason',
};
