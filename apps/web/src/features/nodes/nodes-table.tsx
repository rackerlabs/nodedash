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

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { NodeRow } from '@nodedash/shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { nodeColumns, type ColumnMeta } from './columns';

const ROW_HEIGHT = 40;

/**
 * Virtualized fleet table. Rows are absolutely positioned for virtualization, so
 * the grid carries explicit ARIA table semantics — without them a screen reader
 * (and anything else navigating by role) sees an undifferentiated pile of divs.
 */
export function NodesTable({
  rows,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
}: {
  rows: NodeRow[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;
}) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data: rows,
    columns: nodeColumns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) =>
      onSortingChange(typeof updater === 'function' ? updater(sorting) : updater),
    onColumnVisibilityChange: (updater) =>
      onColumnVisibilityChange(typeof updater === 'function' ? updater(columnVisibility) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
  });

  const tableRows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const gridTemplate = useMemo(
    () =>
      visibleColumns
        .map((column) => (column.columnDef.meta as ColumnMeta | undefined)?.width ?? '1fr')
        .join(' '),
    [visibleColumns],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        ref={scrollRef}
        role="table"
        aria-label="Bare metal nodes"
        aria-rowcount={tableRows.length + 1}
        aria-colcount={visibleColumns.length}
        className="max-h-[calc(100vh-15.5rem)] min-h-72 overflow-auto"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 grid border-b border-border bg-card text-xs font-medium text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate, minWidth: 'max-content' }}
        >
          {table.getHeaderGroups()[0]?.headers.map((header, index) => {
            const sorted = header.column.getIsSorted();
            const label = String(header.column.columnDef.header);
            return (
              <div
                key={header.id}
                role="columnheader"
                // Named explicitly so the column keeps its plain name even though
                // its content is a "Sort by …" control.
                aria-label={label}
                aria-colindex={index + 1}
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                className="min-w-0"
              >
                <button
                  type="button"
                  aria-label={`Sort by ${label}`}
                  onClick={header.column.getToggleSortingHandler()}
                  className={cn(
                    'flex h-9 w-full items-center gap-1.5 px-3 text-left transition-colors hover:text-foreground',
                    sorted && 'text-foreground',
                  )}
                >
                  <span className="truncate">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </span>
                  {sorted === 'asc' ? (
                    <ArrowUp className="size-3.5 shrink-0" />
                  ) : sorted === 'desc' ? (
                    <ArrowDown className="size-3.5 shrink-0" />
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>

        <div
          role="rowgroup"
          style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 'max-content' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;
            const node = row.original;
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={virtualRow.index + 2}
                tabIndex={0}
                // Clicking anywhere on the row navigates, but the name cell also
                // holds a real link so a node can be opened in a new tab.
                onClick={() => void navigate(`/nodes/${node.uuid}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void navigate(`/nodes/${node.uuid}`);
                }}
                className={cn(
                  'absolute top-0 left-0 grid w-full cursor-pointer items-center border-b border-border/60 text-sm',
                  'hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none',
                  node.maintenance && 'bg-destructive/5',
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: gridTemplate,
                }}
              >
                {row.getVisibleCells().map((cell, index) => (
                  <div
                    key={cell.id}
                    role="cell"
                    aria-colindex={index + 1}
                    className="flex min-w-0 items-center px-3"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
