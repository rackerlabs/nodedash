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
import { Cpu, HardDrive, MemoryStick, Network, ScanSearch } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/data-table';
import { JsonViewer } from '@/components/json-viewer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, Field, Skeleton } from '@/components/ui/misc';
import { isNotFound } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { formatBytes } from '@/lib/format';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

type Disk = NonNullable<NonNullable<ReturnType<typeof useInventory>['data']>['inventory']['disks']>[number];
type Interface = NonNullable<
  NonNullable<ReturnType<typeof useInventory>['data']>['inventory']['interfaces']
>[number];

function useInventory(uuid: string) {
  return useQuery({
    queryKey: qk.inventory(uuid),
    queryFn: () => api.inventory(uuid),
    staleTime: 5 * 60_000,
  });
}

export function NodeInventoryPage() {
  const { node } = useNodeContext();
  const query = useInventory(node.uuid);

  if (query.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    if (isNotFound(query.error)) {
      return (
        <Empty
          icon={<ScanSearch />}
          title="No inventory stored for this node"
          description="Ironic only has hardware inventory after an inspection has run. Once the node has been inspected the data appears here."
        />
      );
    }
    return <ErrorPanel title="Could not load inventory" error={query.error} onRetry={() => void query.refetch()} />;
  }

  const inventory = query.data.inventory;
  const disks = inventory.disks ?? [];
  const interfaces = inventory.interfaces ?? [];

  const diskColumns: Array<DataColumn<Disk>> = [
    {
      id: 'name',
      header: 'Device',
      width: 'minmax(10rem, 1fr)',
      value: (disk) => disk.name ?? '',
      render: (disk) => <span className="font-mono text-[12px]">{disk.name ?? '—'}</span>,
    },
    {
      id: 'model',
      header: 'Model',
      width: 'minmax(12rem, 1.2fr)',
      value: (disk) => disk.model ?? '',
      render: (disk) => disk.model ?? '—',
    },
    {
      id: 'size',
      header: 'Size',
      width: '8rem',
      value: (disk) => disk.size ?? 0,
      render: (disk) => <span className="tabular">{formatBytes(disk.size)}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      width: '6rem',
      value: (disk) => (disk.rotational ? 'HDD' : 'SSD'),
      render: (disk) => (
        <Badge tone={disk.rotational ? 'neutral' : 'available'}>{disk.rotational ? 'HDD' : 'SSD'}</Badge>
      ),
    },
    {
      id: 'serial',
      header: 'Serial',
      width: 'minmax(10rem, 1fr)',
      value: (disk) => disk.serial ?? '',
      render: (disk) => <span className="font-mono text-[12px]">{disk.serial ?? '—'}</span>,
    },
  ];

  const interfaceColumns: Array<DataColumn<Interface>> = [
    {
      id: 'name',
      header: 'Interface',
      width: '9rem',
      value: (nic) => nic.name ?? '',
      render: (nic) => <span className="font-mono text-[12px]">{nic.name ?? '—'}</span>,
    },
    {
      id: 'mac',
      header: 'MAC',
      width: '12rem',
      value: (nic) => nic.mac_address ?? '',
      render: (nic) => <span className="font-mono text-[12px]">{nic.mac_address ?? '—'}</span>,
    },
    {
      id: 'ipv4',
      header: 'IPv4',
      width: '11rem',
      value: (nic) => nic.ipv4_address ?? '',
      render: (nic) => <span className="font-mono text-[12px]">{nic.ipv4_address ?? '—'}</span>,
    },
    {
      id: 'speed',
      header: 'Speed',
      width: '8rem',
      value: (nic) => nic.speed_mbps ?? 0,
      render: (nic) => (
        <span className="tabular">{nic.speed_mbps ? `${(nic.speed_mbps / 1000).toFixed(0)} Gb/s` : '—'}</span>
      ),
    },
    {
      id: 'link',
      header: 'Link',
      width: '7rem',
      value: (nic) => (nic.has_carrier ? 'up' : 'down'),
      render: (nic) => (
        <Badge tone={nic.has_carrier ? 'active' : 'neutral'}>{nic.has_carrier ? 'up' : 'down'}</Badge>
      ),
    },
    {
      id: 'pxe',
      header: 'PXE',
      width: '6rem',
      value: (nic) => (nic.pxe_enabled ? 'yes' : 'no'),
      render: (nic) =>
        nic.pxe_enabled ? <Badge tone="available">pxe</Badge> : <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              CPU
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Field label="Model">{inventory.cpu?.model_name ?? '—'}</Field>
              <Field label="Logical cores" mono>
                {inventory.cpu?.count ?? '—'}
              </Field>
              <Field label="Architecture" mono>
                {inventory.cpu?.architecture ?? '—'}
              </Field>
              <Field label="Frequency" mono>
                {inventory.cpu?.frequency ? `${inventory.cpu.frequency} MHz` : '—'}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MemoryStick className="size-4 text-primary" />
              Memory
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Field label="Total" mono>
                {formatBytes(inventory.memory?.total)}
              </Field>
              <Field label="Physical" mono>
                {inventory.memory?.physical_mb ? `${inventory.memory.physical_mb} MiB` : '—'}
              </Field>
              <Field label="Boot mode" mono>
                {inventory.boot?.current_boot_mode ?? '—'}
              </Field>
              <Field label="PXE interface" mono>
                {inventory.boot?.pxe_interface ?? '—'}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Field label="Product">{inventory.system_vendor?.product_name ?? '—'}</Field>
              <Field label="Manufacturer">{inventory.system_vendor?.manufacturer ?? '—'}</Field>
              <Field label="Serial number" mono>
                {inventory.system_vendor?.serial_number ?? '—'}
              </Field>
              <Field label="BIOS firmware" mono>
                {inventory.system_vendor?.firmware?.version ?? '—'}
              </Field>
            </dl>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <HardDrive className="size-4 text-muted-foreground" />
          Disks
        </h2>
        <DataTable
          rows={disks}
          columns={diskColumns}
          getRowId={(disk, index) => disk.name ?? String(index)}
          ariaLabel="Disks"
          searchPlaceholder="Filter disks…"
          initialSort={{ columnId: 'name' }}
          emptyTitle="No disks reported"
        />
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Network className="size-4 text-muted-foreground" />
          Network interfaces
        </h2>
        <DataTable
          rows={interfaces}
          columns={interfaceColumns}
          getRowId={(nic, index) => nic.mac_address ?? String(index)}
          ariaLabel="Network interfaces"
          searchPlaceholder="Filter interfaces…"
          initialSort={{ columnId: 'name' }}
          emptyTitle="No interfaces reported"
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Raw introspection data</h2>
        <JsonViewer value={query.data} filterPlaceholder="Filter raw inventory…" />
      </section>
    </div>
  );
}
