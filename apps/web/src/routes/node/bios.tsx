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
import type { BiosSetting } from '@nodedash/shared';
import { Lock, Settings2 } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Empty, Skeleton } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

const columns: Array<DataColumn<BiosSetting>> = [
  {
    id: 'name',
    header: 'Setting',
    width: 'minmax(14rem, 1fr)',
    value: (setting) => setting.name,
    render: (setting) => (
      <span className="flex items-center gap-1.5 font-mono text-[12px]">
        {setting.name}
        {setting.read_only ? (
          <Hint label="Read-only on this platform">
            <Lock className="size-3 text-muted-foreground" />
          </Hint>
        ) : null}
      </span>
    ),
  },
  {
    id: 'value',
    header: 'Value',
    width: 'minmax(12rem, 1fr)',
    value: (setting) => String(setting.value ?? ''),
    render: (setting) => (
      <span className="font-mono text-[12px] break-all">{String(setting.value ?? '—')}</span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    width: '9rem',
    value: (setting) => setting.attribute_type ?? '',
    render: (setting) =>
      setting.attribute_type ? (
        <Badge tone="outline">{setting.attribute_type}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'reset',
    header: 'Reset required',
    width: '9rem',
    value: (setting) => (setting.reset_required ? 'yes' : 'no'),
    render: (setting) =>
      setting.reset_required ? (
        <Badge tone="transient">reboot</Badge>
      ) : (
        <span className="text-muted-foreground">no</span>
      ),
  },
  {
    id: 'allowable',
    header: 'Allowed values',
    width: 'minmax(12rem, 1.2fr)',
    value: (setting) => (setting.allowable_values ?? []).join(', '),
    render: (setting) =>
      setting.allowable_values && setting.allowable_values.length > 0 ? (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {setting.allowable_values.join(', ')}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function NodeBiosPage() {
  const { node } = useNodeContext();
  const query = useQuery({
    queryKey: qk.bios(node.uuid),
    queryFn: () => api.bios(node.uuid),
    staleTime: 60_000,
  });

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) {
    return <ErrorPanel title="Could not load BIOS settings" error={query.error} onRetry={() => void query.refetch()} />;
  }

  const settings = query.data.bios;

  if (settings.length === 0) {
    return (
      <Empty
        icon={<Settings2 />}
        title="No BIOS settings cached"
        description="Ironic caches BIOS settings when the node is inspected or after a BIOS clean step runs. Nothing is stored for this node yet."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Settings as last read by Ironic. This view is read-only — BIOS changes are applied through a
        runbook or clean step so they are recorded and repeatable.
      </p>
      <DataTable
        rows={settings}
        columns={columns}
        getRowId={(setting) => setting.name}
        ariaLabel="BIOS settings"
        searchPlaceholder="Search settings and values…"
        initialSort={{ columnId: 'name' }}
      />
    </div>
  );
}
