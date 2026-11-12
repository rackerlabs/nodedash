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

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/search-input';
import { cn } from '@/lib/utils';

/**
 * Monospaced text with a line filter. Inventory JSON, BIOS dumps and ramdisk logs
 * all end up here: far more content than any curated view shows, and operators do
 * go looking for one specific line.
 */
export function FilterableText({
  text,
  filterPlaceholder = 'Filter lines…',
  filterLabel = 'Filter lines',
  note,
  countLabel = 'lines',
}: {
  text: string;
  filterPlaceholder?: string;
  filterLabel?: string;
  /** Rendered above the text, e.g. a truncation warning. */
  note?: React.ReactNode;
  countLabel?: string;
}) {
  const [filter, setFilter] = useState('');

  const { lines, total } = useMemo(() => {
    const all = text.split('\n');
    const needle = filter.trim().toLowerCase();
    if (!needle) return { lines: all, total: all.length };
    return {
      lines: all.filter((line) => line.toLowerCase().includes(needle)),
      total: all.length,
    };
  }, [text, filter]);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder={filterPlaceholder}
          label={filterLabel}
          className="min-w-56 flex-1"
        />
        <span className="text-xs text-muted-foreground">
          {filter ? `${lines.length} of ${total} ${countLabel}` : `${total} ${countLabel}`}
        </span>
      </div>

      {note}

      <pre
        className={cn(
          'max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/20 p-3',
          'font-mono text-[11px] leading-relaxed',
        )}
      >
        {lines.join('\n') || '(no matching lines)'}
      </pre>
    </div>
  );
}
