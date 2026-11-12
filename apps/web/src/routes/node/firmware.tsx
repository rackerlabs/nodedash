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
import type { FirmwareComponent } from '@nodedash/shared';
import { CircuitBoard } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Empty, Skeleton } from '@/components/ui/misc';
import { isNotFound } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { formatTimestamp } from '@/lib/format';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

const columns: Array<DataColumn<FirmwareComponent>> = [
  {
    id: 'component',
    header: 'Component',
    width: '10rem',
    value: (item) => item.component,
    render: (item) => <span className="font-mono text-[12px] font-medium">{item.component}</span>,
  },
  {
    id: 'current',
    header: 'Current version',
    width: 'minmax(11rem, 1fr)',
    value: (item) => item.current_version ?? '',
    render: (item) => <span className="font-mono text-[12px] tabular">{item.current_version ?? '—'}</span>,
  },
  {
    id: 'initial',
    header: 'Initial version',
    width: 'minmax(11rem, 1fr)',
    value: (item) => item.initial_version ?? '',
    render: (item) => (
      <span className="font-mono text-[12px] tabular text-muted-foreground">
        {item.initial_version ?? '—'}
      </span>
    ),
  },
  {
    id: 'flashed',
    header: 'Last flashed',
    width: 'minmax(11rem, 1fr)',
    value: (item) => item.last_version_flashed ?? '',
    render: (item) =>
      item.last_version_flashed ? (
        <Badge tone="available" className="font-mono text-[11px]">
          {item.last_version_flashed}
        </Badge>
      ) : (
        <span className="text-muted-foreground">never</span>
      ),
  },
  {
    id: 'vendor',
    header: 'Vendor / model',
    width: 'minmax(11rem, 1fr)',
    value: (item) => `${item.vendor ?? ''} ${item.model ?? ''}`.trim(),
    render: (item) => (
      <span className="truncate text-muted-foreground">
        {[item.vendor, item.model].filter(Boolean).join(' · ') || '—'}
      </span>
    ),
  },
  {
    id: 'updated',
    header: 'Updated',
    width: 'minmax(11rem, 1fr)',
    value: (item) => item.updated_at ?? '',
    render: (item) => <span className="text-muted-foreground">{formatTimestamp(item.updated_at)}</span>,
  },
];

export function NodeFirmwarePage() {
  const { node } = useNodeContext();
  const query = useQuery({
    queryKey: qk.firmware(node.uuid),
    queryFn: () => api.firmware(node.uuid),
    staleTime: 60_000,
  });

  if (query.isPending) return <Skeleton className="h-56 w-full" />;

  if (query.isError) {
    if (isNotFound(query.error)) {
      return (
        <Empty
          icon={<CircuitBoard />}
          title="No firmware information cached"
          description="Ironic records firmware components after inspection or a firmware step. Nothing is stored for this node yet."
        />
      );
    }
    return <ErrorPanel title="Could not load firmware" error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Firmware versions as last reported by the BMC. Updates are applied through a runbook so the change
        is recorded against the node.
      </p>
      <DataTable
        rows={query.data.firmware}
        columns={columns}
        getRowId={(item) => item.component}
        ariaLabel="Firmware components"
        searchPlaceholder="Search components and versions…"
        initialSort={{ columnId: 'component' }}
      />
    </div>
  );
}
