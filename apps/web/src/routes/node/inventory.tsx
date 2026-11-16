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
import {
  isPciBridge,
  lldpByMac,
  lldpMismatch,
  lookupPci,
  normalizePciId,
  pciClassLabel,
  toPortRow,
  type PortLldp,
} from '@nodedash/shared';
import { useMemo } from 'react';
import { CircuitBoard, Cpu, HardDrive, MemoryStick, Network, RefreshCw, ScanSearch } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/data-table';
import { JsonViewer } from '@/components/json-viewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, Field, Skeleton } from '@/components/ui/misc';
import { isNotFound } from '@/lib/api/client';
import { usePciIds } from '@/features/node/use-pci-ids';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';
import { useRegion } from '@/lib/paths';

type Disk = NonNullable<NonNullable<ReturnType<typeof useInventory>['data']>['inventory']['disks']>[number];
type Interface = NonNullable<
  NonNullable<ReturnType<typeof useInventory>['data']>['inventory']['interfaces']
>[number];
/** An interface plus what its switch reported over LLDP, and whether that disagrees with Ironic's port. */
type NicRow = Interface & { lldp: PortLldp | null; lldpMismatch: boolean };

/**
 * Every table row is its own grid sized to its content, so one long name widens that
 * row's columns and shifts it out of line with the others. Not letting the cell
 * contribute its text width to the row keeps every row on the same tracks; the text
 * is cut off with an ellipsis instead (the full name is in the title).
 */
const CLIP = '[contain:inline-size]';

/** A non-bridge PCI device with the names pci.ids gives its ids; unknown ids leave a name null. */
interface PciRow {
  key: string;
  className: string | null;
  vendor: string | null;
  device: string | null;
  subsystem: string | null;
  vendorId: string | null;
  productId: string | null;
  revision: string | null;
}

function useInventory(uuid: string) {
  const region = useRegion();
  return useQuery({
    queryKey: qk.inventory(region, uuid),
    queryFn: () => api.inventory(region, uuid),
    staleTime: 5 * 60_000,
  });
}

