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
import { useRegionPaths } from '@/lib/paths';

const helper = createColumnHelper<NodeRow>();

/**
 * Grid sizing for each column. `min` is in rem and is what the table's overall
 * minimum width is summed from, so the header and every row resolve their `fr`
 * tracks against the same width. `grow` is the share of any spare room; leave it
 * out for a fixed-width column.
 */
export interface ColumnMeta {
  min: number;
  grow?: number;
}

export function columnTrack({ min, grow }: ColumnMeta): string {
  return grow ? `minmax(${min}rem, ${grow}fr)` : `${min}rem`;
}

function NodeNameLink({ uuid, name }: { uuid: string; name: string | null }) {
  const paths = useRegionPaths();
  return (
    <Link
      to={paths.node(uuid)}
      onClick={(event) => event.stopPropagation()}
      className="truncate font-medium hover:underline"
    >
      {name ?? <span className="text-muted-foreground italic">unnamed</span>}
    </Link>
  );
}

function dash(value: string | null) {
  return value ? null : <span className="text-muted-foreground">—</span>;
}

export const nodeColumns = [
  helper.accessor('name', {
    header: 'Name',
    meta: { min: 9.5, grow: 1 } satisfies ColumnMeta,
    // A real link, so a node can be middle-clicked or opened in a new tab.
    cell: (context) => <NodeNameLink uuid={context.row.original.uuid} name={context.getValue()} />,
  }),
  helper.accessor('uuid', {
    header: 'UUID',
    meta: { min: 14.5, grow: 1 } satisfies ColumnMeta,
    cell: (context) => <CopyValue value={context.getValue()} label="Copy node UUID" />,
  }),
  helper.accessor('resourceClass', {
    header: 'Resource class',
    meta: { min: 10, grow: 0.8 } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <span className="truncate">{value}</span> : dash(value);
    },
  }),
  helper.accessor('provisionState', {
    header: 'Provision state',
    meta: { min: 10.5, grow: 0.8 } satisfies ColumnMeta,
    cell: (context) => (
      <ProvisionStateBadge state={context.getValue()} target={context.row.original.targetProvisionState} />
    ),
  }),
  helper.accessor('powerState', {
    header: 'Power',
    meta: { min: 6 } satisfies ColumnMeta,
    cell: (context) => (
      <PowerStateBadge state={context.getValue()} target={context.row.original.targetPowerState} />
    ),
  }),
  helper.accessor('lessee', {
    header: 'Lessee',
    meta: { min: 14.5, grow: 1 } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <CopyValue value={value} label="Copy lessee UUID" /> : dash(value);
    },
  }),
  helper.accessor('maintenance', {
    header: 'Maintenance',
    meta: { min: 12, grow: 1.4 } satisfies ColumnMeta,
    // Sort so nodes needing attention come first on the initial click.
    sortingFn: (a, b) => Number(b.original.maintenance) - Number(a.original.maintenance),
    cell: (context) => (
      <MaintenanceBadge
        maintenance={context.getValue()}
        reason={context.row.original.maintenanceReason}
        showReason
      />
    ),
  }),
  helper.accessor('instanceUuid', {
    header: 'Instance UUID',
    meta: { min: 14.5, grow: 1 } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <CopyValue value={value} label="Copy instance UUID" /> : dash(value);
    },
  }),
  helper.accessor('instanceName', {
    header: 'Instance name',
    meta: { min: 9, grow: 0.9 } satisfies ColumnMeta,
    cell: (context) => {
      const value = context.getValue();
      return value ? <span className="truncate">{value}</span> : dash(value);
    },
  }),
];

/** Every field a CSV export carries. The reason has no column of its own: the table shows it in Maintenance. */
export const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  uuid: 'UUID',
  resourceClass: 'Resource class',
  provisionState: 'Provision state',
  powerState: 'Power',
  lessee: 'Lessee',
  maintenance: 'Maintenance',
  maintenanceReason: 'Maintenance reason',
  instanceUuid: 'Instance UUID',
  instanceName: 'Instance name',
};

/** The columns the table can show or hide. */
export const TABLE_COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(DEFAULT_COLUMN_LABELS).filter(([id]) => id !== 'maintenanceReason'),
);
