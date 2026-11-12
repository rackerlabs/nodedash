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

import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Search/filter box with its leading icon and an optional clear button. Five
 * places wanted this and each had grown its own copy of the icon positioning.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  id,
  clearable = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name. Required unless an associated <Label> supplies one via `id`. */
  label?: string;
  id?: string;
  clearable?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn('pl-8', clearable && value && 'pr-8')}
      />
      {clearable && value ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
