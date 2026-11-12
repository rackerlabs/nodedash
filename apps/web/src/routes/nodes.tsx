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

import type { SortingState, VisibilityState } from '@tanstack/react-table';
import { Columns3, Filter, RefreshCw, ServerOff, Wrench } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, Skeleton, Spinner } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/session';
import { DEFAULT_COLUMN_LABELS } from '@/features/nodes/columns';
import {
  applyNodeFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  provisionStateCounts,
  type MaintenanceFilter,
  type NodeFilters,
} from '@/features/nodes/filters';
import { NodesTable } from '@/features/nodes/nodes-table';
import { useNodes } from '@/features/nodes/use-nodes';
import { formatCount, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import { ErrorPanel } from './status';

const MAINTENANCE_LABELS: Record<MaintenanceFilter, string> = {
  all: 'All nodes',
  only: 'In maintenance only',
  exclude: 'Exclude maintenance',
};

export function NodesPage() {
  const session = useSession();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { query, loadedCount } = useNodes({ autoRefresh });
  const [filters, setFilters] = useState<NodeFilters>(EMPTY_FILTERS);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const now = useNow();

  const rows = query.data ?? [];
  // Typing stays responsive on large fleets: filtering runs against the deferred value.
  const deferredFilters = useDeferredValue(filters);
  const filtered = useMemo(() => applyNodeFilters(rows, deferredFilters), [rows, deferredFilters]);
  const stateCounts = useMemo(() => provisionStateCounts(rows), [rows]);
  const activeFilters = countActiveFilters(filters);
  const isStale = filters !== deferredFilters;

  if (query.isError) {
    return (
      <ErrorPanel title="Could not load nodes" error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
          placeholder="Search name, UUID, instance…"
          label="Search nodes"
          clearable
          className="w-72"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="size-4" />
              Provision state
              {filters.provisionStates.length > 0 ? (
                <Badge tone="active">{filters.provisionStates.length}</Badge>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
            <DropdownMenuLabel>Filter by provision state</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stateCounts.map(({ state, count }) => (
              <DropdownMenuCheckboxItem
                key={state}
                checked={filters.provisionStates.includes(state)}
                onCheckedChange={(checked) =>
                  setFilters((current) => ({
                    ...current,
                    provisionStates: checked
                      ? [...current.provisionStates, state]
                      : current.provisionStates.filter((value) => value !== state),
                  }))
                }
                onSelect={(event) => event.preventDefault()}
              >
                <span className="font-mono text-xs">{state}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatCount(count)}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {filters.provisionStates.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setFilters((current) => ({ ...current, provisionStates: [] }))}>
                  Clear state filter
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-2', filters.maintenance !== 'all' && 'border-destructive/60 text-destructive')}
            >
              <Wrench className="size-4" />
              {MAINTENANCE_LABELS[filters.maintenance]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(MAINTENANCE_LABELS) as MaintenanceFilter[]).map((value) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => setFilters((current) => ({ ...current, maintenance: value }))}
              >
                {MAINTENANCE_LABELS[value]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Columns3 className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {Object.entries(DEFAULT_COLUMN_LABELS).map(([id, label]) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={columnVisibility[id] !== false}
                onCheckedChange={(checked) =>
                  setColumnVisibility((current) => ({ ...current, [id]: checked }))
                }
                onSelect={(event) => event.preventDefault()}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {activeFilters > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {query.isFetching ? (
            <span className="flex items-center gap-1.5">
              <Spinner className="size-3.5" />
              {loadedCount > 0 ? `${formatCount(loadedCount)} loaded…` : 'Loading…'}
            </span>
          ) : (
            <span>Updated {relativeTime(query.dataUpdatedAt, now)}</span>
          )}
          <Hint label={autoRefresh ? 'Auto-refresh every 30s (on)' : 'Auto-refresh is off'}>
            <Button
              variant={autoRefresh ? 'secondary' : 'ghost'}
              size="sm"
              className="gap-1.5"
              onClick={() => setAutoRefresh((value) => !value)}
            >
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} />
              Auto
            </Button>
          </Hint>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">
          <span data-testid="node-count">{formatCount(filtered.length)}</span>
          {filtered.length !== rows.length ? (
            <span className="text-muted-foreground"> of {formatCount(rows.length)}</span>
          ) : null}{' '}
          node{filtered.length === 1 ? '' : 's'}
        </span>
        <span className="text-xs text-muted-foreground">
          in {session.data?.scope?.projectName ?? 'this project'}
        </span>
        {isStale ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
      </div>

      {query.isPending ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty
          icon={<ServerOff />}
          title="No nodes in this project"
          description="This project has no bare metal nodes registered with Ironic. Switch projects with ⌘K."
        />
      ) : filtered.length === 0 ? (
        <Empty
          icon={<Filter />}
          title="No nodes match your filters"
          description="Loosen the search or clear the state and maintenance filters."
          action={
            <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <NodesTable
          rows={filtered}
          sorting={sorting}
          onSortingChange={setSorting}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
        />
      )}
    </div>
  );
}