export function NodeInventoryPage() {
  const { node } = useNodeContext();
  const region = useRegion();
  const query = useInventory(node.uuid);
  // Only for comparison: the configured switch and port live on the Ironic port, matched by MAC.
  // Nodes without ports, or an Ironic that refuses, simply get no highlight.
  const ports = useQuery({
    queryKey: qk.ports(region, node.uuid),
    queryFn: () => api.ports(region, node.uuid),
    staleTime: 60_000,
    retry: false,
  });
  const pciIds = usePciIds();
  const pciDevices = query.data?.inventory.pci_devices;
  const { pciRows, bridgeCount } = useMemo(() => {
    const devices = pciDevices ?? [];
    const rows: PciRow[] = devices
      .filter((device) => !isPciBridge(device))
      .map((device, index) => {
        const names = pciIds.data
          ? lookupPci(pciIds.data, device)
          : { vendor: null, device: null, subsystem: null };
        return {
          key: String(index),
          className: pciClassLabel(device.class),
          ...names,
          vendorId: normalizePciId(device.vendor_id),
          productId: normalizePciId(device.product_id),
          revision: device.revision ?? null,
        };
      });
    return { pciRows: rows, bridgeCount: devices.length - rows.length };
  }, [pciDevices, pciIds.data]);
  const nics = useMemo<NicRow[]>(() => {
    const lldp = lldpByMac(query.data);
    const configured = new Map(
      (ports.data?.ports ?? []).map((port) => [port.address.toLowerCase(), toPortRow(port)]),
    );
    return (query.data?.inventory.interfaces ?? []).map((nic) => {
      const mac = nic.mac_address?.toLowerCase() ?? '';
      const seen = lldp.get(mac) ?? null;
      const port = configured.get(mac);
      return { ...nic, lldp: seen, lldpMismatch: port ? lldpMismatch(port, seen) : false };
    });
  }, [query.data, ports.data]);

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
  // Not every inspection reports a byte total; the physical figure is the same memory in MiB.
  const totalBytes =
    inventory.memory?.total ??
    (inventory.memory?.physical_mb ? inventory.memory.physical_mb * 1024 * 1024 : null);
  const totalGib = totalBytes === null ? null : totalBytes / 1024 ** 3;

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

  const interfaceColumns: Array<DataColumn<NicRow>> = [
    {
      id: 'name',
      header: 'Interface',
      width: '15rem',
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
      id: 'lldpSwitch',
      header: 'LLDP switch',
      width: 'minmax(18rem, 1.2fr)',
      value: (nic) => nic.lldp?.switchName ?? nic.lldp?.chassisId ?? '',
      render: (nic) => {
        const name = nic.lldp?.switchName ?? nic.lldp?.chassisId;
        return name ? (
          <span
            className={cn('truncate font-mono text-[12px]', nic.lldpMismatch && 'text-warning')}
            title={nic.lldp?.chassisId ?? undefined}
          >
            {name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: 'lldpPort',
      header: 'LLDP port',
      width: '10rem',
      value: (nic) => nic.lldp?.switchPort ?? '',
      render: (nic) =>
        nic.lldp?.switchPort ? (
          <span
            className={cn('font-mono text-[12px]', nic.lldpMismatch && 'text-warning')}
            title={
              nic.lldpMismatch ? 'Differs from the switch and port Ironic is configured with' : undefined
            }
          >
            {nic.lldp.switchPort}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
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
      id: 'pxe',
      header: 'PXE',
      width: '6rem',
      value: (nic) => (nic.pxe_enabled ? 'yes' : 'no'),
      render: (nic) =>
        nic.pxe_enabled ? <Badge tone="available">pxe</Badge> : <span className="text-muted-foreground">—</span>,
    },
  ];

  const pciColumns: Array<DataColumn<PciRow>> = [
    {
      id: 'class',
      header: 'Class',
      width: 'minmax(11rem, 1fr)',
      className: CLIP,
      value: (row) => row.className ?? '',
      render: (row) => <span className="block truncate">{row.className ?? '—'}</span>,
    },
    {
      id: 'vendor',
      header: 'Vendor',
      width: 'minmax(16rem, 1fr)',
      className: CLIP,
      value: (row) => row.vendor ?? row.vendorId ?? '',
      render: (row) =>
        row.vendor ? (
          <span className="block truncate" title={row.vendor}>
            {row.vendor}
          </span>
        ) : (
          <span className="font-mono text-[12px] text-muted-foreground">{row.vendorId ?? '—'}</span>
        ),
    },
    {
      id: 'device',
      header: 'Device',
      width: 'minmax(26rem, 2fr)',
      className: CLIP,
      value: (row) => row.device ?? row.productId ?? '',
      render: (row) =>
        row.device ? (
          <span className="block truncate" title={row.device}>
            {row.device}
          </span>
        ) : (
          <span className="font-mono text-[12px] text-muted-foreground">{row.productId ?? '—'}</span>
        ),
    },
    {
      id: 'subsystem',
      header: 'Subsystem',
      width: 'minmax(18rem, 1.5fr)',
      className: CLIP,
      value: (row) => row.subsystem ?? '',
      render: (row) =>
        row.subsystem ? (
          <span className="block truncate text-muted-foreground" title={row.subsystem}>
            {row.subsystem}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'ids',
      header: 'ID',
      width: '9rem',
      value: (row) => `${row.vendorId ?? ''}:${row.productId ?? ''}`,
      render: (row) => (
        <span className="font-mono text-[12px]">
          {row.vendorId ?? '????'}:{row.productId ?? '????'}
        </span>
      ),
    },
    {
      id: 'revision',
      header: 'Rev',
      width: '6rem',
      value: (row) => row.revision ?? '',
      render: (row) => <span className="font-mono text-[12px]">{row.revision ?? '—'}</span>,
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
                {totalGib === null ? '—' : `${Number(totalGib.toFixed(1))} GiB`}
              </Field>
              <Field label="Physical" mono>
                {inventory.memory?.physical_mb ? `${inventory.memory.physical_mb} MiB` : '—'}
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
          rows={nics}
          columns={interfaceColumns}
          getRowId={(nic, index) => nic.mac_address ?? String(index)}
          ariaLabel="Network interfaces"
          searchPlaceholder="Filter interfaces…"
          initialSort={{ columnId: 'name' }}
          emptyTitle="No interfaces reported"
        />
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CircuitBoard className="size-4 text-muted-foreground" />
          PCI devices
          {bridgeCount > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {bridgeCount} {bridgeCount === 1 ? 'bridge' : 'bridges'} hidden
            </span>
          ) : null}
        </h2>
        <DataTable
          rows={pciRows}
          columns={pciColumns}
          getRowId={(row) => row.key}
          ariaLabel="PCI devices"
          searchPlaceholder="Filter PCI devices…"
          initialSort={{ columnId: 'class' }}
          emptyTitle="No PCI devices reported"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Raw introspection data</h2>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
        <JsonViewer value={query.data} filterPlaceholder="Filter raw inventory…" />
      </section>
    </div>
  );
}
