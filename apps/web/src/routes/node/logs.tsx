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
import { historySeverityTone, type NodeLogArchive } from '@nodedash/shared';
import { FileText, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/search-input';
import { SegmentedFilter } from '@/components/segmented-filter';
import { FilterableText } from '@/components/filterable-text';
import { Badge } from '@/components/ui/badge';
import { Empty, Label, Skeleton } from '@/components/ui/misc';
import { useCapabilities } from '@/features/auth/session';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { formatBytes, formatTimestamp, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

/**
 * Two separate records, deliberately on one page: what Ironic did to this node, and
 * what the ramdisk said while it was doing it. Debugging a failed deploy needs both,
 * and making an operator hop tabs between them is how detail gets missed.
 */
export function NodeLogsPage() {
  const { row } = useNodeContext();
  const [view, setView] = useState<'history' | 'ramdisk'>('history');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card/50 p-1">
        <ViewTab active={view === 'history'} onClick={() => setView('history')}>
          <ScrollText className="size-4" />
          Ironic history
        </ViewTab>
        <ViewTab active={view === 'ramdisk'} onClick={() => setView('ramdisk')}>
          <FileText className="size-4" />
          IPA logs
        </ViewTab>
      </div>

      {view === 'history' ? <HistoryView uuid={row.uuid} /> : <RamdiskView uuid={row.uuid} />}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

const SEVERITY_FILTERS = ['All', 'ERROR', 'WARNING', 'INFO'] as const;

function HistoryView({ uuid }: { uuid: string }) {
  const capabilities = useCapabilities();
  const supported = capabilities.data?.capabilities.nodeHistory ?? true;
  const now = useNow(30_000);
  const [severity, setSeverity] = useState<(typeof SEVERITY_FILTERS)[number]>('All');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: qk.history(uuid),
    queryFn: () => api.history(uuid),
    enabled: supported,
    staleTime: 30_000,
  });

  const events = useMemo(() => {
    const all = query.data?.history ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((event) => {
      if (severity !== 'All' && (event.severity ?? '').toUpperCase() !== severity) return false;
      if (!needle) return true;
      return (
        event.event.toLowerCase().includes(needle) ||
        (event.event_type ?? '').toLowerCase().includes(needle) ||
        (event.conductor ?? '').toLowerCase().includes(needle)
      );
    });
  }, [query.data, severity, search]);

  if (!supported) {
    return (
      <Empty
        icon={<ScrollText />}
        title="Node history needs a newer Ironic"
        description={`History arrived in API 1.78; this deployment negotiated ${
          capabilities.data?.negotiatedVersion ?? 'an older version'
        }.`}
      />
    );
  }
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <ErrorPanel
        title="Could not load node history"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="history-search">Search events</Label>
          <SearchInput
            id="history-search"
            value={search}
            onChange={setSearch}
            placeholder="message, event type or conductor"
          />
        </div>
        <SegmentedFilter
          options={SEVERITY_FILTERS}
          value={severity}
          onChange={setSeverity}
          label="Filter by severity"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {events.length} of {query.data.history.length} events. Ironic records these per node; they are not
        the IPA logs.
      </p>

      {events.length === 0 ? (
        <Empty icon={<ScrollText />} title="No matching events" description="Adjust the filter or search." />
      ) : (
        <ol className="space-y-1.5">
          {events.map((event) => (
            <li
              key={event.uuid}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-card/40 px-3 py-2 text-sm"
            >
              <Badge tone={historySeverityTone(event.severity)} className="shrink-0">
                {event.severity ?? 'UNKNOWN'}
              </Badge>
              <span className="min-w-0 flex-1">{event.event}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {event.event_type ? <span className="font-mono">{event.event_type}</span> : null}
              </span>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={`${formatTimestamp(event.created_at)}${
                  event.conductor ? ` on ${event.conductor}` : ''
                }${event.user ? ` by ${event.user}` : ''}`}
              >
                {relativeTime(event.created_at, now)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RamdiskView({ uuid }: { uuid: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: qk.nodeLogs(uuid),
    queryFn: () => api.nodeLogs(uuid),
    staleTime: 60_000,
  });

  if (list.isPending) return <Skeleton className="h-64 w-full" />;
  if (list.isError) {
    return (
      <Empty
        icon={<FileText />}
        title="IPA logs are not available on this deployment"
        description="Ironic collects IPA logs from the ramdisk but does not serve them over the API yet. See docs/ironic-api-gaps.md items 4 and 5."
      />
    );
  }

  const logs = list.data?.logs ?? [];
  if (!list.data?.supported || logs.length === 0) {
    return (
      <Empty
        icon={<FileText />}
        title="No IPA logs stored for this node"
        description="Logs are collected when a deploy, clean or inspect runs the agent ramdisk."
      />
    );
  }

  const active = selected ?? logs[0]!.id;

  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
      <ul className="space-y-1.5">
        {logs.map((log) => (
          <li key={log.id}>
            <LogArchiveButton
              log={log}
              active={log.id === active}
              onClick={() => setSelected(log.id)}
            />
          </li>
        ))}
      </ul>
      <LogContent uuid={uuid} id={active} />
    </div>
  );
}

function LogArchiveButton({
  log,
  active,
  onClick,
}: {
  log: NodeLogArchive;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'border-primary/50 bg-primary/10'
          : 'border-border bg-card/40 hover:border-border/80 hover:bg-card',
      )}
    >
      <span className="flex items-center gap-2">
        <Badge tone="outline" className="font-mono text-[10px]">
          {log.kind}
        </Badge>
        {log.source ? <span className="text-xs text-muted-foreground">{log.source}</span> : null}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {formatTimestamp(log.collected_at)}
        {log.size_bytes ? ` · ${formatBytes(log.size_bytes)}` : ''}
      </span>
    </button>
  );
}

function LogContent({ uuid, id }: { uuid: string; id: string }) {
  const query = useQuery({
    queryKey: qk.nodeLog(uuid, id),
    queryFn: () => api.nodeLog(uuid, id),
    staleTime: 5 * 60_000,
  });

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <ErrorPanel title="Could not load this log" error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <FilterableText
      text={query.data.content}
      filterPlaceholder="Filter lines"
      filterLabel="Filter log lines"
      note={
        query.data.truncated ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            This log was truncated by the server. Fetch the archive from storage for the whole file.
          </p>
        ) : undefined
      }
    />
  );
}
