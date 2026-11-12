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

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export interface DataColumn<T> {
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting and search; omit to make the column inert. */
  value?: (row: T) => string | number | null | undefined;
  width?: string;
  className?: string;
}

/**
 * Plain sortable, searchable table for the small-to-medium lists on the node
 * detail tabs (BIOS settings, firmware, disks, NICs). The fleet view uses the
 * virtualized table instead; these lists are tens of rows, not thousands.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  ariaLabel,
  searchPlaceholder,
  initialSort,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  toolbarExtra,
}: {
  rows: readonly T[];
  columns: Array<DataColumn<T>>;
  getRowId: (row: T, index: number) => string;
  ariaLabel: string;
  searchPlaceholder?: string;
  initialSort?: { columnId: string; desc?: boolean };
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  toolbarExtra?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ columnId: string; desc: boolean } | null>(
    initialSort ? { columnId: initialSort.columnId, desc: initialSort.desc ?? false } : null,
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let result = [...rows];
    if (needle) {
      result = result.filter((row) =>
        columns.some((column) => String(column.value?.(row) ?? '').toLowerCase().includes(needle)),
      );
    }
    if (sort) {
      const column = columns.find((candidate) => candidate.id === sort.columnId);
      if (column?.value) {
        result.sort((a, b) => {
          const left = column.value!(a);
          const right = column.value!(b);
          if (typeof left === 'number' && typeof right === 'number') {
            return sort.desc ? right - left : left - right;
          }
          return sort.desc
            ? String(right ?? '').localeCompare(String(left ?? ''))
            : String(left ?? '').localeCompare(String(right ?? ''));
        });
      }
    }
    return result;
  }, [rows, columns, search, sort]);

  const gridTemplate = columns.map((column) => column.width ?? 'minmax(8rem, 1fr)').join(' ');

  return (
    <div className="space-y-2">
      {searchPlaceholder || toolbarExtra ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder ? (
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={searchPlaceholder}
              label={searchPlaceholder}
              className="w-72"
            />
          ) : null}
          {toolbarExtra}
          <span className="ml-auto text-xs text-muted-foreground">
            {visible.length === rows.length
              ? `${rows.length} row${rows.length === 1 ? '' : 's'}`
              : `${visible.length} of ${rows.length} rows`}
          </span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div
          role="table"
          aria-label={ariaLabel}
          aria-rowcount={visible.length + 1}
          aria-colcount={columns.length}
          className="overflow-x-auto"
        >
          <div
            role="row"
            aria-rowindex={1}
            className="grid border-b border-border text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: gridTemplate, minWidth: 'max-content' }}
          >
            {columns.map((column, columnIndex) => {
              const sorted = sort?.columnId === column.id ? sort : null;
              const sortable = Boolean(column.value);
              return (
                <div
                  key={column.id}
                  role="columnheader"
                  aria-label={column.header}
                  aria-colindex={columnIndex + 1}
                  aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : 'none'}
                  className="min-w-0"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!sortable}
                    aria-label={sortable ? `Sort by ${column.header}` : column.header}
                    className={cn(
                      'h-9 w-full justify-start rounded-none px-3 text-xs font-medium text-muted-foreground disabled:opacity-100',
                      sorted && 'text-foreground',
                    )}
                    onClick={() =>
                      setSort((current) =>
                        current?.columnId === column.id
                          ? current.desc
                            ? null
                            : { columnId: column.id, desc: true }
                          : { columnId: column.id, desc: false },
                      )
                    }
                  >
                    {column.header}
                    {sorted ? (
                      sorted.desc ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ArrowUp className="size-3.5" />
                      )
                    ) : null}
                  </Button>
                </div>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <Empty title={emptyTitle} description={emptyDescription} />
          ) : (
            visible.map((row, index) => (
              <div
                key={getRowId(row, index)}
                role="row"
                aria-rowindex={index + 2}
                className="grid items-center border-b border-border/50 text-sm last:border-b-0 hover:bg-accent/40"
                style={{ gridTemplateColumns: gridTemplate, minWidth: 'max-content' }}
              >
                {columns.map((column, columnIndex) => (
                  <div
                    key={column.id}
                    role="cell"
                    aria-colindex={columnIndex + 1}
                    className={cn('min-w-0 px-3 py-2', column.className)}
                  >
                    {column.render(row)}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
