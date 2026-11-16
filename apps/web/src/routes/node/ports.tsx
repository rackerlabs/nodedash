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

import { useQuery } from '@tanstack/react-query';
import { toPortRow, type PortRow } from '@nodedash/shared';
import { CopyValue } from '@/components/copy-value';
import { DataTable, type DataColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';
import { useRegion } from '@/lib/paths';

const dash = <span className="text-muted-foreground">—</span>;

// Identity first (MAC, then NIC), then where the cable goes; physical network and
// category are for troubleshooting, so they sit at the end.
const columns: Array<DataColumn<PortRow>> = [
  {
    id: 'address',
    header: 'MAC',
    width: '12rem',
    value: (port) => port.address,
    render: (port) => (
      <CopyValue value={port.address} label="Copy MAC address" className="font-mono text-[12px]" />
    ),
  },
  {
    id: 'name',
    header: 'NIC',
    width: 'minmax(12rem, 1.2fr)',
    value: (port) => port.name ?? '',
    render: (port) =>
      port.name ? <span className="truncate font-mono text-[12px]">{port.name}</span> : dash,
  },
  {
    id: 'switch',
    header: 'Switch',
    width: 'minmax(18rem, 1.4fr)',
    value: (port) => port.switchName ?? port.switchId ?? '',
    render: (port) => {
      const name = port.switchName ?? port.switchId;
      return name ? (
        <span className="truncate font-mono text-[12px]" title={port.switchId ?? undefined}>
          {name}
        </span>
      ) : (
        dash
      );
    },
  },
  {
    id: 'switchPort',
    header: 'Switch port',
    width: '9rem',
    value: (port) => port.switchPort ?? '',
    render: (port) =>
      port.switchPort ? <span className="font-mono text-[12px]">{port.switchPort}</span> : dash,
  },
  {
    id: 'vif',
    header: 'Attached VIF',
    width: 'minmax(26rem, 1.6fr)',
    value: (port) => port.vif?.id ?? '',
    render: (port) =>
      port.vif ? (
        <span className="flex items-center gap-2">
          <Badge tone="available">{port.vif.purpose}</Badge>
          <CopyValue value={port.vif.id} label="Copy VIF id" className="font-mono text-[12px]" />
        </span>
      ) : (
        dash
      ),
  },
  {
    id: 'portgroup',
    header: 'Portgroup',
    width: 'minmax(19rem, 1fr)',
    value: (port) => port.portgroupUuid ?? '',
    render: (port) =>
      port.portgroupUuid ? (
        <CopyValue value={port.portgroupUuid} label="Copy portgroup UUID" className="font-mono text-[12px]" />
      ) : (
        dash
      ),
  },
  {
    id: 'physicalNetwork',
    header: 'Physical network',
    width: 'minmax(12rem, 1fr)',
    value: (port) => port.physicalNetwork ?? '',
    render: (port) =>
      port.physicalNetwork ? (
        <span className="truncate text-muted-foreground">{port.physicalNetwork}</span>
      ) : (
        dash
      ),
  },
  {
    id: 'category',
    header: 'Category',
    width: '8rem',
    value: (port) => port.category ?? '',
    render: (port) => (port.category ? <span className="text-muted-foreground">{port.category}</span> : dash),
  },
];

export function NodePortsPage() {
  const region = useRegion();
  const { node } = useNodeContext();
  const query = useQuery({
    queryKey: qk.ports(region, node.uuid),
    queryFn: () => api.ports(region, node.uuid),
    staleTime: 60_000,
    select: (data) => data.ports.map(toPortRow),
  });

  if (query.isPending) return <Skeleton className="h-56 w-full" />;

  if (query.isError) {
    return (
      <ErrorPanel title="Could not load ports" error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Each NIC Ironic knows about, the switch port it is cabled to, and the Neutron VIF attached to it.
      </p>
      <DataTable
        rows={query.data}
        columns={columns}
        getRowId={(port) => port.uuid}
        ariaLabel="Ports"
        searchPlaceholder="Search switches, ports and MAC addresses…"
        initialSort={{ columnId: 'switch' }}
        emptyTitle="No ports"
        emptyDescription="Ironic has no ports registered for this node."
      />
    </div>
  );
}
